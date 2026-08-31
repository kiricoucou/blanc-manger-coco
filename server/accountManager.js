'use strict';

const { timingSafeEqual, scryptSync, randomBytes } = require('crypto');
const db = require('./db');
const { generateId, cleanRaw } = require('./utils');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const sessions = new Map(); // token -> { accountId, expiresAt }
const onlineAccounts = new Map(); // accountId -> Set<socketId>

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const PASSWORD_MIN = 6;

// ---------- Definitions XP / niveaux / succes ----------

function levelForXp(xp) {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

const XP_ANSWER = 5;
const XP_ROUND_WIN = 20;
const XP_GAME_WIN = 50;

const ACHIEVEMENTS = [
  { key: 'first_answer', name: 'Premiers mots', desc: 'Envoyer une première réponse.', check: (a) => a.answer_count >= 1 },
  { key: 'hundred_answers', name: 'Plume infatigable', desc: 'Envoyer 100 réponses.', check: (a) => a.answer_count >= 100 },
  { key: 'first_win', name: 'Première victoire', desc: 'Gagner une manche.', check: (a) => a.wins >= 1 },
  { key: 'five_wins', name: 'Habitué du podium', desc: 'Gagner 5 manches.', check: (a) => a.wins >= 5 },
  { key: 'ten_wins', name: 'Légende de la table', desc: 'Gagner 10 manches.', check: (a) => a.wins >= 10 },
  { key: 'judge_ten', name: 'Œil de juge', desc: 'Être juge 10 fois.', check: (a) => a.judge_count >= 10 },
];

// ---------- Utilitaires mot de passe (meme schema que l'admin) ----------

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHex) {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function isValidUsername(raw) {
  const clean = cleanRaw(raw, USERNAME_MAX);
  return /^[a-zA-Z0-9_]{3,20}$/.test(clean) && clean.length >= USERNAME_MIN;
}

// ---------- Comptes ----------

function register(socket, payload, ack) {
  const username = cleanRaw(payload && payload.username, USERNAME_MAX);
  const password = payload && payload.password;

  // Majorite numerique (RGPD, France : 15 ans pour consentir seul au
  // traitement de ses donnees) : declaratif, comme la certification 18+ des
  // packs de cartes adultes -- pas de verification d'identite possible, mais
  // pas de compte cree sans cette case cochee explicitement.
  if (payload && payload.age15Confirmed !== true) {
    return ack({ ok: false, error: 'Tu dois confirmer avoir au moins 15 ans pour créer un compte.' });
  }

  if (!isValidUsername(username)) {
    return ack({ ok: false, error: 'Pseudo invalide (3-20 caracteres, lettres/chiffres/_).' });
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return ack({ ok: false, error: `Mot de passe trop court (min ${PASSWORD_MIN} caracteres).` });
  }

  const existing = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
  if (existing) return ack({ ok: false, error: 'Ce pseudo est deja pris.' });

  const id = generateId();
  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.prepare(
    'INSERT INTO accounts (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, username, salt, hash, Date.now());

  startSession(socket, id, ack);
}

function login(socket, payload, ack) {
  const username = cleanRaw(payload && payload.username, USERNAME_MAX);
  const password = payload && payload.password;
  const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
  if (!account || typeof password !== 'string' || !verifyPassword(password, account.password_salt, account.password_hash)) {
    return ack({ ok: false, error: 'Identifiants incorrects.' });
  }
  if (account.banned) {
    return ack({ ok: false, error: `Compte banni. Raison : ${account.ban_reason || 'non precisee'}` });
  }
  startSession(socket, account.id, ack);
}

function startSession(socket, accountId, ack) {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { accountId, expiresAt: Date.now() + SESSION_TTL_MS });
  markOnline(socket, accountId);
  ack({ ok: true, token, profile: buildProfile(accountId) });
}

function markOnline(socket, accountId) {
  socket.data.accountId = accountId;
  if (!onlineAccounts.has(accountId)) onlineAccounts.set(accountId, new Set());
  onlineAccounts.get(accountId).add(socket.id);
}

function handleSocketDisconnect(socket) {
  const accountId = socket.data.accountId;
  if (!accountId) return;
  const set = onlineAccounts.get(accountId);
  if (set) {
    set.delete(socket.id);
    if (set.size === 0) onlineAccounts.delete(accountId);
  }
}

function verifySession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) { sessions.delete(token); return null; }
  return session.accountId;
}

function resumeSession(socket, payload, ack) {
  const accountId = verifySession(payload && payload.token);
  if (!accountId) return ack({ ok: false, error: 'Session invalide ou expiree.' });
  const account = db.prepare('SELECT banned, ban_reason FROM accounts WHERE id = ?').get(accountId);
  if (!account || account.banned) return ack({ ok: false, error: 'Compte indisponible.' });
  markOnline(socket, accountId);
  ack({ ok: true, profile: buildProfile(accountId) });
}

function logout(socket, payload, ack) {
  if (payload && payload.token) sessions.delete(payload.token);
  handleSocketDisconnect(socket);
  socket.data.accountId = null;
  ack({ ok: true });
}

// Resout un accountId a partir d'un token, sans jamais faire echouer l'appelant
// (le jeu doit rester jouable sans compte : simple retour null si invalide).
function resolveAccountId(token) {
  if (!token) return null;
  return verifySession(token);
}

// ---------- Profil / XP / succes ----------

function buildProfile(accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return null;
  const unlocked = db.prepare('SELECT achievement_key, unlocked_at FROM achievements WHERE account_id = ?').all(accountId);
  const unlockedKeys = new Set(unlocked.map((u) => u.achievement_key));
  return {
    id: account.id,
    username: account.username,
    xp: account.xp,
    level: levelForXp(account.xp),
    wins: account.wins,
    judgeCount: account.judge_count,
    answerCount: account.answer_count,
    achievements: ACHIEVEMENTS.map((a) => ({
      key: a.key,
      name: a.name,
      desc: a.desc,
      unlocked: unlockedKeys.has(a.key),
    })),
  };
}

function getProfile(socket, payload, ack) {
  const accountId = resolveAccountId(payload && payload.token);
  if (!accountId) return ack({ ok: false, error: 'Non connecte.' });
  const profile = buildProfile(accountId);
  if (!profile) return ack({ ok: false, error: 'Compte introuvable.' });
  ack({ ok: true, profile });
}

function checkNewAchievements(accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return [];
  const unlocked = new Set(
    db.prepare('SELECT achievement_key FROM achievements WHERE account_id = ?').all(accountId).map((r) => r.achievement_key)
  );
  const newly = [];
  for (const def of ACHIEVEMENTS) {
    if (!unlocked.has(def.key) && def.check(account)) {
      db.prepare('INSERT INTO achievements (account_id, achievement_key, unlocked_at) VALUES (?, ?, ?)').run(accountId, def.key, Date.now());
      newly.push(def);
    }
  }
  return newly;
}

// Ces fonctions sont appelees par gameManager aux moments-cles de la partie.
// Elles ne font jamais planter l'appelant : accountId peut etre null (invite).
function recordAnswer(accountId) {
  if (!accountId) return null;
  db.prepare('UPDATE accounts SET answer_count = answer_count + 1, xp = xp + ? WHERE id = ?').run(XP_ANSWER, accountId);
  return checkNewAchievements(accountId);
}

function recordJudgeTurn(accountId) {
  if (!accountId) return null;
  db.prepare('UPDATE accounts SET judge_count = judge_count + 1 WHERE id = ?').run(accountId);
  return checkNewAchievements(accountId);
}

function recordRoundWin(accountId) {
  if (!accountId) return null;
  db.prepare('UPDATE accounts SET wins = wins + 1, xp = xp + ? WHERE id = ?').run(XP_ROUND_WIN, accountId);
  return checkNewAchievements(accountId);
}

function recordGameWin(accountId) {
  if (!accountId) return;
  db.prepare('UPDATE accounts SET xp = xp + ? WHERE id = ?').run(XP_GAME_WIN, accountId);
}

// ---------- Amis ----------

function findAccountByUsername(username) {
  return db.prepare('SELECT id, username FROM accounts WHERE username = ?').get(cleanRaw(username, USERNAME_MAX));
}

function sendFriendRequest(socket, payload, ack) {
  const accountId = resolveAccountId(payload && payload.token);
  if (!accountId) return ack({ ok: false, error: 'Non connecte.' });
  const target = findAccountByUsername(payload && payload.username);
  if (!target) return ack({ ok: false, error: 'Joueur introuvable.' });
  if (target.id === accountId) return ack({ ok: false, error: 'Impossible de s\'ajouter soi-meme.' });

  const existing = db.prepare(
    'SELECT * FROM friendships WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)'
  ).get(accountId, target.id, target.id, accountId);
  if (existing) return ack({ ok: false, error: existing.status === 'accepted' ? 'Deja amis.' : 'Demande deja en cours.' });

  db.prepare('INSERT INTO friendships (id, requester_id, target_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(generateId(), accountId, target.id, 'pending', Date.now());
  ack({ ok: true });
}

function respondFriendRequest(socket, payload, ack) {
  const accountId = resolveAccountId(payload && payload.token);
  if (!accountId) return ack({ ok: false, error: 'Non connecte.' });
  const requesterId = payload && payload.requesterId;
  const accept = !!(payload && payload.accept);

  const row = db.prepare('SELECT * FROM friendships WHERE requester_id = ? AND target_id = ? AND status = ?').get(requesterId, accountId, 'pending');
  if (!row) return ack({ ok: false, error: 'Demande introuvable.' });

  if (accept) {
    db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', row.id);
  } else {
    db.prepare('DELETE FROM friendships WHERE id = ?').run(row.id);
  }
  ack({ ok: true });
}

function removeFriend(socket, payload, ack) {
  const accountId = resolveAccountId(payload && payload.token);
  if (!accountId) return ack({ ok: false, error: 'Non connecte.' });
  const otherId = payload && payload.accountId;
  db.prepare(
    'DELETE FROM friendships WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)'
  ).run(accountId, otherId, otherId, accountId);
  ack({ ok: true });
}

function listFriends(socket, payload, ack) {
  const accountId = resolveAccountId(payload && payload.token);
  if (!accountId) return ack({ ok: false, error: 'Non connecte.' });

  const accepted = db.prepare(
    `SELECT a.id, a.username FROM friendships f
     JOIN accounts a ON a.id = (CASE WHEN f.requester_id = ? THEN f.target_id ELSE f.requester_id END)
     WHERE (f.requester_id = ? OR f.target_id = ?) AND f.status = 'accepted'`
  ).all(accountId, accountId, accountId);

  const incoming = db.prepare(
    `SELECT a.id, a.username FROM friendships f JOIN accounts a ON a.id = f.requester_id
     WHERE f.target_id = ? AND f.status = 'pending'`
  ).all(accountId);

  const outgoing = db.prepare(
    `SELECT a.id, a.username FROM friendships f JOIN accounts a ON a.id = f.target_id
     WHERE f.requester_id = ? AND f.status = 'pending'`
  ).all(accountId);

  ack({
    ok: true,
    friends: accepted.map((f) => ({ id: f.id, username: f.username, online: onlineAccounts.has(f.id) })),
    incomingRequests: incoming,
    outgoingRequests: outgoing,
  });
}

// Droit a l'effacement (RGPD) : suppression definitive et immediate, pas de
// "corbeille"/desactivation temporaire. Retire aussi le compte des relations
// d'amitie d'autrui (sinon une ligne orpheline continuerait a le referencer)
// et invalide toutes ses sessions actives partout (pas seulement ce socket).
function deleteAccount(socket, payload, ack) {
  const accountId = resolveAccountId(payload && payload.token);
  if (!accountId) return ack({ ok: false, error: 'Non connecte.' });

  db.prepare('DELETE FROM friendships WHERE requester_id = ? OR target_id = ?').run(accountId, accountId);
  db.prepare('DELETE FROM achievements WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);

  for (const [token, session] of sessions) {
    if (session.accountId === accountId) sessions.delete(token);
  }
  onlineAccounts.delete(accountId);
  socket.data.accountId = null;

  ack({ ok: true });
}

module.exports = {
  register,
  login,
  resumeSession,
  logout,
  deleteAccount,
  handleSocketDisconnect,
  resolveAccountId,
  getProfile,
  recordAnswer,
  recordJudgeTurn,
  recordRoundWin,
  recordGameWin,
  checkNewAchievements,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  listFriends,
  ACHIEVEMENTS,
};
