'use strict';

// Purge du journal d'activite (IP + pseudo + horodatage) au-dela de la duree
// annoncee dans la politique de confidentialite (public/legal.html, section
// 3.5) : conserver ces donnees indefiniment contredirait ce qui est promis
// aux utilisateurs.
const db = require('./db');

const RETENTION_MS = 12 * 30 * 24 * 60 * 60 * 1000; // ~12 mois

function purgeOldActivity() {
  const cutoff = Date.now() - RETENTION_MS;
  db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(cutoff);
}

function start() {
  purgeOldActivity();
  setInterval(purgeOldActivity, 24 * 60 * 60 * 1000).unref(); // 1x/jour suffit
}

module.exports = { start, purgeOldActivity };
