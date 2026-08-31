'use strict';

const { Game, STATES, RECONNECT_GRACE_MS, JUDGE_SELECTION_MS, NEXT_ROUND_MS, JUDGING_MS, RESULTS_MS } = require('./gameState');
const { Player } = require('./playerManager');
const { fillCard, estimatePoolSize, submitCommunityCard: submitCommunityCardToCatalog, reportCard: reportCardToCatalog, MENTION_TOKEN, cardHasMention } = require('./cardManager');
const siteStats = require('./siteStats');
const cardStats = require('./cardStats');
const { sendPush } = require('./pushManager');
const accountManager = require('./accountManager');
const { getScenarios: getPracticeScenarios, ZOE_NICKNAME, MAX_NICKNAME } = require('./practiceScenarios');
const db = require('./db');
const appSettings = require('./appSettings');

// Journal d'activite (vu par l'admin dans l'onglet Journal) : evenements
// factuels seulement (qui, quoi, quand, IP brute) — jamais de position
// resolue au moment de l'ecriture, la geolocalisation reste a la demande.
// Definie ici mais appelee seulement plus bas (generateId est importe apres
// ce point dans le fichier, voir bloc require('./utils') quelques lignes
// plus loin) : les function declarations sont hissees, donc ok.
function logActivity(eventType, { nickname, gameCode, mode, ip }) {
  try {
    db.prepare(
      'INSERT INTO activity_log (id, event_type, nickname, game_code, mode, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(generateId(), eventType, nickname || null, gameCode || null, mode || null, ip || null, Date.now());
  } catch (e) {
    console.error('Erreur ecriture activity_log:', e);
  }
}

// ---------- Joueurs bots (mode tutoriel / demo) ----------
// Simulent les autres joueurs d'une partie solo : confirment leur carte,
// repondent, votent, avec un petit delai pour ne pas paraitre instantanes.
// Reponses et vainqueur pilotes par des scenarios fixes (practiceScenarios.js) :
// aucun hasard, la demo/tutoriel est identique et reproductible a chaque partie.
// Avatars GIF (voir public/assets/avatars/gif/, meme convention "gif:<id>"
// que les avatars choisis par un vrai joueur) : a deposer soi-meme,
// robot_ok.gif et robot_mdr.gif, deja presents dans le dossier.
const BOT_PROFILES = [
  { nickname: ZOE_NICKNAME, avatar: 'gif:robot_ok' },
  { nickname: MAX_NICKNAME, avatar: 'gif:robot_mdr' },
];

function botDelay(min, max) { return min + Math.floor(Math.random() * (max - min)); }

// Chaque partie de pratique demarre a game.roundNumber=0 (nouvel objet Game
// a chaque fois) : sans decalage, scenarioForRound retomberait toujours sur
// le scenario #1. Ce curseur avance a chaque createPracticeGame pour que
// chaque nouvelle partie/rejeu tombe sur une carte differente des 15.
let practiceScenarioCursor = 0;

// Tutoriel/demo : personne ne doit attendre 15-18s a rien faire entre deux
// manches jouees par des bots, ca donne l'impression que ca a plante. Les
// phases d'attente passive (lecture du resultat, transition) sont raccourcies ;
// le temps de reponse/jugement du joueur humain (ANSWERING/JUDGING) ne change pas.
function judgeSelectionMs(game) { return game.mode ? 1500 : JUDGE_SELECTION_MS; }
function nextRoundMs(game) { return game.mode ? 1500 : NEXT_ROUND_MS; }
function resultsMs(game) { return game.mode ? 6000 : RESULTS_MS; }

// Manche courante -> scenario fixe assigne (cycle sur les 15 si la partie
// dure plus de 15 manches, ce qui n'arrive qu'en mode demo prolonge).
function scenarioForRound(game) {
  const scenarios = getPracticeScenarios();
  const offset = game.practiceScenarioOffset || 0;
  const idx = (offset + game.roundNumber - 1) % scenarios.length;
  return scenarios[idx];
}

// Une partie ne doit jamais rester en vie avec seulement des bots dedans
// (le joueur humain qui l'a lancee est parti) : memes points de sortie que
// "plus personne dans la partie" pour les parties normales.
function noHumansLeft(game) {
  return game.activePlayers().every((p) => p.isBot);
}

function botConfirmCard(game) {
  if (game.state !== STATES.CARD_SELECTION) return;
  if (game.round.blanksChosen !== null) return; // deja confirme (ex: re-armement apres reprise de pause)
  if (cardHasMention(game.round.card.text)) {
    const candidates = game.activePlayers().filter((p) => p.id !== game.round.judgeId);
    const target = candidates.length > 0 ? pickRandom(candidates) : null;
    if (target) {
      game.round.mentionPlayerId = target.id;
      game.round.card = {
        ...game.round.card,
        text: game.round.card.text.split(MENTION_TOKEN).join(target.nickname),
      };
    }
  }
  game.round.blanksChosen = game.round.card.blanksTotal;
  if (!game.mode) cardStats.recordUsage(game.round.card.id, game.round.card.packId);
  beginAnswering(game);
}

function botSubmitAnswer(game, bot) {
  if (game.state !== STATES.ANSWERING) return;
  if (game.round.answers.has(bot.id)) return;
  const scenario = game.round.scenario;
  const answers = (scenario && scenario.botAnswers[bot.nickname])
    ? scenario.botAnswers[bot.nickname].slice(0, game.round.blanksChosen)
    : Array.from({ length: game.round.blanksChosen }, () => 'sans inspiration aujourd\'hui');
  game.round.answers.set(bot.id, answers);
  broadcastState(game);
  const expected = game.connectedActivePlayers().filter((p) => p.id !== game.round.judgeId).length;
  if (game.round.answers.size >= expected && expected > 0) lockAnswers(game);
}

// Choisit le gagnant defini par le scenario fixe de la manche (jamais au
// hasard) : le nickname du scenario doit correspondre a un joueur ayant
// effectivement repondu, sinon on retombe sur la premiere carte de la pile
// (index 0), toujours de facon deterministe.
function botSubmitVote(game) {
  if (game.state !== STATES.JUDGING) return;
  if (!game.round.shuffledOrder || game.round.shuffledOrder.length === 0) return;
  const scenario = game.round.scenario;
  let index = 0;
  if (scenario) {
    const winnerId = scenario.winner === 'human'
      ? [...game.players.values()].find((p) => !p.isBot && !p.kicked)?.id
      : [...game.players.values()].find((p) => p.isBot && p.nickname === scenario.winner)?.id;
    const found = game.round.shuffledOrder.findIndex((e) => e.playerId === winnerId);
    if (found >= 0) index = found;
  }
  resolveJudging(game, index, false);
}

// Notifie un joueur des succes fraichement debloques (aucun effet si aucun,
// ou si le joueur est invite sans compte).
function notifyAchievements(player, achievements) {
  if (!achievements || achievements.length === 0 || !player.socketId) return;
  for (const a of achievements) {
    ioRef.to(player.socketId).emit('achievementUnlocked', { key: a.key, name: a.name, desc: a.desc });
  }
}
const {
  generateGameCode,
  generateId,
  shuffle,
  pickRandom,
  randomInt,
  now,
  cleanRaw,
  sanitizeText,
} = require('./utils');
const {
  isValidNickname,
  cleanNickname,
  normalizePacks,
  isValidVisibility,
  isValidAvatar,
  isValidGameCode,
  isValidAnswerTime,
  isValidWinningScore,
  isValidCardChangesMax,
  isValidAnswerText,
  cleanAnswerText,
  isValidPushEndpoint,
  MIN_PLAYERS,
  MAX_PLAYERS,
} = require('./validation');

const games = new Map(); // code -> Game

// Garde-fous anti-DoS : sans ca, un client peut spammer createGame pour
// epuiser la memoire du serveur (chaque partie alloue joueurs + paquet de
// cartes) et faire tomber le service pour tout le monde.
const MAX_GAMES = 1000;
const CREATE_GAME_LIMIT = 5; // max creations
const CREATE_GAME_WINDOW_MS = 60 * 1000; // par fenetre glissante, par IP
const createGameAttempts = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const list = (createGameAttempts.get(ip) || []).filter((t) => now() - t < CREATE_GAME_WINDOW_MS);
  if (list.length >= CREATE_GAME_LIMIT) {
    createGameAttempts.set(ip, list);
    return true;
  }
  list.push(now());
  createGameAttempts.set(ip, list);
  return false;
}

setInterval(() => {
  const cutoff = now() - CREATE_GAME_WINDOW_MS;
  for (const [ip, list] of createGameAttempts) {
    const kept = list.filter((t) => t > cutoff);
    if (kept.length === 0) createGameAttempts.delete(ip);
    else createGameAttempts.set(ip, kept);
  }
}, 5 * 60 * 1000).unref();

let ioRef = null;

function init(io) {
  ioRef = io;
  // Purge periodique des parties mortes (inactives depuis longtemps, personne connecte).
  setInterval(sweepDeadGames, 5 * 60 * 1000).unref();
}

// Nombre de sockets connectees en ce moment (proxy simple de "personnes en
// ligne", pas de distinction jeu/admin/spectateur) : utilise par le dashboard
// admin (stats). Pas de compteur maison a synchroniser : socket.io le tient
// deja a jour en temps reel.
function getOnlineCount() {
  return ioRef ? ioRef.engine.clientsCount : 0;
}

function sweepDeadGames() {
  const cutoff = now() - 60 * 60 * 1000;
  for (const [code, game] of games) {
    const anyConnected = game.connectedPlayers().length > 0;
    if (!anyConnected && game.lastActivity < cutoff) {
      destroyGame(game);
    }
  }
}

function destroyGame(game) {
  game.clearAllTimers();
  for (const t of game.disconnectTimers.values()) clearTimeout(t);
  games.delete(game.code);
}

// ---------- Diffusion d'etat ----------

function broadcastState(game) {
  game.touch();
  const publicState = game.getPublicState();
  ioRef.to(game.code).emit('gameState', publicState);
  for (const player of game.players.values()) {
    if (player.connected && player.socketId) {
      const priv = game.getPrivateState(player.id);
      ioRef.to(player.socketId).emit('privateState', priv);
    }
  }
}

function sendError(socket, message) {
  socket.emit('errorMessage', { message });
}

// ---------- Creation / Jonction ----------

function createGame(socket, payload, ack) {
  if (games.size >= MAX_GAMES) {
    return ack({ ok: false, error: 'Serveur surcharge, reessaie plus tard.' });
  }
  const ip = socket.handshake.address;
  if (isRateLimited(ip)) {
    return ack({ ok: false, error: 'Trop de parties creees, reessaie dans une minute.' });
  }

  const nickname = cleanNickname(payload && payload.nickname);
  const avatar = payload && payload.avatar;

  if (!isValidNickname(payload && payload.nickname)) {
    return ack({ ok: false, error: 'Pseudo invalide.' });
  }
  if (!isValidAvatar(avatar)) {
    return ack({ ok: false, error: 'Avatar invalide.' });
  }

  const rawSettings = (payload && payload.settings) || {};
  // Le defaut ['normal'] ne s'applique que si le champ est absent : un
  // tableau vide envoye explicitement doit etre rejete, pas silencieusement
  // remplace (sinon un bug client passe inapercu cote serveur).
  const packs = normalizePacks(Array.isArray(rawSettings.packs) ? rawSettings.packs : ['normal']);
  const visibility = isValidVisibility(rawSettings.visibility) ? rawSettings.visibility : 'private';
  const winningScore = isValidWinningScore(rawSettings.winningScore) ? Number(rawSettings.winningScore) : 5;
  const answerTime = isValidAnswerTime(rawSettings.answerTime) ? Number(rawSettings.answerTime) : 30;
  const cardChangesMax = isValidCardChangesMax(rawSettings.cardChangesMax) ? Number(rawSettings.cardChangesMax) : 2;

  if (packs.length === 0 || estimatePoolSize({ packs }) === 0) {
    return ack({ ok: false, error: 'Il faut au moins un pack de cartes contenant des cartes.' });
  }

  let code;
  do {
    code = generateGameCode();
  } while (games.has(code));

  const admin = new Player({ nickname, avatar, isAdmin: true });
  admin.socketId = socket.id;
  admin.accountId = accountManager.resolveAccountId(payload && payload.accountToken);

  // Capture du reglage global au moment de la creation : si le superadmin
  // change le curseur plus tard, cette partie deja en cours garde sa valeur.
  const answerMaxLength = appSettings.getAnswerMaxLength();
  const game = new Game(code, admin, { packs, visibility, winningScore, answerTime, cardChangesMax, answerMaxLength });
  games.set(code, game);

  socket.join(code);
  socket.data.gameCode = code;
  socket.data.playerId = admin.id;

  logActivity('game_created', { nickname, gameCode: code, mode: visibility, ip });
  ack({ ok: true, code, token: admin.token, playerId: admin.id });
  broadcastState(game);
}

// Partie solo contre des bots serveur : tutoriel (avec bulles d'aide cote
// client) ou demo (meme mecanique, sans les bulles). Parametres fixes et
// verrouilles, expliques a l'humain. Reste en LOBBY : les bots rejoignent
// avec un leger delai (voir addPracticeBots), puis l'humain choisit son
// role (juge/joueur) avant de lancer la manche via startGame.
function createPracticeGame(socket, payload, ack) {
  const nickname = cleanNickname(payload && payload.nickname);
  if (!isValidNickname(payload && payload.nickname)) {
    return ack({ ok: false, error: 'Pseudo invalide.' });
  }
  const mode = (payload && payload.mode) === 'demo' ? 'demo' : 'tutorial';

  let code;
  do {
    code = generateGameCode();
  } while (games.has(code));

  const admin = new Player({ nickname, avatar: '😀', isAdmin: true });
  admin.socketId = socket.id;
  admin.accountId = accountManager.resolveAccountId(payload && payload.accountToken);

  // Une seule manche, deroule court et previsible : le but est de montrer
  // le fonctionnement, pas de faire durer la partie.
  const settings = {
    packs: ['normal'],
    visibility: 'private',
    winningScore: 1,
    answerTime: 30,
    cardChangesMax: 1,
    answerMaxLength: appSettings.getAnswerMaxLength(),
  };
  const game = new Game(code, admin, settings);
  game.mode = mode;
  game.practiceScenarioOffset = practiceScenarioCursor;
  practiceScenarioCursor = (practiceScenarioCursor + 1) % getPracticeScenarios().length;
  games.set(code, game);

  socket.join(code);
  socket.data.gameCode = code;
  socket.data.playerId = admin.id;

  logActivity(mode === 'demo' ? 'demo_game_created' : 'tutorial_game_created', {
    nickname, gameCode: code, mode, ip: socket.handshake.address,
  });
  ack({ ok: true, code, token: admin.token, playerId: admin.id });
  broadcastState(game);

  setTimeout(() => addPracticeBots(game), 2000);
}

// Fait rejoindre les 2 bots avec un leger delai apres la creation, pour que
// le lobby explicatif ait le temps de s'afficher avant qu'ils "arrivent".
function addPracticeBots(game) {
  if (!games.has(game.code) || game.state !== STATES.LOBBY) return;
  for (const profile of BOT_PROFILES) {
    const bot = new Player({ nickname: profile.nickname, avatar: profile.avatar, isAdmin: false });
    bot.isBot = true;
    game.players.set(bot.id, bot);
  }
  broadcastState(game);
}

function checkNickname(socket, payload, ack) {
  const game = games.get(payload && payload.code);
  if (!game) return ack({ available: true });
  const clean = cleanNickname(payload && payload.nickname).toLowerCase();
  const taken = game.activePlayers().some((p) => p.nickname.toLowerCase() === clean);
  ack({ available: !taken });
}

function joinGame(socket, payload, ack) {
  const code = (payload && payload.code || '').toUpperCase();
  if (!isValidGameCode(code)) return ack({ ok: false, error: 'Code invalide.' });

  const game = games.get(code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  // Parties tutoriel/demo : strictement solo, jamais rejoignables par un
  // tiers meme avec le code (que le client ne montre de toute facon jamais).
  if (game.mode) return ack({ ok: false, error: 'Partie de démonstration, non accessible.' });
  if (game.state === STATES.STOPPED || game.state === STATES.GAME_OVER) {
    return ack({ ok: false, error: 'Cette partie est terminee.' });
  }
  const joiningMidGame = game.state !== STATES.LOBBY;
  if (game.activePlayers().length >= MAX_PLAYERS) {
    return ack({ ok: false, error: 'Cette partie est pleine.' });
  }
  if (!isValidNickname(payload && payload.nickname)) {
    return ack({ ok: false, error: 'Pseudo invalide.' });
  }
  const nickname = cleanNickname(payload.nickname);
  const nicknameTaken = game.activePlayers().some(
    (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
  );
  if (nicknameTaken) return ack({ ok: false, error: 'Ce pseudo est deja utilise.' });

  if (!isValidAvatar(payload && payload.avatar)) {
    return ack({ ok: false, error: 'Avatar invalide.' });
  }

  const player = new Player({ nickname, avatar: payload.avatar, isAdmin: false });
  player.socketId = socket.id;
  player.accountId = accountManager.resolveAccountId(payload && payload.accountToken);
  player.spectating = joiningMidGame;
  game.players.set(player.id, player);

  socket.join(code);
  socket.data.gameCode = code;
  socket.data.playerId = player.id;

  logActivity('game_joined', { nickname, gameCode: code, mode: game.settings.visibility, ip: socket.handshake.address });
  ack({ ok: true, code, token: player.token, playerId: player.id, spectating: player.spectating });
  broadcastState(game);
}

function reconnectPlayer(socket, payload, ack) {
  const code = (payload && payload.code || '').toUpperCase();
  const token = payload && payload.token;
  const game = games.get(code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });

  const player = game.findByToken(token);
  if (!player || player.kicked) return ack({ ok: false, error: 'Impossible de se reconnecter.' });

  const pendingKick = game.disconnectTimers.get(player.id);
  if (pendingKick) {
    clearTimeout(pendingKick);
    game.disconnectTimers.delete(player.id);
  }

  player.socketId = socket.id;
  player.connected = true;

  socket.join(code);
  socket.data.gameCode = code;
  socket.data.playerId = player.id;

  ack({ ok: true, playerId: player.id });
  broadcastState(game);
}

// ---------- Lobby / Admin ----------

function requireAdmin(game, playerId) {
  return game.adminId === playerId;
}

function updateSettings(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (!requireAdmin(game, socket.data.playerId)) return ack({ ok: false, error: 'Reserve a l\'admin.' });
  if (game.state !== STATES.LOBBY) return ack({ ok: false, error: 'Parametres verrouilles.' });

  const s = (payload && payload.settings) || {};
  if (Array.isArray(s.packs)) {
    const nextPacks = normalizePacks(s.packs);
    if (nextPacks.length === 0 || estimatePoolSize({ packs: nextPacks }) === 0) {
      return ack({ ok: false, error: 'Il faut au moins un pack de cartes contenant des cartes.' });
    }
    game.settings.packs = nextPacks;
  }
  if (isValidVisibility(s.visibility)) game.settings.visibility = s.visibility;
  if (isValidWinningScore(s.winningScore)) game.settings.winningScore = Number(s.winningScore);
  if (isValidAnswerTime(s.answerTime)) game.settings.answerTime = Number(s.answerTime);
  if (isValidCardChangesMax(s.cardChangesMax)) game.settings.cardChangesMax = Number(s.cardChangesMax);

  ack({ ok: true });
  broadcastState(game);
}

function kickPlayer(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (!requireAdmin(game, socket.data.playerId)) return ack({ ok: false, error: 'Reserve a l\'admin.' });

  const target = game.getPlayer(payload && payload.playerId);
  if (!target || target.id === game.adminId) return ack({ ok: false, error: 'Cible invalide.' });

  target.kicked = true;
  clearDisconnectTimer(game, target.id);
  if (target.socketId) {
    ioRef.to(target.socketId).emit('kicked', { reason: 'Tu as ete expulse de la partie.' });
    const targetSocket = ioRef.sockets.sockets.get(target.socketId);
    if (targetSocket) targetSocket.leave(game.code);
  }

  ack({ ok: true });
  handlePlayerRemovalConsequences(game, target.id);
  broadcastState(game);
}

function stopGame(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (!requireAdmin(game, socket.data.playerId)) return ack({ ok: false, error: 'Reserve a l\'admin.' });

  game.clearAllTimers();
  game.state = STATES.STOPPED;
  ack({ ok: true });
  broadcastState(game);
  setTimeout(() => destroyGame(game), 30 * 1000);
}

// ---------- Controles reserves au dashboard admin plateforme (pas l'admin
// de partie) : pause/reprise, suppression immediate, rejoindre en spectateur.
// Appeles directement par adminManager.js avec l'objet Game (deja recupere
// via son propre requireAdmin), pas par un joueur via socket.

const PAUSABLE_STATES = new Set([
  STATES.JUDGE_SELECTION, STATES.CARD_SELECTION, STATES.ANSWERING,
  STATES.JUDGING, STATES.RESULTS, STATES.NEXT_ROUND,
]);

function pauseGame(game) {
  if (game.paused) return { ok: false, error: 'Deja en pause.' };
  if (!PAUSABLE_STATES.has(game.state)) return { ok: false, error: 'Partie non pausable dans cet etat.' };
  game.clearAllTimers();
  game.pausedFromState = game.state;
  game.state = STATES.PAUSED;
  game.paused = true;
  broadcastState(game);
  return { ok: true };
}

// Reprend une manche en pause : le juge/les joueurs beneficient d'un chrono
// complet frais pour la phase en cours (pas d'un decompte au ms pres du
// temps restant avant la pause, plus simple et sans zone grise).
function resumeGame(game) {
  if (!game.paused) return { ok: false, error: 'N\'est pas en pause.' };
  const target = game.pausedFromState;
  game.paused = false;
  game.pausedFromState = null;

  switch (target) {
    case STATES.JUDGE_SELECTION: {
      game.state = STATES.JUDGE_SELECTION;
      const ms = judgeSelectionMs(game);
      game.round.judgeSelectionEndsAt = now() + ms;
      broadcastState(game);
      game.timers.judgeSelection = setTimeout(() => beginCardSelection(game), ms);
      break;
    }
    case STATES.CARD_SELECTION: {
      game.state = STATES.CARD_SELECTION;
      broadcastState(game);
      const judge = game.getPlayer(game.round.judgeId);
      if (judge && judge.isBot) setTimeout(() => botConfirmCard(game), botDelay(1400, 2600));
      break;
    }
    case STATES.ANSWERING:
      beginAnswering(game); // idempotent : botSubmitAnswer/lockAnswers verifient l'etat deja soumis
      break;
    case STATES.JUDGING:
      beginJudging(game); // idempotent : le vote n'a pas encore eu lieu si on etait en pause
      break;
    case STATES.RESULTS: {
      game.state = STATES.RESULTS;
      broadcastState(game);
      const ms = resultsMs(game);
      game.timers.results = setTimeout(() => afterResults(game), ms);
      break;
    }
    case STATES.NEXT_ROUND: {
      game.state = STATES.NEXT_ROUND;
      const ms = nextRoundMs(game);
      game.round.nextRoundEndsAt = now() + ms;
      broadcastState(game);
      game.timers.nextRound = setTimeout(() => beginCardSelection(game), ms);
      break;
    }
    default:
      game.state = target || STATES.LOBBY;
      broadcastState(game);
  }
  return { ok: true };
}

// Suppression immediate (contrairement a stopGame, pas de delai de grace de
// 30s) : notifie tout le monde puis detruit la partie sur-le-champ.
function deleteGameNow(game) {
  game.clearAllTimers();
  for (const p of game.activePlayers()) {
    if (!p.socketId) continue;
    ioRef.to(p.socketId).emit('kicked', { reason: 'Partie supprimee par un administrateur.' });
    const s = ioRef.sockets.sockets.get(p.socketId);
    if (s) s.leave(game.code);
  }
  games.delete(game.code);
  return { ok: true };
}

// Tickets a usage unique et courte duree de vie : le dashboard admin ouvre un
// nouvel onglet vers l'appli joueur avec ce ticket dans l'URL, qui l'echange
// contre une place de spectateur (jamais d'acces direct sans passer par une
// session admin deja authentifiee cote serveur).
const adminJoinTickets = new Map(); // ticket -> { code, email, expiresAt }
const ADMIN_JOIN_TICKET_TTL_MS = 2 * 60 * 1000;

function createAdminJoinTicket(code, email) {
  const ticket = generateId();
  adminJoinTickets.set(ticket, { code, email, expiresAt: Date.now() + ADMIN_JOIN_TICKET_TTL_MS });
  return ticket;
}

function joinGameAsAdmin(socket, payload, ack) {
  const ticket = payload && payload.ticket;
  const entry = adminJoinTickets.get(ticket);
  if (!entry) return ack({ ok: false, error: 'Lien invalide ou expire.' });
  adminJoinTickets.delete(ticket);
  if (Date.now() > entry.expiresAt) return ack({ ok: false, error: 'Lien expire.' });

  const game = games.get(entry.code);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });

  const joiningMidGame = game.state !== STATES.LOBBY;
  const player = new Player({ nickname: `👑 ${entry.email.split('@')[0]}`, avatar: '👑', isAdmin: false });
  player.isPlatformAdmin = true;
  player.socketId = socket.id;
  player.spectating = joiningMidGame;
  game.players.set(player.id, player);

  socket.join(game.code);
  socket.data.gameCode = game.code;
  socket.data.playerId = player.id;

  ack({ ok: true, code: game.code, token: player.token, playerId: player.id, spectating: player.spectating });
  broadcastState(game);
}

// Message d'ambiance diffuse a toute la partie (depart, etc.) : pas un vrai
// message de chat (pas d'auteur), affiche distinctement cote client.
function broadcastSystemMessage(game, text) {
  ioRef.to(game.code).emit('chatMessage', {
    id: generateId(),
    scope: 'general',
    isSystem: true,
    text,
    sentAt: now(),
  });
}

function leaveGame(socket) {
  const game = games.get(socket.data.gameCode);
  if (!game) return;
  const player = game.getPlayer(socket.data.playerId);
  if (!player) return;

  // Sans ca, le socket reste abonne a la room Socket.IO de la partie : il
  // continuerait a recevoir les gameState/privateState diffuses aux joueurs
  // restants, ce qui ecraserait l'etat local du client (deja revenu au menu)
  // avec une partie a laquelle il n'appartient plus.
  socket.leave(game.code);
  socket.data.gameCode = null;
  socket.data.playerId = null;

  if (game.state === STATES.LOBBY) {
    game.players.delete(player.id);
    if (player.id === game.adminId) reassignAdmin(game);
    broadcastState(game);
    if (noHumansLeft(game)) destroyGame(game);
    return;
  }

  // Un depart explicite (contrairement a une deconnexion reseau) est
  // definitif et immediat : pas de periode de grace, la partie s'adapte tout
  // de suite (le juge est libere si c'etait lui, la manche continue sans ce
  // joueur, sa reponse eventuelle est retiree du jugement).
  clearDisconnectTimer(game, player.id);
  const nickname = player.nickname;

  if (game.state === STATES.ANSWERING) {
    if (game.round.answers.has(player.id)) {
      game.round.answers.delete(player.id);
      broadcastSystemMessage(game, `${nickname} a quitté la partie. Sa carte a été retirée de la manche.`);
    } else if (player.id !== game.round.judgeId) {
      broadcastSystemMessage(game, `${nickname} a quitté la partie pendant qu'il écrivait sa carte.`);
    } else {
      broadcastSystemMessage(game, `${nickname} a quitté la partie.`);
    }
  } else {
    broadcastSystemMessage(game, `${nickname} a quitté la partie.`);
  }

  game.players.delete(player.id);
  handlePlayerRemovalConsequences(game, player.id);

  if (noHumansLeft(game)) {
    destroyGame(game);
    return;
  }

  broadcastState(game);

  // Si ce depart faisait tomber le compte de reponses attendues au niveau
  // atteint, la manche doit pouvoir continuer sans attendre le chrono.
  if (game.state === STATES.ANSWERING) {
    const expected = game.connectedActivePlayers().filter((p) => p.id !== game.round.judgeId).length;
    if (expected > 0 && game.round.answers.size >= expected) {
      lockAnswers(game);
    }
  }
}

function reassignAdmin(game) {
  const candidates = game.activePlayers();
  if (candidates.length === 0) return;
  const next = candidates.sort((a, b) => a.joinedAt - b.joinedAt)[0];
  game.adminId = next.id;
  next.isAdmin = true;
}

// ---------- Lancement de partie ----------

function startGame(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (!requireAdmin(game, socket.data.playerId)) return ack({ ok: false, error: 'Reserve a l\'admin.' });
  if (game.state !== STATES.LOBBY) return ack({ ok: false, error: 'Deja lancee.' });

  if (game.mode) {
    // Tutoriel/demo : role choisi explicitement par l'humain (pas de hasard).
    // 'judge' -> l'humain juge la 1ere manche ; 'player' -> un bot juge et
    // l'humain repond, comme les autres joueurs.
    const bots = game.activePlayers().filter((p) => p.isBot);
    if (bots.length < 2) return ack({ ok: false, error: 'Les bots ne sont pas encore arrives.' });
    const role = (payload && payload.role) === 'judge' ? 'judge' : 'player';
    const forcedJudgeId = role === 'judge' ? socket.data.playerId : bots[0].id;
    ack({ ok: true });
    beginJudgeSelection(game, true, forcedJudgeId);
    return;
  }

  if (game.activePlayers().length < MIN_PLAYERS) {
    return ack({ ok: false, error: `Il faut au moins ${MIN_PLAYERS} joueurs.` });
  }

  try {
    game.startNewDeckIfNeeded();
  } catch (e) {
    return ack({ ok: false, error: e.message });
  }

  ack({ ok: true });
  beginJudgeSelection(game, true);
}

function beginJudgeSelection(game, isFirstRound, forcedJudgeId) {
  game.clearAllTimers();
  game.roundNumber += 1;

  let judgeId;
  if (isFirstRound && forcedJudgeId) {
    judgeId = forcedJudgeId;
  } else if (isFirstRound) {
    const candidates = game.connectedActivePlayers();
    judgeId = candidates.length > 0 ? pickRandom(candidates).id : pickRandom(game.activePlayers()).id;
  } else {
    judgeId = game.round.judgeId;
  }

  game.round = {
    judgeId,
    card: null,
    rerollsUsed: 0,
    blanksChosen: null,
    answers: new Map(), // playerId -> array de reponses
    shuffledOrder: [], // [{playerId, filledText}]
    judgeSelectionEndsAt: now() + judgeSelectionMs(game),
    answeringEndsAt: null,
    judgingEndsAt: null,
    nextRoundEndsAt: null,
    result: null,
  };

  game.state = STATES.JUDGE_SELECTION;
  broadcastState(game);

  game.timers.judgeSelection = setTimeout(() => beginCardSelection(game), judgeSelectionMs(game));
}

function beginCardSelection(game) {
  game.clearTimer('judgeSelection');
  game.clearTimer('nextRound');

  // Les joueurs ayant rejoint en cours de manche precedente participent
  // desormais a partir de cette nouvelle manche.
  for (const p of game.players.values()) p.spectating = false;

  const judgeId = game.round.judgeId;
  let card;
  let scenario = null;
  if (game.mode) {
    // Tutoriel/demo : carte fixe du scenario de la manche, aucun tirage aleatoire.
    scenario = scenarioForRound(game);
    card = { id: `practice-${game.roundNumber}`, text: scenario.text, blanksTotal: scenario.blanksTotal, packId: 'practice' };
  } else {
    // Un admin peut avoir force une carte precise (dashboard) : elle remplace
    // le tirage aleatoire initial pour cette manche, une seule fois.
    card = game.forcedNextCard || game.deck.draw();
    game.forcedNextCard = null;
  }

  game.round = {
    judgeId,
    card,
    scenario,
    rerollsUsed: 0,
    blanksChosen: null,
    mentionPlayerId: null,
    answers: new Map(),
    shuffledOrder: [],
    judgeSelectionEndsAt: null,
    answeringEndsAt: null,
    judgingEndsAt: null,
    nextRoundEndsAt: null,
    result: null,
  };
  game.state = STATES.CARD_SELECTION;
  broadcastState(game);

  const judge = game.getPlayer(judgeId);
  if (judge) {
    notifyAchievements(judge, accountManager.recordJudgeTurn(judge.accountId));
    if (judge.pushSubscription) {
      sendPush(judge.pushSubscription, {
        title: 'À toi de juger !',
        body: `C'est ton tour dans la partie ${game.code}.`,
      });
    }
    if (judge.isBot) {
      setTimeout(() => botConfirmCard(game), botDelay(1400, 2600));
    }
  }
}

function pushSubscribe(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  const player = game.getPlayer(socket.data.playerId);
  if (!player) return ack({ ok: false, error: 'Joueur introuvable.' });
  const sub = payload && payload.subscription;
  if (!sub || !isValidPushEndpoint(sub.endpoint)) return ack({ ok: false, error: 'Abonnement invalide.' });
  player.pushSubscription = sub;
  ack({ ok: true });
}

// Le juge demande une autre carte ayant precisement ce nombre de trous.
// Limite configuree par l'admin a la creation de la partie (settings.cardChangesMax).
function rerollCard(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (game.state !== STATES.CARD_SELECTION) return ack({ ok: false, error: 'Etat invalide.' });
  if (game.round.judgeId !== socket.data.playerId) return ack({ ok: false, error: 'Seul le juge choisit.' });
  if (game.mode) return ack({ ok: false, error: 'Carte fixe en mode tutoriel/demo.' });
  if (game.round.rerollsUsed >= game.settings.cardChangesMax) {
    return ack({ ok: false, error: 'Plus aucun changement disponible.' });
  }

  const blanksTotal = Number(payload && payload.blanksTotal);
  if (![1, 2, 3].includes(blanksTotal)) {
    return ack({ ok: false, error: 'Nombre de trous invalide.' });
  }
  if (blanksTotal === game.round.card.blanksTotal) {
    return ack({ ok: false, error: 'La carte actuelle a deja ce nombre de trous.' });
  }

  const newCard = game.deck.drawByBlanks(blanksTotal);
  if (!newCard) {
    return ack({ ok: false, error: 'Aucune carte disponible avec ce nombre de trous.' });
  }

  game.round.card = newCard;
  game.round.rerollsUsed += 1;
  game.round.mentionPlayerId = null;
  ack({ ok: true });
  broadcastState(game);
}

// Verrouille la carte affichee et lance la phase de reponse.
function confirmCard(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (game.state !== STATES.CARD_SELECTION) return ack({ ok: false, error: 'Etat invalide.' });
  if (game.round.judgeId !== socket.data.playerId) return ack({ ok: false, error: 'Seul le juge choisit.' });

  // Carte qui mentionne un joueur ("...pour la mere de {user}.") : le juge
  // doit designer la cible AVANT de verrouiller la carte, sinon le texte
  // envoye a tous garderait le token brut illisible.
  if (cardHasMention(game.round.card.text)) {
    const targetId = payload && payload.mentionPlayerId;
    const target = targetId ? game.getPlayer(targetId) : null;
    if (!target) return ack({ ok: false, error: 'Choisis qui mentionner dans la carte.' });
    if (target.id === game.round.judgeId) return ack({ ok: false, error: 'Tu ne peux pas te mentionner toi-même.' });
    game.round.mentionPlayerId = target.id;
    game.round.card = {
      ...game.round.card,
      text: game.round.card.text.split(MENTION_TOKEN).join(target.nickname),
    };
  }

  game.round.blanksChosen = game.round.card.blanksTotal;
  if (!game.mode) cardStats.recordUsage(game.round.card.id, game.round.card.packId);
  ack({ ok: true });
  beginAnswering(game);
}

function beginAnswering(game) {
  game.state = STATES.ANSWERING;
  game.round.answeringEndsAt = now() + game.settings.answerTime * 1000;
  game.round.answeringStartedAt = now();
  broadcastState(game);
  game.timers.answering = setTimeout(() => lockAnswers(game), game.settings.answerTime * 1000);

  // En pratique, delai fixe (~5s) plutot que le delai large habituel : plus
  // previsible pour l'utilisateur qui observe/attend la reponse des bots.
  const answerDelay = game.mode ? botDelay(4800, 5200) : botDelay(1200, 4000);
  for (const bot of game.connectedActivePlayers().filter((p) => p.isBot && p.id !== game.round.judgeId)) {
    setTimeout(() => botSubmitAnswer(game, bot), answerDelay);
  }
}

function submitAnswer(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (game.state !== STATES.ANSWERING) return ack({ ok: false, error: 'Etat invalide.' });

  const playerId = socket.data.playerId;
  if (playerId === game.round.judgeId) return ack({ ok: false, error: 'Le juge ne repond pas.' });
  const player = game.getPlayer(playerId);
  if (player && player.spectating) return ack({ ok: false, error: 'Tu rejoins à la prochaine manche.' });
  // Une reponse peut etre corrigee tant que le temps n'est pas ecoule (on
  // remplace simplement l'entree precedente, pas de blocage a la 1ere frappe).
  if (now() >= game.round.answeringEndsAt) return ack({ ok: false, error: 'Temps ecoule.' });

  const answers = payload && payload.answers;
  if (!Array.isArray(answers) || answers.length !== game.round.blanksChosen) {
    return ack({ ok: false, error: 'Nombre de reponses incorrect.' });
  }
  const maxLen = game.settings.answerMaxLength;
  if (answers.some((a) => !isValidAnswerText(a, maxLen))) {
    return ack({ ok: false, error: `Reponse invalide, vide ou trop longue (max ${maxLen} caracteres).` });
  }
  const cleaned = answers.map((a) => cleanAnswerText(a, maxLen));
  const isFirstSubmit = !game.round.answers.has(playerId);

  game.round.answers.set(playerId, cleaned);
  ack({ ok: true });

  if (isFirstSubmit) {
    if (!game.mode) cardStats.recordResponseTime(game.round.card.id, game.round.card.packId, now() - game.round.answeringStartedAt);
  }

  // XP uniquement au premier envoi de la manche : modifier sa reponse ne
  // doit pas permettre de farmer de l'XP en renvoyant en boucle.
  if (isFirstSubmit && player) {
    notifyAchievements(player, accountManager.recordAnswer(player.accountId));
  }

  broadcastState(game);

  const expected = game.connectedActivePlayers().filter((p) => p.id !== game.round.judgeId).length;
  if (game.round.answers.size >= expected && expected > 0) {
    lockAnswers(game);
  }
}

function lockAnswers(game) {
  if (game.state !== STATES.ANSWERING) return;
  game.clearTimer('answering');

  // Les joueurs n'ayant pas repondu a temps recoivent une reponse vide neutre
  // afin de garder une manche coherente sans les eliminer de la partie.
  for (const player of game.connectedActivePlayers()) {
    if (player.id === game.round.judgeId) continue;
    if (!game.round.answers.has(player.id)) {
      const filler = new Array(game.round.blanksChosen).fill('(pas de reponse)');
      game.round.answers.set(player.id, filler);
    }
  }

  const entries = [...game.round.answers.entries()].map(([playerId, answers]) => ({
    playerId,
    answers,
    filledText: fillCard(game.round.card.text, answers),
  }));

  // Personne n'a pu repondre (tout le monde deconnecte/spectateur) : rien a
  // juger. On relance une manche fraiche plutot que de planter sur un
  // jugement vide.
  if (entries.length === 0) {
    if (game.activePlayers().length < MIN_PLAYERS) {
      game.clearAllTimers();
      game.state = STATES.STOPPED;
      broadcastState(game);
    } else {
      beginJudgeSelection(game, true);
    }
    return;
  }

  game.round.shuffledOrder = shuffle(entries);

  beginJudging(game);
}

function beginJudging(game) {
  game.state = STATES.JUDGING;
  game.round.judgingEndsAt = now() + JUDGING_MS;
  broadcastState(game);

  const judge = game.getPlayer(game.round.judgeId);
  if (judge && judge.isBot) {
    setTimeout(() => botSubmitVote(game), botDelay(1800, 3500));
  }

  game.timers.judging = setTimeout(() => {
    if (!game.round.shuffledOrder || game.round.shuffledOrder.length === 0) return;
    const autoIndex = randomInt(0, game.round.shuffledOrder.length - 1);
    resolveJudging(game, autoIndex, true);
  }, JUDGING_MS);
}

function submitVote(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (game.state !== STATES.JUDGING) return ack({ ok: false, error: 'Etat invalide.' });
  if (game.round.judgeId !== socket.data.playerId) return ack({ ok: false, error: 'Seul le juge vote.' });

  const index = Number(payload && payload.answerIndex);
  if (!Number.isInteger(index) || index < 0 || index >= game.round.shuffledOrder.length) {
    return ack({ ok: false, error: 'Choix invalide.' });
  }

  ack({ ok: true });
  resolveJudging(game, index, false);
}

function resolveJudging(game, index, wasAuto) {
  if (game.state !== STATES.JUDGING) return;
  game.clearTimer('judging');

  const winnerEntry = game.round.shuffledOrder[index];
  const winner = game.getPlayer(winnerEntry.playerId);
  if (winner) {
    winner.score += 1;
    notifyAchievements(winner, accountManager.recordRoundWin(winner.accountId));
  }
  if (!game.mode) cardStats.recordWin(game.round.card.id, game.round.card.packId);

  const others = game.round.shuffledOrder
    .filter((e) => e.playerId !== winnerEntry.playerId)
    .map((e) => {
      const p = game.getPlayer(e.playerId);
      return { playerId: e.playerId, nickname: p ? p.nickname : '?', avatar: p ? p.avatar : '?', filledText: e.filledText, answers: e.answers };
    });

  game.round.result = {
    winnerId: winnerEntry.playerId,
    winnerNickname: winner ? winner.nickname : '?',
    winnerAvatar: winner ? winner.avatar : '?',
    filledText: winnerEntry.filledText,
    answers: winnerEntry.answers,
    cardText: game.round.card.text,
    wasAuto,
    others,
  };

  game.state = STATES.RESULTS;
  game.round.resultsEndsAt = now() + resultsMs(game);
  broadcastState(game);

  game.timers.results = setTimeout(() => afterResults(game), resultsMs(game));
}

// Permet a l'admin de la partie (le createur, pas un admin plateforme) de
// passer immediatement l'attente de la manche suivante ou l'ecran de
// resultats, sans devoir subir le delai fixe -- utile quand tout le monde a
// deja vu/valide, pas la peine d'attendre le chrono pour rien.
function skipResultsWait(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (game.adminId !== socket.data.playerId) return ack({ ok: false, error: "Seul l'hôte de la partie peut passer." });
  if (game.state !== STATES.RESULTS) return ack({ ok: false, error: 'Étape invalide.' });
  ack({ ok: true });
  afterResults(game);
}

function afterResults(game) {
  game.clearTimer('results');
  const winner = game.getPlayer(game.round.result.winnerId);
  const reachedTarget = winner && winner.score >= game.settings.winningScore;

  if (reachedTarget) {
    if (winner) accountManager.recordGameWin(winner.accountId);
    siteStats.increment('games_played');
    game.state = STATES.GAME_OVER;
    game.clearAllTimers();
    broadcastState(game);
    return;
  }

  game.round.judgeId = game.round.result.winnerId;
  const ms = nextRoundMs(game);
  game.round.nextRoundEndsAt = now() + ms;
  game.state = STATES.NEXT_ROUND;
  broadcastState(game);

  game.timers.nextRound = setTimeout(() => beginCardSelection(game), ms);
  game.roundNumber += 1;
}

function playAgain(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  if (!requireAdmin(game, socket.data.playerId)) return ack({ ok: false, error: 'Reserve a l\'admin.' });
  if (game.state !== STATES.GAME_OVER) return ack({ ok: false, error: 'Etat invalide.' });

  game.clearAllTimers();
  for (const p of game.players.values()) p.score = 0;
  game.round = null;
  game.roundNumber = 0;
  game.deck = null;
  game.state = STATES.LOBBY;

  ack({ ok: true });
  broadcastState(game);
}

// ---------- Deconnexion ----------

function clearDisconnectTimer(game, playerId) {
  const t = game.disconnectTimers.get(playerId);
  if (t) {
    clearTimeout(t);
    game.disconnectTimers.delete(playerId);
  }
}

function scheduleDisconnectCleanup(game, playerId) {
  clearDisconnectTimer(game, playerId);
  const timer = setTimeout(() => {
    game.disconnectTimers.delete(playerId);
    const player = game.getPlayer(playerId);
    if (!player || player.connected) return;
    game.players.delete(playerId);
    handlePlayerRemovalConsequences(game, playerId);
    if (noHumansLeft(game)) {
      destroyGame(game);
    } else {
      broadcastState(game);
    }
  }, RECONNECT_GRACE_MS);
  game.disconnectTimers.set(playerId, timer);
}

// Reaffecte admin/juge si le joueur retire tenait un de ces roles.
function handlePlayerRemovalConsequences(game, removedPlayerId) {
  if (game.adminId === removedPlayerId) {
    reassignAdmin(game);
  }

  if (game.state === STATES.LOBBY || game.state === STATES.STOPPED || game.state === STATES.GAME_OVER) {
    return;
  }

  if (game.round && game.round.judgeId === removedPlayerId) {
    // Le juge est parti definitivement en pleine manche : on relance une
    // selection de juge aleatoire pour eviter un blocage de partie.
    if (game.activePlayers().length < MIN_PLAYERS) {
      game.clearAllTimers();
      game.state = STATES.STOPPED;
      return;
    }
    beginJudgeSelection(game, true);
  }
}

function handleDisconnect(socket) {
  const game = games.get(socket.data.gameCode);
  if (!game) return;
  const player = game.getPlayer(socket.data.playerId);
  if (!player || player.socketId !== socket.id) return;

  // Une deconnexion (perte reseau, onglet mis en veille par le navigateur...)
  // n'est jamais volontaire : on garde toujours une periode de grace avant de
  // retirer le joueur, LOBBY inclus. Seul un depart explicite (leaveGame) ou
  // une expulsion retire un joueur immediatement.
  player.connected = false;
  scheduleDisconnectCleanup(game, player.id);
  broadcastState(game);
}

// ---------- Parties publiques ----------

function listPublicGames(socket, payload, ack) {
  const list = [...games.values()]
    .filter((g) => g.settings.visibility === 'public' && (g.state === STATES.LOBBY))
    .map((g) => ({
      code: g.code,
      playerCount: g.activePlayers().length,
      maxPlayers: 20,
      packs: g.settings.packs,
    }));
  ack({ ok: true, games: list });
}

// ---------- Deck communautaire (soumission joueur) ----------

const COMMUNITY_SUBMIT_LIMIT = 5;
const COMMUNITY_SUBMIT_WINDOW_MS = 10 * 60 * 1000;
const communitySubmitAttempts = new Map(); // playerId -> [timestamps]

function submitCommunityCard(socket, payload, ack) {
  const playerId = socket.data.playerId;
  if (!playerId) return ack({ ok: false, error: 'Rejoins une partie avant de proposer une carte.' });

  const list = (communitySubmitAttempts.get(playerId) || []).filter((t) => now() - t < COMMUNITY_SUBMIT_WINDOW_MS);
  if (list.length >= COMMUNITY_SUBMIT_LIMIT) {
    return ack({ ok: false, error: 'Trop de propositions recentes, reessaie plus tard.' });
  }

  const game = games.get(socket.data.gameCode);
  const player = game ? game.getPlayer(playerId) : null;
  const text = cleanRaw(payload && payload.text, 300);
  const result = submitCommunityCardToCatalog(text, {
    nickname: player ? player.nickname : 'Anonyme',
    accountId: player ? player.accountId : null,
  });
  if (result.ok) {
    list.push(now());
    communitySubmitAttempts.set(playerId, list);
  }
  ack(result);
}

// ---------- Signalement de carte ----------

function reportCard(socket, payload, ack) {
  const { packId, cardId, reason } = payload || {};
  ack(reportCardToCatalog(packId, cardId, cleanRaw(reason, 300)));
}

// ---------- Chat (general par partie + messages prives entre joueurs) ----------

const CHAT_MAX_LEN = 300;
const CHAT_RATE_MS = 800; // 1 message max toutes les 800ms par joueur
const lastChatAt = new Map(); // playerId -> timestamp

// ---------- Reactions rapides (ephemeres, pas de persistance/historique) ----------
// Volontairement pas de limite de frequence : c'est un defouloir purement
// visuel (aucune ecriture en base, aucun cout reel), le spam fait partie de
// l'experience voulue plutot qu'un abus a freiner.

const REACTION_EMOJIS = new Set(['😂', '😭', '🔥', '💀', '👏', '😱']);

function sendReaction(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  const sender = game.getPlayer(socket.data.playerId);
  if (!sender) return ack({ ok: false, error: 'Joueur introuvable.' });

  const emoji = payload && payload.emoji;
  if (!REACTION_EMOJIS.has(emoji)) return ack({ ok: false, error: 'Réaction invalide.' });

  ioRef.to(game.code).emit('reaction', { emoji, fromNickname: sender.nickname, fromAvatar: sender.avatar });
  ack({ ok: true });
}

function chatSend(socket, payload, ack) {
  const game = games.get(socket.data.gameCode);
  if (!game) return ack({ ok: false, error: 'Partie introuvable.' });
  const sender = game.getPlayer(socket.data.playerId);
  if (!sender) return ack({ ok: false, error: 'Joueur introuvable.' });

  const lastAt = lastChatAt.get(sender.id) || 0;
  if (now() - lastAt < CHAT_RATE_MS) {
    return ack({ ok: false, error: 'Trop de messages, ralentis un peu.' });
  }

  // sanitizeText (pas cleanRaw) : le texte est diffuse tel quel aux autres
  // clients et insere en HTML, il doit donc etre echappe a la source.
  const text = sanitizeText(payload && payload.text, CHAT_MAX_LEN);
  if (!text) return ack({ ok: false, error: 'Message vide.' });

  const scope = payload && payload.scope === 'private' ? 'private' : 'general';
  const message = {
    id: generateId(),
    scope,
    fromId: sender.id,
    fromNickname: sender.nickname,
    fromAvatar: sender.avatar,
    text,
    sentAt: now(),
  };

  if (scope === 'general') {
    ioRef.to(game.code).emit('chatMessage', message);
  } else {
    const toId = payload && payload.toPlayerId;
    const target = game.getPlayer(toId);
    if (!target) return ack({ ok: false, error: 'Destinataire introuvable.' });
    message.toId = target.id;
    if (target.socketId) ioRef.to(target.socketId).emit('chatMessage', message);
    if (sender.socketId) ioRef.to(sender.socketId).emit('chatMessage', message);
  }

  lastChatAt.set(sender.id, now());
  ack({ ok: true });
}

module.exports = {
  init,
  games,
  getOnlineCount,
  createGame,
  createPracticeGame,
  checkNickname,
  joinGame,
  reconnectPlayer,
  updateSettings,
  kickPlayer,
  stopGame,
  leaveGame,
  startGame,
  rerollCard,
  confirmCard,
  submitAnswer,
  submitVote,
  skipResultsWait,
  playAgain,
  handleDisconnect,
  broadcastState,
  listPublicGames,
  submitCommunityCard,
  reportCard,
  chatSend,
  sendReaction,
  pushSubscribe,
  pauseGame,
  resumeGame,
  deleteGameNow,
  createAdminJoinTicket,
  joinGameAsAdmin,
};
