'use strict';

const processStartedAt = Date.now();

require('dotenv').config();

const adminCredentials = require('./server/adminBootstrap').ensureAdminCredentials(process.env);

require('./server/envCheck').checkEnv(process.env);

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const gameManager = require('./server/gameManager');
const adminManager = require('./server/adminManager');
const accountManager = require('./server/accountManager');
const cardManager = require('./server/cardManager');
const pushManager = require('./server/pushManager');
const siteStats = require('./server/siteStats');
const logRetention = require('./server/logRetention');

const PORT = process.env.PORT || 1563;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  pingInterval: 10000,
});

// Cache-busting automatique : chaque script/style local reference dans les
// pages HTML recoit "?v=<demarrage du process>". Meme si un navigateur (ou
// un proxy/CDN en ligne) ignore Cache-Control et garde un vieux app.js en
// cache, l'URL elle-meme change a chaque redemarrage serveur -> jamais de
// JS perime servi apres un deploiement, plus besoin de compter sur un hard
// refresh manuel cote utilisateur.
function injectCacheBust(html, version) {
  return html
    .replace(/(<script[^>]+src=")([^"]+\.js)(")/g, (m, pre, src, post) => {
      if (/^https?:\/\//.test(src) || src.startsWith('/')) return m;
      return `${pre}${src}?v=${version}${post}`;
    })
    .replace(/(<link[^>]+href=")([^"]+\.css)(")/g, (m, pre, href, post) => {
      if (/^https?:\/\//.test(href)) return m;
      return `${pre}${href}?v=${version}${post}`;
    })
    // Meta lisible directement dans le HTML servi, sans fetch separe (qui
    // pourrait lui aussi etre serve depuis un cache) : premiere ligne de
    // defense du diagnostic de version cote client (voir app.js).
    .replace('</head>', `<meta name="app-version" content="${version}">\n</head>`);
}

const HTML_PAGES = ['/', '/index.html', '/admin.html'];
app.get(HTML_PAGES, (req, res) => {
  const file = req.path === '/admin.html' ? 'admin.html' : 'index.html';
  const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(injectCacheBust(html, processStartedAt));
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  // no-store (pas juste no-cache) : sans validateur (etag/lastModified
  // desactives ci-dessus), "no-cache" seul laisse trop de marge au
  // navigateur (bfcache, cache disque heuristique) de reafficher une vieille
  // page/JS sans repasser par le reseau apres un deploiement.
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// Le client (voir app.js checkForUpdate) compare cette valeur a celle qu'il a
// deja vue : si elle a change, une nouvelle version du serveur tourne (donc
// potentiellement un nouveau JS/CSS) et le client force une mise a jour
// complete (service worker + cache + reload), meme dans un PWA installe qui
// resterait ouvert des jours sans jamais recharger naturellement.
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ v: processStartedAt });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/packs', (req, res) => {
  res.json(cardManager.getPackMeta());
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ enabled: pushManager.enabled, publicKey: pushManager.publicKey });
});

// Filet de securite : une exception dans un callback de timer (setTimeout)
// n'est jamais rattrapee par les try/catch des handlers socket. Sans ce
// filet, un seul bug ferait planter le serveur entier pour toutes les
// parties en cours. On journalise et on continue plutot que de crasher.
process.on('uncaughtException', (err) => {
  console.error('Exception non interceptee (serveur maintenu en vie):', err);
});

gameManager.init(io);
logRetention.start();

io.on('connection', (socket) => {
  socket.data.gameCode = null;
  socket.data.playerId = null;

  siteStats.increment('visits');

  const withAck = (handler) => (payload, ack) => {
    const safeAck = typeof ack === 'function' ? ack : () => {};
    try {
      handler(socket, payload, safeAck);
    } catch (err) {
      console.error('Erreur handler socket:', err);
      safeAck({ ok: false, error: 'Erreur serveur.' });
    }
  };

  socket.on('createGame', withAck(gameManager.createGame));
  socket.on('createPracticeGame', withAck(gameManager.createPracticeGame));
  socket.on('checkNickname', withAck(gameManager.checkNickname));
  socket.on('joinGame', withAck(gameManager.joinGame));
  socket.on('reconnectPlayer', withAck(gameManager.reconnectPlayer));
  socket.on('updateSettings', withAck(gameManager.updateSettings));
  socket.on('kickPlayer', withAck(gameManager.kickPlayer));
  socket.on('stopGame', withAck(gameManager.stopGame));
  socket.on('startGame', withAck(gameManager.startGame));
  socket.on('rerollCard', withAck(gameManager.rerollCard));
  socket.on('confirmCard', withAck(gameManager.confirmCard));
  socket.on('submitAnswer', withAck(gameManager.submitAnswer));
  socket.on('submitVote', withAck(gameManager.submitVote));
  socket.on('playAgain', withAck(gameManager.playAgain));
  socket.on('listPublicGames', withAck(gameManager.listPublicGames));
  socket.on('submitCommunityCard', withAck(gameManager.submitCommunityCard));
  socket.on('reportCard', withAck(gameManager.reportCard));
  socket.on('chatSend', withAck(gameManager.chatSend));
  socket.on('sendReaction', withAck(gameManager.sendReaction));
  socket.on('pushSubscribe', withAck(gameManager.pushSubscribe));
  socket.on('joinGameAsAdmin', withAck(gameManager.joinGameAsAdmin));

  // ---- Comptes joueurs persistants ----
  socket.on('accountRegister', withAck(accountManager.register));
  socket.on('accountLogin', withAck(accountManager.login));
  socket.on('accountResumeSession', withAck(accountManager.resumeSession));
  socket.on('accountLogout', withAck(accountManager.logout));
  socket.on('accountDeleteAccount', withAck(accountManager.deleteAccount));
  socket.on('accountGetProfile', withAck(accountManager.getProfile));
  socket.on('accountSendFriendRequest', withAck(accountManager.sendFriendRequest));
  socket.on('accountRespondFriendRequest', withAck(accountManager.respondFriendRequest));
  socket.on('accountRemoveFriend', withAck(accountManager.removeFriend));
  socket.on('accountListFriends', withAck(accountManager.listFriends));

  // ---- Admin (compte global, separe des admins de partie) ----
  socket.on('adminLogin', withAck(adminManager.login));
  socket.on('adminLogout', withAck(adminManager.logout));
  socket.on('adminWhoAmI', withAck(adminManager.whoAmI));
  socket.on('adminListGames', withAck(adminManager.listGames));
  socket.on('adminStopGame', withAck(adminManager.stopAnyGame));
  socket.on('adminPauseGame', withAck(adminManager.pauseGame));
  socket.on('adminResumeGame', withAck(adminManager.resumeGame));
  socket.on('adminDeleteGame', withAck(adminManager.deleteGame));
  socket.on('adminJoinGameTicket', withAck(adminManager.joinGameTicket));
  socket.on('adminForceNextCard', withAck(adminManager.forceNextCard));
  socket.on('adminGetPacks', withAck(adminManager.getPacks));
  socket.on('adminListCards', withAck(adminManager.listCards));
  socket.on('adminAddCard', withAck(adminManager.addCard));
  socket.on('adminUpdateCard', withAck(adminManager.updateCard));
  socket.on('adminDeleteCard', withAck(adminManager.deleteCard));
  socket.on('adminExportPack', withAck(adminManager.exportPack));
  socket.on('adminImportPack', withAck(adminManager.importPack));
  socket.on('adminListPendingCommunity', withAck(adminManager.listPendingCommunity));
  socket.on('adminApproveCommunity', withAck(adminManager.approveCommunity));
  socket.on('adminRejectCommunity', withAck(adminManager.rejectCommunity));
  socket.on('adminListReports', withAck(adminManager.listReports));
  socket.on('adminDismissReport', withAck(adminManager.dismissReport));
  socket.on('adminBanAccount', withAck(adminManager.banAccount));
  socket.on('adminUnbanAccount', withAck(adminManager.unbanAccount));
  socket.on('adminListBannedAccounts', withAck(adminManager.listBannedAccounts));
  socket.on('adminListAdmins', withAck(adminManager.listAdmins));
  socket.on('adminCreateAdmin', withAck(adminManager.createAdmin));
  socket.on('adminUpdateAdminRole', withAck(adminManager.updateAdminRole));
  socket.on('adminDeleteAdmin', withAck(adminManager.deleteAdmin));
  socket.on('adminListAuditLog', withAck(adminManager.listAuditLog));
  socket.on('adminListActivityLog', withAck(adminManager.listActivityLog));
  socket.on('adminGetAnswerMaxLength', withAck(adminManager.getAnswerMaxLength));
  socket.on('adminSetAnswerMaxLength', withAck(adminManager.setAnswerMaxLength));
  socket.on('adminListPracticeScenarios', withAck(adminManager.listPracticeScenarios));
  socket.on('adminAddPracticeScenario', withAck(adminManager.addPracticeScenario));
  socket.on('adminUpdatePracticeScenario', withAck(adminManager.updatePracticeScenario));
  socket.on('adminDeletePracticeScenario', withAck(adminManager.deletePracticeScenario));
  socket.on('adminGeolocateIp', withAck(adminManager.geolocateIp));
  socket.on('adminGetStats', withAck(adminManager.getStats));

  // Ping leger pour mesurer la latence reelle cote client (indicateur wifi).
  socket.on('ping', (payload, ack) => {
    if (typeof ack === 'function') ack({ t: payload && payload.t });
  });

  socket.on('leaveGame', () => {
    try {
      gameManager.leaveGame(socket);
    } catch (err) {
      console.error('Erreur leaveGame:', err);
    }
  });

  socket.on('disconnect', () => {
    try {
      gameManager.handleDisconnect(socket);
      accountManager.handleSocketDisconnect(socket);
    } catch (err) {
      console.error('Erreur disconnect:', err);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  require('./server/startupBanner').printBanner({ port: PORT, startedAt: processStartedAt, io, adminCredentials });
});
