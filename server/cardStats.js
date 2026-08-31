'use strict';

// Statistiques d'usage par carte (taux d'utilisation, taux de victoire, temps
// de reponse moyen). Stockees a part du contenu des packs (JSON) : l'admin
// peut editer/remplacer les fichiers de cartes a la main sans perdre le lien
// (la stat est gardee tant que l'id de carte ne change pas ; une carte
// re-importee avec un nouvel id repart simplement a zero, c'est attendu).
const db = require('./db');

function ensureRow(cardId, packId) {
  db.prepare('INSERT OR IGNORE INTO card_stats (card_id, pack_id) VALUES (?, ?)').run(cardId, packId);
}

function recordUsage(cardId, packId) {
  if (!cardId) return;
  ensureRow(cardId, packId);
  db.prepare('UPDATE card_stats SET usage_count = usage_count + 1 WHERE card_id = ?').run(cardId);
}

function recordWin(cardId, packId) {
  if (!cardId) return;
  ensureRow(cardId, packId);
  db.prepare('UPDATE card_stats SET win_count = win_count + 1 WHERE card_id = ?').run(cardId);
}

function recordResponseTime(cardId, packId, ms) {
  if (!cardId || !Number.isFinite(ms) || ms < 0) return;
  ensureRow(cardId, packId);
  db.prepare('UPDATE card_stats SET response_count = response_count + 1, total_response_ms = total_response_ms + ? WHERE card_id = ?').run(Math.round(ms), cardId);
}

// Stats d'un pack entier, indexees par card_id, pour l'affichage admin.
function getStatsForPack(packId) {
  const rows = db.prepare('SELECT * FROM card_stats WHERE pack_id = ?').all(packId);
  const byId = {};
  for (const r of rows) {
    byId[r.card_id] = {
      usageCount: r.usage_count,
      winCount: r.win_count,
      winRate: r.usage_count > 0 ? r.win_count / r.usage_count : 0,
      avgResponseMs: r.response_count > 0 ? Math.round(r.total_response_ms / r.response_count) : null,
    };
  }
  return byId;
}

module.exports = { recordUsage, recordWin, recordResponseTime, getStatsForPack };
