'use strict';

// Scenarios du mode pratique (tutoriel/demo, 2 bots serveur + le joueur
// humain). Aucun hasard : chaque manche a une carte, des reponses de bots et
// un gagnant precis et connus a l'avance, pour que la demo/tutoriel soit
// reproductible et pedagogique. Configurable par l'admin (voir
// adminManager.js "Bots tuto/demo") : stocke en base, ce fichier ne fournit
// que les 15 valeurs de depart utilisees pour peupler la table au tout
// premier demarrage (jamais relu ensuite).
const db = require('./db');
const { generateId } = require('./utils');

// Configurable via .env (BOT_ZOE_NAME / BOT_MAX_NAME) : le proprietaire de
// l'instance peut renommer les bots du mode pratique sans toucher au code.
// Repli sur les noms par defaut si absent/vide.
const ZOE_NICKNAME = process.env.BOT_ZOE_NAME || 'Bot Zoé';
const MAX_NICKNAME = process.env.BOT_MAX_NAME || 'Bot Max';

const DEFAULT_SCENARIOS = [
  { text: 'Le pire cadeau de Noël que Mémé ait jamais offert : ______.', blanksTotal: 1, zoe: ['un abonnement magazine tricot'], max: ['un dentier de rechange'], winner: 'human' },
  { text: 'Sur mon CV, sous "compétences", j\'ai écrit ______.', blanksTotal: 1, zoe: ['maître incontesté du micro-onde'], max: ['expert en excuses créatives'], winner: 'max' },
  { text: 'Ce qui a vraiment causé la fin des dinosaures : ______.', blanksTotal: 1, zoe: ['un groupe WhatsApp familial'], max: ['une météorite trop susceptible'], winner: 'human' },
  { text: 'À mon enterrement, je veux que ______ et que ______.', blanksTotal: 2, zoe: ['on joue de la techno', 'personne ne pleure trop fort'], max: ['on serve des chips', "on annule si j'arrive en retard"], winner: 'zoe' },
  { text: 'La vraie raison pour laquelle le prof est arrivé en retard : ______.', blanksTotal: 1, zoe: ['il négociait avec un pigeon'], max: ['sa voiture a refusé de démarrer par principe'], winner: 'human' },
  { text: 'Dans mon horoscope de demain, il est écrit : "Attention à ______."', blanksTotal: 1, zoe: ['ton ex qui like tout'], max: ['la friteuse, elle sait tout'], winner: 'zoe' },
  { text: 'Le nouveau slogan de l\'entreprise, trouvé en réunion : ______.', blanksTotal: 1, zoe: ['"on fait semblant, mais bien"'], max: ['"la médiocrité, mais premium"'], winner: 'human' },
  { text: 'Ce que le médecin m\'a vraiment dit après l\'examen : ______.', blanksTotal: 1, zoe: ['"vous êtes en pleine forme, malheureusement"'], max: ['"revenez quand ça ira mal"'], winner: 'max' },
  { text: 'Dans le futur, les enfants n\'auront plus besoin de ______ ni de ______.', blanksTotal: 2, zoe: ['devoirs à la maison', 'de professeur de maths'], max: ['chaussettes qui grattent', 'de dimanches pluvieux'], winner: 'human' },
  { text: 'La police a retrouvé sur les lieux : ______.', blanksTotal: 1, zoe: ['un flamant rose en tongs'], max: ['trois kilos de confiture suspecte'], winner: 'zoe' },
  { text: 'Le vrai contenu de la boîte noire de l\'avion : ______.', blanksTotal: 1, zoe: ['une playlist de yodel'], max: ['la liste de courses du pilote'], winner: 'human' },
  { text: 'Mon signe astrologique révèle surtout que je suis ______.', blanksTotal: 1, zoe: ['allergique aux réunions'], max: ['incapable de fermer un tiroir'], winner: 'max' },
  { text: 'Le comité a voté à l\'unanimité pour remplacer ______ par ______.', blanksTotal: 2, zoe: ['le café de la machine', "de l'eau tiède"], max: ['les pauses déjeuner', 'des siestes obligatoires'], winner: 'human' },
  { text: 'Sur la pierre tombale du robot, on peut lire : ______.', blanksTotal: 1, zoe: ['"il a fini par comprendre les humains"'], max: ['"erreur 404 : vie non trouvée"'], winner: 'zoe' },
  { text: 'Ce qu\'on entend vraiment à travers le mur des voisins : ______.', blanksTotal: 1, zoe: ['une répétition de yodel'], max: ['un débat sur la meilleure façon de plier une serviette'], winner: 'human' },
];

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM practice_scenarios').get().n;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO practice_scenarios (id, position, text, blanks_total, zoe_answers, max_answers, winner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  DEFAULT_SCENARIOS.forEach((s, i) => {
    insert.run(generateId(), i, s.text, s.blanksTotal, JSON.stringify(s.zoe), JSON.stringify(s.max), s.winner, Date.now());
  });
}
seedIfEmpty();

// winner en base : 'human' | 'zoe' | 'max' (stable, independant du texte du
// pseudo). Traduit vers le nickname reel attendu par gameManager.js.
function winnerToNickname(winner) {
  if (winner === 'zoe') return ZOE_NICKNAME;
  if (winner === 'max') return MAX_NICKNAME;
  return 'human';
}

function rowToScenario(row) {
  return {
    id: row.id,
    text: row.text,
    blanksTotal: row.blanks_total,
    botAnswers: {
      [ZOE_NICKNAME]: JSON.parse(row.zoe_answers),
      [MAX_NICKNAME]: JSON.parse(row.max_answers),
    },
    winner: winnerToNickname(row.winner),
  };
}

// Cache memoire simple : relu a chaque modification admin, sinon garde en
// memoire (evite une requete DB a chaque manche de partie pratique).
let cache = null;
function loadCache() {
  const rows = db.prepare('SELECT * FROM practice_scenarios ORDER BY position ASC').all();
  cache = rows.map(rowToScenario);
  return cache;
}

function getScenarios() {
  if (!cache) loadCache();
  return cache;
}

function countBlanks(text) {
  return (text.match(/_{3,}/g) || []).length;
}

function listScenariosForAdmin() {
  const rows = db.prepare('SELECT * FROM practice_scenarios ORDER BY position ASC').all();
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    blanksTotal: row.blanks_total,
    zoeAnswers: JSON.parse(row.zoe_answers),
    maxAnswers: JSON.parse(row.max_answers),
    winner: row.winner,
  }));
}

function validateScenarioInput({ text, zoeAnswers, maxAnswers, winner }) {
  if (typeof text !== 'string' || !text.trim()) return 'Texte de carte requis.';
  const blanksTotal = countBlanks(text);
  if (blanksTotal < 1 || blanksTotal > 3) return 'Il faut entre 1 et 3 trous (______) dans le texte.';
  if (!Array.isArray(zoeAnswers) || zoeAnswers.length !== blanksTotal || zoeAnswers.some((a) => typeof a !== 'string' || !a.trim())) {
    return `Il faut exactement ${blanksTotal} réponse(s) pour Bot Zoé.`;
  }
  if (!Array.isArray(maxAnswers) || maxAnswers.length !== blanksTotal || maxAnswers.some((a) => typeof a !== 'string' || !a.trim())) {
    return `Il faut exactement ${blanksTotal} réponse(s) pour Bot Max.`;
  }
  if (!['human', 'zoe', 'max'].includes(winner)) return 'Vainqueur invalide.';
  return null;
}

function addScenario(input) {
  const err = validateScenarioInput(input);
  if (err) return { ok: false, error: err };
  const blanksTotal = countBlanks(input.text);
  const maxPos = db.prepare('SELECT MAX(position) AS m FROM practice_scenarios').get().m;
  db.prepare(
    'INSERT INTO practice_scenarios (id, position, text, blanks_total, zoe_answers, max_answers, winner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(generateId(), (maxPos === null ? -1 : maxPos) + 1, input.text.trim(), blanksTotal, JSON.stringify(input.zoeAnswers), JSON.stringify(input.maxAnswers), input.winner, Date.now());
  loadCache();
  return { ok: true };
}

function updateScenario(id, input) {
  const existing = db.prepare('SELECT id FROM practice_scenarios WHERE id = ?').get(id);
  if (!existing) return { ok: false, error: 'Scénario introuvable.' };
  const err = validateScenarioInput(input);
  if (err) return { ok: false, error: err };
  const blanksTotal = countBlanks(input.text);
  db.prepare(
    'UPDATE practice_scenarios SET text = ?, blanks_total = ?, zoe_answers = ?, max_answers = ?, winner = ? WHERE id = ?'
  ).run(input.text.trim(), blanksTotal, JSON.stringify(input.zoeAnswers), JSON.stringify(input.maxAnswers), input.winner, id);
  loadCache();
  return { ok: true };
}

function deleteScenario(id) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM practice_scenarios').get().n;
  if (count <= 1) return { ok: false, error: 'Il doit rester au moins un scénario.' };
  db.prepare('DELETE FROM practice_scenarios WHERE id = ?').run(id);
  loadCache();
  return { ok: true };
}

module.exports = {
  ZOE_NICKNAME,
  MAX_NICKNAME,
  getScenarios,
  listScenariosForAdmin,
  addScenario,
  updateScenario,
  deleteScenario,
};
