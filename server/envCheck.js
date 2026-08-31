'use strict';

// Verifie la configuration .env au demarrage. Bloque le lancement si une
// variable STRICTEMENT necessaire au fonctionnement de base est invalide,
// et affiche des avertissements clairs pour les fonctionnalites optionnelles
// mal configurees (admin, notifications push) sans empecher le jeu de tourner.

function fail(messages) {
  console.error('\n==================== ERREUR DE CONFIGURATION ====================');
  for (const m of messages) console.error('  - ' + m);
  console.error('Corrige ton fichier .env (voir .env.example) puis relance le serveur.');
  console.error('===================================================================\n');
  process.exit(1);
}

function warn(messages) {
  if (!messages.length) return;
  console.warn('\n-------------------- Avertissement configuration --------------------');
  for (const m of messages) console.warn('  - ' + m);
  console.warn('-----------------------------------------------------------------------\n');
}

function isHex(str) {
  return typeof str === 'string' && str.length > 0 && /^[0-9a-f]+$/i.test(str);
}

function checkEnv(env) {
  const fatal = [];
  const warnings = [];

  // PORT : doit etre un entier valide si fourni.
  if (env.PORT !== undefined && env.PORT !== '') {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      fatal.push(`PORT="${env.PORT}" invalide (doit etre un entier entre 1 et 65535).`);
    }
  }

  // Compte admin : soit les 3 vars sont vides (admin desactive, OK), soit
  // les 3 doivent etre presentes et coherentes. Un etat partiel est une
  // erreur de config probable (mot de passe oublie, etc.).
  const adminVars = {
    ADMIN_EMAIL: env.ADMIN_EMAIL || '',
    ADMIN_PASSWORD_SALT: env.ADMIN_PASSWORD_SALT || '',
    ADMIN_PASSWORD_HASH: env.ADMIN_PASSWORD_HASH || '',
  };
  const adminPresent = Object.values(adminVars).filter(Boolean).length;
  if (adminPresent === 0) {
    warnings.push('Aucun compte admin configure (ADMIN_EMAIL/ADMIN_PASSWORD_SALT/ADMIN_PASSWORD_HASH absents) : le panel admin sera inaccessible. Voir .env.example pour generer un hash.');
  } else if (adminPresent < 3) {
    fatal.push('Configuration admin incomplete : ADMIN_EMAIL, ADMIN_PASSWORD_SALT et ADMIN_PASSWORD_HASH doivent etre tous les trois definis ou tous les trois absents.');
  } else {
    if (!adminVars.ADMIN_EMAIL.includes('@')) {
      fatal.push(`ADMIN_EMAIL="${adminVars.ADMIN_EMAIL}" ne ressemble pas a un email valide.`);
    }
    if (!isHex(adminVars.ADMIN_PASSWORD_SALT)) {
      fatal.push('ADMIN_PASSWORD_SALT doit etre une chaine hexadecimale (genere via la commande dans .env.example).');
    }
    if (!isHex(adminVars.ADMIN_PASSWORD_HASH) || adminVars.ADMIN_PASSWORD_HASH.length !== 128) {
      fatal.push('ADMIN_PASSWORD_HASH invalide (doit etre un hash scrypt hexadecimal de 128 caracteres, genere via la commande dans .env.example).');
    }
  }

  // Notifications push : optionnelles, mais coherentes si presentes.
  const vapidPublic = env.VAPID_PUBLIC_KEY || '';
  const vapidPrivate = env.VAPID_PRIVATE_KEY || '';
  const vapidPresent = [vapidPublic, vapidPrivate].filter(Boolean).length;
  if (vapidPresent === 0) {
    warnings.push('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY absents : les notifications push seront desactivees (bouton "Activer les notifications" affichera une erreur propre).');
  } else if (vapidPresent === 1) {
    fatal.push('Configuration push incomplete : VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY doivent etre tous les deux definis ou tous les deux absents.');
  }

  if (fatal.length) fail(fatal);
  warn(warnings);
}

module.exports = { checkEnv };
