'use strict';

const { timingSafeEqual, scryptSync, randomBytes } = require('crypto');
const cardManager = require('./cardManager');
const gameManager = require('./gameManager');
const { games } = gameManager;
const { STATES } = require('./gameState');
const db = require('./db');
const appSettings = require('./appSettings');
const practiceScenarios = require('./practiceScenarios');
const siteStats = require('./siteStats');
const gifAvatars = require('./gifAvatars');
const { generateId } = require('./utils');

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4h
const ROLES = ['superadmin', 'moderator'];

const sessions = new Map(); // token -> { adminId, email, role, expiresAt }

// ---------- Rate limiting anti-bruteforce sur le login (par IP) ----------
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, windowStart, lockedUntil }

function checkRateLimit(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return { blocked: false };
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    return { blocked: true, retryInMs: entry.lockedUntil - Date.now() };
  }
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginAttempts.delete(ip);
  }
  return { blocked: false };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: null };
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOGIN_WINDOW_MS;
  }
  loginAttempts.set(ip, entry);
}

function recordLoginSuccess(ip) {
  loginAttempts.delete(ip);
}

// ---------- Mots de passe : scrypt + sel, jamais stocke ni logge en clair ----------
function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHex) {
  if (!salt || !expectedHex || typeof password !== 'string') return false;
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------- Bootstrap : premier admin cree depuis .env si la table est vide ----------
function bootstrapFromEnv() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const salt = process.env.ADMIN_PASSWORD_SALT || '';
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  if (!email || !salt || !hash) return; // envCheck.js a deja averti l'operateur
  db.prepare(
    'INSERT INTO admins (id, email, password_salt, password_hash, role, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(generateId(), email, salt, hash, 'superadmin', Date.now(), 'env-bootstrap');
  console.log(`Admin "superadmin" initial cree depuis .env : ${email}`);
}
bootstrapFromEnv();

function clientIp(socket) {
  return (socket && socket.handshake && socket.handshake.address) || 'unknown';
}

function audit(session, action, target, details, ip) {
  db.prepare(
    'INSERT INTO admin_audit_log (id, admin_id, admin_email, action, target, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(generateId(), session.adminId, session.email, action, target || null, details ? JSON.stringify(details) : null, ip || null, Date.now());
}

function login(socket, payload, ack) {
  const ip = clientIp(socket);
  const rl = checkRateLimit(ip);
  if (rl.blocked) {
    return ack({ ok: false, error: `Trop de tentatives. Reessaie dans ${Math.ceil(rl.retryInMs / 60000)} min.` });
  }

  const email = (payload && payload.email || '').trim().toLowerCase();
  const password = typeof (payload && payload.password) === 'string' ? payload.password.trim() : '';
  let account = email ? db.prepare('SELECT * FROM admins WHERE email = ?').get(email) : null;

  const hashOk = account && verifyPassword(password, account.password_salt, account.password_hash);

  // Filet de secours : si un ADMIN_PASSWORD en clair est configure dans .env
  // pour cet email, on l'accepte aussi directement. Evite qu'un hash reste
  // desynchronise (ex: .env modifie sans que le process ait redemarre, ou
  // hash regenere par adminBootstrap.js) et resynchronise la base au passage.
  const envEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const envPasswordOk = !hashOk && envEmail && envEmail === email
    && typeof process.env.ADMIN_PASSWORD === 'string' && process.env.ADMIN_PASSWORD === password;

  if (!hashOk && !envPasswordOk) {
    recordLoginFailure(ip);
    return ack({ ok: false, error: 'Identifiants incorrects.' });
  }

  if (envPasswordOk) {
    const salt = randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    if (account) {
      db.prepare('UPDATE admins SET password_salt = ?, password_hash = ? WHERE id = ?').run(salt, hash, account.id);
      account = { ...account, password_salt: salt, password_hash: hash };
    } else {
      account = { id: generateId(), email, password_salt: salt, password_hash: hash, role: 'superadmin' };
      db.prepare(
        'INSERT INTO admins (id, email, password_salt, password_hash, role, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(account.id, email, salt, hash, 'superadmin', Date.now(), 'env-password-fallback');
    }
  }

  recordLoginSuccess(ip);
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { adminId: account.id, email: account.email, role: account.role, expiresAt: Date.now() + SESSION_TTL_MS });
  socket.data.adminToken = token;
  audit({ adminId: account.id, email: account.email }, 'login', null, null, ip);
  ack({ ok: true, token, role: account.role, email: account.email });
}

function getSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

// Toute action admin : session valide requise, quel que soit le role.
function requireAdmin(handler) {
  return (socket, payload, ack) => {
    const session = getSession(payload && payload.token);
    if (!session) return ack({ ok: false, error: 'Session admin invalide ou expiree.' });
    handler(socket, payload, ack, session);
  };
}

// Actions sensibles (gestion des comptes admin) : reserve au superadmin.
function requireSuperadmin(handler) {
  return requireAdmin((socket, payload, ack, session) => {
    if (session.role !== 'superadmin') return ack({ ok: false, error: 'Reserve aux super-administrateurs.' });
    handler(socket, payload, ack, session);
  });
}

// Enrobe une action mutante : execute puis journalise dans l'audit log, avec
// le detail retourne par `handler` (ou juste le payload si non fourni).
function withAudit(action, handler) {
  return requireAdmin((socket, payload, ack, session) => {
    const ip = clientIp(socket);
    handler(socket, payload, ack, session);
    audit(session, action, payload && (payload.code || payload.username || payload.cardId || payload.targetEmail), payload, ip);
  });
}

const whoAmI = requireAdmin((socket, payload, ack, session) => {
  ack({ ok: true, email: session.email, role: session.role });
});

function logout(socket, payload, ack) {
  if (payload && payload.token) sessions.delete(payload.token);
  ack({ ok: true });
}

// ---------- Dashboard : parties en cours ----------

const listGames = requireAdmin((socket, payload, ack) => {
  const list = [...games.values()].map((g) => ({
    code: g.code,
    state: g.state,
    paused: g.paused,
    playerCount: g.activePlayers().length,
    connectedCount: g.connectedPlayers().length,
    maxPlayers: 20,
    roundNumber: g.roundNumber,
    visibility: g.settings.visibility,
    mode: g.mode,
    createdAt: g.createdAt,
    lastActivity: g.lastActivity,
    players: g.activePlayers().map((p) => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score,
      connected: p.connected, spectating: p.spectating, isBot: p.isBot, isPlatformAdmin: p.isPlatformAdmin,
    })),
  }));
  ack({ ok: true, games: list });
});

const stopAnyGame = withAudit('stop_game', (socket, payload, ack) => {
  const game = games.get(payload && payload.code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  game.clearAllTimers();
  game.state = STATES.STOPPED;
  gameManager.broadcastState(game);
  ack({ ok: true });
});

const pauseGame = withAudit('pause_game', (socket, payload, ack) => {
  const game = games.get(payload && payload.code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  ack(gameManager.pauseGame(game));
});

const resumeGame = withAudit('resume_game', (socket, payload, ack) => {
  const game = games.get(payload && payload.code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  ack(gameManager.resumeGame(game));
});

const deleteGame = withAudit('delete_game', (socket, payload, ack) => {
  const game = games.get(payload && payload.code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  ack(gameManager.deleteGameNow(game));
});

// Genere un ticket a usage unique : le client ouvre `/?adminJoin=TICKET`
// dans un nouvel onglet pour rejoindre la partie en spectateur (couronne).
const joinGameTicket = requireAdmin((socket, payload, ack, session) => {
  const game = games.get(payload && payload.code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  const ticket = gameManager.createAdminJoinTicket(game.code, session.email);
  audit(session, 'join_game', game.code, null, clientIp(socket));
  ack({ ok: true, ticket });
});

// Force la prochaine carte proposee au juge pour une partie donnee : elle
// remplacera un des 3 tirages aleatoires a la prochaine CARD_SELECTION.
const forceNextCard = requireAdmin((socket, payload, ack) => {
  const game = games.get(payload && payload.code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  const packId = payload && payload.packId;
  const cardId = payload && payload.cardId;
  const cards = cardManager.adminListCards(packId);
  if (!cards) return ack({ ok: false, error: 'Pack inconnu.' });
  const card = cards.find((c) => c.id === cardId);
  if (!card) return ack({ ok: false, error: 'Carte introuvable.' });
  game.forcedNextCard = { id: card.id, text: card.text, blanksTotal: card.blanksTotal };
  ack({ ok: true });
});

// ---------- Editeur de cartes ----------

const getPacks = requireAdmin((socket, payload, ack) => {
  ack({ ok: true, packs: cardManager.getPackMeta() });
});

const setPackDescription = withAudit('set_pack_description', (socket, payload, ack) => {
  const packId = payload && payload.packId;
  if (!cardManager.PACK_IDS.has(packId)) return ack({ ok: false, error: 'Pack inconnu.' });
  const clean = appSettings.setPackDescription(packId, payload && payload.description);
  ack({ ok: true, description: clean });
});

const listCards = requireAdmin((socket, payload, ack) => {
  const cards = cardManager.adminListCards(payload && payload.packId);
  if (!cards) return ack({ ok: false, error: 'Pack inconnu.' });
  ack({ ok: true, cards });
});

const addCard = withAudit('add_card', (socket, payload, ack) => {
  ack(cardManager.adminAddCard(payload && payload.packId, payload && payload.text));
});

const updateCard = withAudit('update_card', (socket, payload, ack) => {
  ack(cardManager.adminUpdateCard(payload && payload.packId, payload && payload.cardId, payload && payload.text));
});

const deleteCard = withAudit('delete_card', (socket, payload, ack) => {
  ack(cardManager.adminDeleteCard(payload && payload.packId, payload && payload.cardId));
});

const exportPack = requireAdmin((socket, payload, ack) => {
  const data = cardManager.adminExportPack(payload && payload.packId);
  if (!data) return ack({ ok: false, error: 'Pack inconnu.' });
  ack({ ok: true, data });
});

const importPack = withAudit('import_pack', (socket, payload, ack) => {
  ack(cardManager.adminImportPack(payload && payload.packId, payload && payload.entries));
});

// ---------- Deck communautaire ----------

const listPendingCommunity = requireAdmin((socket, payload, ack) => {
  ack({ ok: true, cards: cardManager.listPendingCommunityCards() });
});

const approveCommunity = withAudit('approve_community_card', (socket, payload, ack) => {
  ack(cardManager.approveCommunityCard(payload && payload.cardId));
});

const rejectCommunity = withAudit('reject_community_card', (socket, payload, ack) => {
  ack(cardManager.rejectCommunityCard(payload && payload.cardId));
});

// ---------- Signalements ----------

const listReports = requireAdmin((socket, payload, ack) => {
  ack({ ok: true, reports: cardManager.listReports() });
});

const dismissReport = withAudit('dismiss_report', (socket, payload, ack) => {
  ack(cardManager.dismissReport(payload && payload.reportId));
});

// ---------- Bannissement de comptes (moderation reelle, pas juste un kick de partie) ----------

const banAccount = withAudit('ban_account', (socket, payload, ack) => {
  const username = payload && payload.username;
  const reason = (payload && payload.reason) || 'Non precisee';
  const account = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
  if (!account) return ack({ ok: false, error: 'Compte introuvable.' });
  db.prepare('UPDATE accounts SET banned = 1, ban_reason = ? WHERE id = ?').run(reason, account.id);
  ack({ ok: true });
});

const unbanAccount = withAudit('unban_account', (socket, payload, ack) => {
  const username = payload && payload.username;
  const account = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
  if (!account) return ack({ ok: false, error: 'Compte introuvable.' });
  db.prepare('UPDATE accounts SET banned = 0, ban_reason = NULL WHERE id = ?').run(account.id);
  ack({ ok: true });
});

const listBannedAccounts = requireAdmin((socket, payload, ack) => {
  const rows = db.prepare('SELECT username, ban_reason FROM accounts WHERE banned = 1').all();
  ack({ ok: true, banned: rows });
});

// ---------- Gestion multi-admin (reserve au superadmin) ----------

const listAdmins = requireSuperadmin((socket, payload, ack) => {
  const rows = db.prepare('SELECT id, email, role, created_at, created_by FROM admins ORDER BY created_at ASC').all();
  ack({ ok: true, admins: rows });
});

const createAdmin = requireSuperadmin((socket, payload, ack, session) => {
  const email = (payload && payload.email || '').trim().toLowerCase();
  const password = payload && payload.password;
  const role = ROLES.includes(payload && payload.role) ? payload.role : 'moderator';
  if (!email || !email.includes('@')) return ack({ ok: false, error: 'Email invalide.' });
  if (typeof password !== 'string' || password.length < 8) {
    return ack({ ok: false, error: 'Mot de passe trop court (8 caracteres minimum).' });
  }
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (existing) return ack({ ok: false, error: 'Un admin avec cet email existe deja.' });

  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.prepare(
    'INSERT INTO admins (id, email, password_salt, password_hash, role, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(generateId(), email, salt, hash, role, Date.now(), session.email);
  audit(session, 'create_admin', email, { role }, clientIp(socket));
  ack({ ok: true });
});

const updateAdminRole = requireSuperadmin((socket, payload, ack, session) => {
  const email = (payload && payload.email || '').trim().toLowerCase();
  const role = payload && payload.role;
  if (!ROLES.includes(role)) return ack({ ok: false, error: 'Role invalide.' });
  const target = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (!target) return ack({ ok: false, error: 'Admin introuvable.' });
  db.prepare('UPDATE admins SET role = ? WHERE id = ?').run(role, target.id);
  audit(session, 'update_admin_role', email, { role }, clientIp(socket));
  ack({ ok: true });
});

const deleteAdmin = requireSuperadmin((socket, payload, ack, session) => {
  const email = (payload && payload.email || '').trim().toLowerCase();
  if (email === session.email) return ack({ ok: false, error: 'Impossible de te supprimer toi-meme.' });
  const target = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (!target) return ack({ ok: false, error: 'Admin introuvable.' });
  db.prepare('DELETE FROM admins WHERE id = ?').run(target.id);
  for (const [token, s] of sessions) if (s.adminId === target.id) sessions.delete(token);
  audit(session, 'delete_admin', email, null, clientIp(socket));
  ack({ ok: true });
});

// ---------- Reglage global : longueur max des reponses (owner uniquement) ----------

// Lecture ouverte a tout admin (pour afficher la valeur courante dans le
// dashboard), ecriture reservee au superadmin ("owner" de l'application).
const getAnswerMaxLength = requireAdmin((socket, payload, ack) => {
  ack({
    ok: true,
    value: appSettings.getAnswerMaxLength(),
    min: appSettings.ANSWER_MAX_LENGTH_MIN,
    max: appSettings.ANSWER_MAX_LENGTH_MAX,
    step: appSettings.ANSWER_MAX_LENGTH_STEP,
  });
});

const setAnswerMaxLength = requireSuperadmin((socket, payload, ack, session) => {
  const value = Number(payload && payload.value);
  if (!appSettings.isValidAnswerMaxLength(value)) {
    return ack({ ok: false, error: `Valeur invalide (doit etre entre ${appSettings.ANSWER_MAX_LENGTH_MIN} et ${appSettings.ANSWER_MAX_LENGTH_MAX}, par pas de ${appSettings.ANSWER_MAX_LENGTH_STEP}).` });
  }
  appSettings.setAnswerMaxLength(value);
  audit(session, 'set_answer_max_length', String(value), null, clientIp(socket));
  ack({ ok: true, value });
});

// ---------- Scenarios bots tutoriel/demo (carte + reponses fixes) ----------

const listPracticeScenarios = requireAdmin((socket, payload, ack) => {
  ack({ ok: true, scenarios: practiceScenarios.listScenariosForAdmin() });
});

const addPracticeScenario = withAudit('add_practice_scenario', (socket, payload, ack) => {
  const res = practiceScenarios.addScenario({
    text: payload && payload.text,
    zoeAnswers: payload && payload.zoeAnswers,
    maxAnswers: payload && payload.maxAnswers,
    winner: payload && payload.winner,
  });
  ack(res);
});

const updatePracticeScenario = withAudit('update_practice_scenario', (socket, payload, ack) => {
  const res = practiceScenarios.updateScenario(payload && payload.id, {
    text: payload && payload.text,
    zoeAnswers: payload && payload.zoeAnswers,
    maxAnswers: payload && payload.maxAnswers,
    winner: payload && payload.winner,
  });
  ack(res);
});

const deletePracticeScenario = withAudit('delete_practice_scenario', (socket, payload, ack) => {
  ack(practiceScenarios.deleteScenario(payload && payload.id));
});

// ---------- Audit log (lecture ouverte a tout admin authentifie) ----------

const listAuditLog = requireAdmin((socket, payload, ack) => {
  const limit = Math.min(200, Number(payload && payload.limit) || 100);
  const rows = db.prepare('SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
  ack({ ok: true, entries: rows });
});

// ---------- Journal d'activite joueurs (creation/jonction de partie) ----------

const listActivityLog = requireAdmin((socket, payload, ack) => {
  const limit = Math.min(200, Number(payload && payload.limit) || 100);
  const rows = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
  ack({ ok: true, entries: rows });
});

function isPrivateIp(ip) {
  if (!ip) return true;
  const clean = ip.replace('::ffff:', '');
  return (
    clean === '127.0.0.1' || clean === '::1' || clean === 'unknown' ||
    /^10\./.test(clean) || /^192\.168\./.test(clean) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(clean)
  );
}

// Geolocalisation A LA DEMANDE uniquement (jamais en arriere-plan, jamais
// stockee) : l'admin clique explicitement "localiser" sur UNE entree du
// journal. Service gratuit sans cle (ip-api.com, precision ville, pas de
// tracking individuel — un tiers different par ligne, pas un pisteur
// persistant). Renvoie une position approximative, jamais une adresse exacte.
const geolocateIp = requireAdmin(async (socket, payload, ack, session) => {
  const ip = (payload && payload.ip || '').replace('::ffff:', '');
  if (isPrivateIp(ip)) {
    return ack({ ok: false, error: 'IP locale/privee (reseau interne) : pas de localisation possible.' });
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,city,lat,lon,isp`);
    const data = await res.json();
    if (data.status !== 'success') {
      return ack({ ok: false, error: data.message || 'Localisation indisponible.' });
    }
    audit(session, 'geolocate_ip', ip, null, clientIp(socket));
    ack({ ok: true, city: data.city, country: data.country, lat: data.lat, lon: data.lon, isp: data.isp });
  } catch (e) {
    ack({ ok: false, error: 'Service de localisation indisponible.' });
  }
});

// ---------- Avatars GIF (upload admin) ----------
// Canal : passe par la session admin deja authentifiee (requireAdmin, meme
// garde que toutes les actions admin) et par la connexion Socket.IO du
// site -- chiffree en transit des lors que le site tourne en HTTPS (voir
// Strict-Transport-Security dans server.js), comme le reste du panel admin.
// Pas de "canal" different a inventer : c'est le meme canal admin deja
// protege, il n'y a pas de raison d'en ouvrir un second.
//
// Le fichier envoye n'est JAMAIS execute ni interprete cote serveur : il est
// uniquement (1) valide par signature binaire reelle (magic bytes GIF, pas
// l'extension ni le nom fournis par le client), (2) plafonne en taille,
// (3) ecrit sous un nom entierement controle server-side (jamais le nom
// client tel quel) dans un dossier dedie servi en fichier statique brut par
// Express -- jamais require(), eval(), ni passe a un interpreteur quelconque.
// C'est l'equivalent pratique d'un antivirus pour ce cas precis (un GIF ne
// peut pas "s'executer" cote Node ; le risque reel est un fichier deguise
// qui ne serait pas un GIF, ce que la verification de signature elimine).
// Integrer un vrai moteur antivirus (ex. ClamAV) est possible en plus si
// l'hebergeur le permet, mais nécessite une dépendance externe non presente
// ici -- a activer separement si besoin.
const uploadGifAvatar = withAudit('upload_gif_avatar', (socket, payload, ack) => {
  const id = payload && payload.id;
  const dataBase64 = payload && payload.dataBase64;
  if (typeof dataBase64 !== 'string' || !dataBase64) {
    return ack({ ok: false, error: 'Fichier manquant.' });
  }
  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch (e) {
    return ack({ ok: false, error: 'Fichier illisible.' });
  }
  ack(gifAvatars.saveGifAvatar(id, buffer));
});

const deleteGifAvatar = withAudit('delete_gif_avatar', (socket, payload, ack) => {
  ack(gifAvatars.deleteGifAvatar(payload && payload.id));
});

// ---------- Stats globales (dashboard) ----------

const getStats = requireAdmin((socket, payload, ack) => {
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  const nicknames = db.prepare('SELECT DISTINCT nickname FROM activity_log WHERE nickname IS NOT NULL ORDER BY nickname COLLATE NOCASE').all().map((r) => r.nickname);

  const topWinningCards = cardManager.PACKS
    .flatMap((p) => (cardManager.adminListCards(p.id) || []).map((c) => ({ ...c, packId: p.id, packName: p.name })))
    .filter((c) => c.stats.winCount > 0)
    .sort((a, b) => b.stats.winCount - a.stats.winCount)
    .slice(0, 20)
    .map((c) => ({ text: c.text, packId: c.packId, packName: c.packName, winCount: c.stats.winCount, usageCount: c.stats.usageCount }));

  ack({
    ok: true,
    totalVisits: siteStats.get('visits'),
    totalGamesPlayed: siteStats.get('games_played'),
    onlineNow: gameManager.getOnlineCount(),
    gamesInProgress: games.size,
    totalUsers,
    nicknames,
    topWinningCards,
  });
});

module.exports = {
  login,
  logout,
  whoAmI,
  listGames,
  stopAnyGame,
  pauseGame,
  resumeGame,
  deleteGame,
  joinGameTicket,
  forceNextCard,
  getPacks,
  listCards,
  addCard,
  updateCard,
  deleteCard,
  exportPack,
  importPack,
  listPendingCommunity,
  approveCommunity,
  rejectCommunity,
  listReports,
  dismissReport,
  banAccount,
  unbanAccount,
  listBannedAccounts,
  listAdmins,
  createAdmin,
  updateAdminRole,
  deleteAdmin,
  listAuditLog,
  listActivityLog,
  getAnswerMaxLength,
  setAnswerMaxLength,
  listPracticeScenarios,
  addPracticeScenario,
  updatePracticeScenario,
  deletePracticeScenario,
  geolocateIp,
  getStats,
  uploadGifAvatar,
  deleteGifAvatar,
  setPackDescription,
};
