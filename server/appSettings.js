'use strict';

const db = require('./db');

// Reglage global reserve au superadmin ("owner") : longueur max d'une
// reponse. Change via le curseur du panel admin, persiste en base, mais ne
// s'applique qu'aux NOUVELLES parties — chaque partie capture sa propre
// valeur a la creation (voir game.settings.answerMaxLength dans
// gameManager.js) et la garde pour toute sa duree, meme si le reglage
// global change entre-temps.
const ANSWER_MAX_LENGTH_KEY = 'answerMaxLength';
const ANSWER_MAX_LENGTH_DEFAULT = 250;
const ANSWER_MAX_LENGTH_MIN = 100;
const ANSWER_MAX_LENGTH_MAX = 800;
const ANSWER_MAX_LENGTH_STEP = 100;

function getAnswerMaxLength() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(ANSWER_MAX_LENGTH_KEY);
  if (!row) return ANSWER_MAX_LENGTH_DEFAULT;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : ANSWER_MAX_LENGTH_DEFAULT;
}

function isValidAnswerMaxLength(n) {
  const num = Number(n);
  return (
    Number.isInteger(num) &&
    num >= ANSWER_MAX_LENGTH_MIN &&
    num <= ANSWER_MAX_LENGTH_MAX &&
    (num - ANSWER_MAX_LENGTH_MIN) % ANSWER_MAX_LENGTH_STEP === 0
  );
}

function setAnswerMaxLength(n) {
  if (!isValidAnswerMaxLength(n)) return false;
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(ANSWER_MAX_LENGTH_KEY, String(n));
  return true;
}

// Description d'un pack de cartes, modifiable par l'admin (panel "Éditeur de
// cartes") sans toucher au code -- ecrase la description par defaut definie
// dans cardManager.js (PACKS) tant qu'une valeur est enregistree ici.
const PACK_DESCRIPTION_PREFIX = 'packDescription:';
const PACK_DESCRIPTION_MAX = 200;

function getPackDescriptionOverride(packId) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(PACK_DESCRIPTION_PREFIX + packId);
  return row ? row.value : null;
}

function setPackDescription(packId, text) {
  const clean = String(text || '').trim().slice(0, PACK_DESCRIPTION_MAX);
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(PACK_DESCRIPTION_PREFIX + packId, clean);
  return clean;
}

module.exports = {
  getAnswerMaxLength,
  setAnswerMaxLength,
  isValidAnswerMaxLength,
  ANSWER_MAX_LENGTH_DEFAULT,
  ANSWER_MAX_LENGTH_MIN,
  ANSWER_MAX_LENGTH_MAX,
  ANSWER_MAX_LENGTH_STEP,
  getPackDescriptionOverride,
  setPackDescription,
  PACK_DESCRIPTION_MAX,
};
