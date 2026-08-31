'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
// Pas de caracteres ambigus (0/O, 1/l/I) : mot de passe recopiable a la main
// sans erreur depuis le terminal.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generatePassword(length = 14) {
  return Array.from(crypto.randomBytes(length)).map((b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function appendToEnvFile(lines) {
  try {
    const exists = fs.existsSync(ENV_PATH) && fs.statSync(ENV_PATH).size > 0;
    fs.appendFileSync(ENV_PATH, (exists ? '\n' : '') + lines.join('\n') + '\n');
    return true;
  } catch (e) {
    console.warn('Impossible d\'ecrire les identifiants admin dans .env :', e.message);
    return false;
  }
}

// Garantit qu'un compte admin exploitable existe pour cette session et
// renvoie le mot de passe en clair quand on le connait, pour l'afficher au
// demarrage (voir startupBanner.js). Trois cas :
//  1. ADMIN_PASSWORD_HASH deja configure (usage prod) : rien a faire, le mot
//     de passe n'est jamais connu en clair, donc jamais affichable.
//  2. ADMIN_EMAIL + ADMIN_PASSWORD en clair fournis (pratique en dev) : le
//     hash est derive a la volee a chaque demarrage, jamais stocke ailleurs
//     qu'en clair dans le .env que l'operateur a lui-meme choisi d'ecrire.
//  3. Rien de configure : un compte complet est genere et persiste dans
//     .env (mot de passe inclus en clair) pour rester le meme et pouvoir
//     etre raffiche a chaque "npm start".
function ensureAdminCredentials(env) {
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD_SALT && env.ADMIN_PASSWORD_HASH) {
    return { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || null, generated: false };
  }

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(env.ADMIN_PASSWORD, salt);
    env.ADMIN_PASSWORD_SALT = salt;
    env.ADMIN_PASSWORD_HASH = hash;
    return { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, generated: false };
  }

  const email = env.ADMIN_EMAIL || 'admin@local';
  const password = generatePassword();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);

  env.ADMIN_EMAIL = email;
  env.ADMIN_PASSWORD = password;
  env.ADMIN_PASSWORD_SALT = salt;
  env.ADMIN_PASSWORD_HASH = hash;

  const persisted = appendToEnvFile([
    '',
    '# Compte admin genere automatiquement au premier lancement (voir le',
    '# terminal a chaque "npm start" pour le mot de passe). Change-le si tu veux :',
    '# remplace ADMIN_PASSWORD ci-dessous et relance, le hash sera recalcule.',
    `ADMIN_EMAIL=${email}`,
    `ADMIN_PASSWORD=${password}`,
    `ADMIN_PASSWORD_SALT=${salt}`,
    `ADMIN_PASSWORD_HASH=${hash}`,
  ]);

  return { email, password, generated: true, persisted };
}

module.exports = { ensureAdminCredentials };
