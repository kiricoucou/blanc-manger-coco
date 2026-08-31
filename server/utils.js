'use strict';

const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I/O/0/1 ambigus

function generateGameCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  }
  return code;
}

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// Melange Fisher-Yates, ne mute pas l'original.
function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randomInt(min, maxInclusive) {
  return crypto.randomInt(min, maxInclusive + 1);
}

function pickRandom(array) {
  return array[randomInt(0, array.length - 1)];
}

// Echappe tout HTML pour empecher l'injection XSS dans le texte affiche.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONTROL_CHARS_REGEX = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g');

// Nettoie une chaine utilisateur (trim, controle, longueur) SANS l'echapper.
// Sert de base commune : la longueur doit toujours etre mesuree sur ce texte
// brut, jamais sur sa version HTML-echappee (les entites comme &amp; ou &#39;
// sont plus longues que le caractere d'origine et fausseraient la limite).
function cleanRaw(input, maxLength) {
  if (typeof input !== 'string') return '';
  let cleaned = input.replace(CONTROL_CHARS_REGEX, '');
  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/\s+/g, ' ');
  if (cleaned.length > maxLength) cleaned = cleaned.slice(0, maxLength);
  return cleaned;
}

// Nettoie une chaine utilisateur et l'echappe pour un affichage HTML sur.
function sanitizeText(input, maxLength) {
  return escapeHtml(cleanRaw(input, maxLength));
}

function now() {
  return Date.now();
}

module.exports = {
  generateGameCode,
  generateId,
  shuffle,
  randomInt,
  pickRandom,
  escapeHtml,
  cleanRaw,
  sanitizeText,
  now,
};
