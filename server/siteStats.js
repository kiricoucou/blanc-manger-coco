'use strict';

// Compteurs globaux persistants (visites, parties jouees...). Voir
// server/db.js pour le schema (une ligne cle/valeur par compteur).
const db = require('./db');

function increment(key, by = 1) {
  db.prepare('INSERT INTO site_stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value')
    .run(key, by);
}

function get(key) {
  const row = db.prepare('SELECT value FROM site_stats WHERE key = ?').get(key);
  return row ? row.value : 0;
}

module.exports = { increment, get };
