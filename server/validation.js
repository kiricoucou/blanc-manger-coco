'use strict';

const { sanitizeText, cleanRaw } = require('./utils');
const { PACK_IDS } = require('./cardManager');

const NICKNAME_MAX = 16;
const NICKNAME_MIN = 1;
const ANSWER_MAX = 250; // repli seulement : la vraie limite vient de game.settings.answerMaxLength
const VALID_AVATARS = new Set([
  '😀', '😎', '🤓', '🤠', '😈', '👻',
  '🤡', '🥶', '🤩', '🤑', '🐸', '🦊',
  '🐼', '🐵', '🐯', '🦁', '🐙', '🦄',
  '👽', '🤖', '👹', '👺', '💀', '🎃',
  '🤪', '😵', '🫠', '🗿', '🧠', '🐶',
]);
const VALID_TIME_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120];
const MIN_SCORE = 1;
const MAX_SCORE = 15;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const MIN_CARD_CHANGES = 0;
const MAX_CARD_CHANGES = 5;

function isValidNickname(raw) {
  if (typeof raw !== 'string') return false;
  const clean = cleanRaw(raw, NICKNAME_MAX);
  return clean.length >= NICKNAME_MIN && clean.length <= NICKNAME_MAX;
}

function cleanNickname(raw) {
  return sanitizeText(raw, NICKNAME_MAX);
}

// Ne garde que les identifiants de packs connus (ignore le reste sans planter).
function normalizePacks(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw)].filter((id) => typeof id === 'string' && PACK_IDS.has(id));
}

function isValidVisibility(v) {
  return v === 'public' || v === 'private';
}

function isValidAvatar(avatar) {
  return VALID_AVATARS.has(avatar);
}

function isValidGameCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code);
}

function isValidAnswerTime(seconds) {
  return VALID_TIME_OPTIONS.includes(Number(seconds));
}

function isValidWinningScore(score) {
  const n = Number(score);
  return Number.isInteger(n) && n >= MIN_SCORE && n <= MAX_SCORE;
}

function isValidCardChangesMax(n) {
  const num = Number(n);
  return Number.isInteger(num) && num >= MIN_CARD_CHANGES && num <= MAX_CARD_CHANGES;
}

// max est fourni par l'appelant (game.settings.answerMaxLength, capture a la
// creation de la partie — voir appSettings.js) ; ANSWER_MAX ne sert plus que
// de repli si aucune valeur n'est passee (parties tres anciennes, tests).
function cleanAnswerText(raw, max) {
  return sanitizeText(raw, max || ANSWER_MAX);
}

function isValidAnswerText(raw, max) {
  const limit = max || ANSWER_MAX;
  const clean = cleanRaw(raw, limit);
  return clean.length > 0 && clean.length <= limit;
}

module.exports = {
  NICKNAME_MAX,
  ANSWER_MAX,
  VALID_AVATARS,
  VALID_TIME_OPTIONS,
  MIN_SCORE,
  MAX_SCORE,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_CARD_CHANGES,
  MAX_CARD_CHANGES,
  isValidNickname,
  cleanNickname,
  normalizePacks,
  isValidVisibility,
  isValidAvatar,
  isValidGameCode,
  isValidAnswerTime,
  isValidWinningScore,
  isValidCardChangesMax,
  cleanAnswerText,
  isValidAnswerText,
};
