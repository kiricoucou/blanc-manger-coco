'use strict';

const fs = require('fs');
const path = require('path');
const { shuffle, generateId, escapeHtml } = require('./utils');
const cardStats = require('./cardStats');
const appSettings = require('./appSettings');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BLANK_TOKEN = '______';
// Carte qui designe un joueur precis dans le texte ("...pour la mere de
// {user}.") : resolu server-side en gameManager.confirmCard une fois que le
// juge a choisi la cible (jamais dans cardManager, qui ignore la partie/les
// joueurs). Volontairement PAS compte comme un "trou" (BLANK_TOKEN) : ce
// n'est pas une reponse a ecrire, juste une cible a designer.
const MENTION_TOKEN = '{user}';
function cardHasMention(text) {
  return typeof text === 'string' && text.includes(MENTION_TOKEN);
}

// Registre de tous les packs de cartes disponibles. "dynamic" = alimente par
// les joueurs (deck communautaire), pas edite a la main dans data/.
// description : valeur PAR DEFAUT, remplacee si l'admin en a enregistre une
// autre (voir appSettings.getPackDescription -- persistee en base, pas ici).
const PACKS = [
  { id: 'normal', name: 'Normal', emoji: '🃏', ageRestricted: false, file: 'normal.json', description: 'Ambiance générale : vie de couple, amis, situations du quotidien qui dérapent.' },
  { id: 'spicy', name: 'Spicy', emoji: '🔥', ageRestricted: false, file: 'spicy.json', description: 'Ex, relations, petites vacheries qui piquent, sans être explicite.' },
  { id: 'adult', name: '-18', emoji: '🔞', ageRestricted: true, file: 'adult.json', description: 'Soirée, amour, amis.' },
  { id: 'adults', name: '-18 Vol.2', emoji: '🔞', ageRestricted: true, file: 'adults.json', description: 'Soirée, amour, amis, politique, réf. célébrités.' },
  { id: 'halloween', name: 'Halloween', emoji: '🎃', ageRestricted: false, file: 'halloween.json', description: 'Horreur, déguisements et frissons pour soirée Halloween.' },
  { id: 'noel', name: 'Noël', emoji: '🎄', ageRestricted: false, file: 'noel.json', description: 'Fêtes de fin d\'année, famille, cadeaux ratés et Mamie qui déraille.' },
  { id: 'ete', name: 'Été', emoji: '☀️', ageRestricted: false, file: 'ete.json', description: 'Vacances, plage, chaleur et soirées d\'été.' },
  { id: 'community', name: 'Communauté', emoji: '👥', ageRestricted: false, file: 'community.json', dynamic: true, description: 'Cartes proposées et validées par les joueurs eux-mêmes.' },
];
const PACK_IDS = new Set(PACKS.map((p) => p.id));
const PENDING_FILE = path.join(DATA_DIR, 'community_pending.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

// Coupe un texte de carte brut en segments separes par le token de trou.
// Un "\n" litteral dans le fichier source est convertit en vrai retour a la ligne.
function parseCard(rawLine) {
  const text = rawLine.replace(/\\n/g, '\n');
  const segments = text.split(BLANK_TOKEN);
  const blanksTotal = segments.length - 1;
  return { text, segments, blanksTotal };
}

// Remplace les trous d'une carte, dans l'ordre, par les reponses fournies.
function fillCard(cardText, answers) {
  const { segments, blanksTotal } = parseCard(cardText);
  if (answers.length !== blanksTotal) {
    throw new Error(`fillCard: attendu ${blanksTotal} reponses, recu ${answers.length}`);
  }
  let result = segments[0];
  for (let i = 0; i < blanksTotal; i++) {
    result += answers[i] + segments[i + 1];
  }
  return result;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    throw new Error(`Fichier JSON invalide : ${filePath} (${e.message})`);
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Normalise une entree brute {text, blanks?} en carte utilisable, ou null si invalide.
function normalizeEntry(entry, existingId, packId) {
  if (!entry || typeof entry.text !== 'string' || !entry.text.includes(BLANK_TOKEN)) return null;
  const parsed = parseCard(entry.text);
  if (parsed.blanksTotal < 1 || parsed.blanksTotal > 3) return null;
  // "blanks" declare dans le JSON n'est jamais utilise pour le jeu (le nombre
  // reel de trous vient toujours du texte), mais un ecart signale presque
  // toujours une faute de frappe lors d'une edition manuelle du fichier.
  if (entry.blanks !== undefined && Number(entry.blanks) !== parsed.blanksTotal) {
    console.warn(`[cardManager] "blanks":${entry.blanks} incoherent avec le texte (${parsed.blanksTotal} trou(s) reels) -> "${parsed.text}"`);
  }
  const card = { id: existingId || generateId(), text: parsed.text, blanksTotal: parsed.blanksTotal, packId: packId || null };
  // Metadonnees du deck communautaire (qui l'a proposee, quand) : transparentes
  // pour les autres packs, simplement absentes de leur JSON.
  if (entry.authorNickname) card.authorNickname = String(entry.authorNickname).slice(0, 40);
  if (entry.authorAccountId) card.authorAccountId = String(entry.authorAccountId);
  if (entry.approvedAt) card.approvedAt = Number(entry.approvedAt);
  return card;
}

// Charge un pack depuis son fichier JSON, en filtrant les entrees invalides
// et en retirant les VRAIS doublons (texte strictement identique une fois
// normalise). Necessaire car les fichiers sont editables a la main (pas
// seulement via l'editeur admin) : un copier-coller malencontreux dans le
// JSON ne passerait sinon jamais par une verification.
// Volontairement PAS le seuil flou de findDuplicate (0.85) : beaucoup de
// packs utilisent des variations a theme legitimes et tres proches en texte
// ("Mon chien est tellement ______" / "Mon voisin est tellement ______"...),
// que la comparaison approximative confondrait a tort avec des doublons.
function loadPackFile(pack) {
  const filePath = path.join(DATA_DIR, pack.file);
  const parsed = readJsonFile(filePath)
    .map((e) => normalizeEntry(e, null, pack.id))
    .filter(Boolean);

  const seen = new Set();
  const kept = [];
  for (const card of parsed) {
    const key = normalizeForCompare(card.text);
    if (seen.has(key)) {
      console.warn(`[cardManager] pack "${pack.id}" : doublon exact ignore -> "${card.text}"`);
      continue;
    }
    seen.add(key);
    kept.push(card);
  }
  return kept;
}

// ---------- Detection de doublons ----------
// Comparaison approximative (Levenshtein normalise), pour attraper les
// reformulations quasi identiques ("Mon chat est ______" vs "mon CHAT, est ______")
// pas juste les copier-coller exacts.
function normalizeForCompare(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(new RegExp(BLANK_TOKEN, 'g'), ' TROU ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function similarity(a, b) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

// Beaucoup de packs utilisent des variations a theme legitimes ("Mon chien
// est tellement ______" / "Mon voisin est tellement ______"), mesurees a
// ~0.90 de similarite malgre un sens totalement different : le seuil doit
// rester au-dessus pour ne pas les rejeter a tort (verifie empiriquement).
const DUPLICATE_THRESHOLD = 0.95;

// Cherche une carte trop similaire dans une liste donnee (pack ou file
// d'attente communautaire). Retourne l'entree en collision, ou null.
function findDuplicate(text, candidates, excludeId) {
  for (const c of candidates) {
    if (excludeId && c.id === excludeId) continue;
    if (similarity(text, c.text) >= DUPLICATE_THRESHOLD) return c;
  }
  return null;
}

// Cache en memoire de toutes les cartes chargees depuis le disque, par pack.
// Rechargeable a chaud via reloadPack() quand l'admin modifie un fichier.
const CATALOG = {};
for (const pack of PACKS) CATALOG[pack.id] = loadPackFile(pack);

function reloadPack(packId) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return;
  CATALOG[packId] = loadPackFile(pack);
}

function getPackMeta() {
  return PACKS.map((p) => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    ageRestricted: p.ageRestricted,
    requires: p.requires || null,
    dynamic: !!p.dynamic,
    count: CATALOG[p.id].length,
    description: appSettings.getPackDescriptionOverride(p.id) ?? p.description ?? '',
  }));
}

function buildPool(settings) {
  const selected = Array.isArray(settings.packs) ? settings.packs : [];
  let pool = [];
  for (const packId of selected) {
    if (!PACK_IDS.has(packId)) continue;
    const pack = PACKS.find((p) => p.id === packId);
    if (pack.requires && !selected.includes(pack.requires)) continue; // ex: adult exige spicy
    pool = pool.concat(CATALOG[packId] || []);
  }
  return pool;
}

// Gere la pioche/defausse d'un jeu de cartes pour une partie donnee.
class CardDeck {
  constructor(settings) {
    this.pool = buildPool(settings);
    if (this.pool.length === 0) {
      throw new Error('Aucune carte disponible pour ces parametres.');
    }
    this.drawPile = shuffle(this.pool);
    this.discardPile = [];
  }

  draw() {
    if (this.drawPile.length === 0) {
      if (this.discardPile.length === 0) {
        this.drawPile = shuffle(this.pool);
      } else {
        this.drawPile = shuffle(this.discardPile);
        this.discardPile = [];
      }
    }
    const card = this.drawPile.pop();
    this.discardPile.push(card);
    return card;
  }

  // Pioche une carte ayant precisement ce nombre de trous (pour le
  // changement manuel du juge). Remelange si besoin, comme draw().
  drawByBlanks(blanksTotal) {
    let idx = this.drawPile.findIndex((c) => c.blanksTotal === blanksTotal);
    if (idx === -1) {
      const refill = this.discardPile.length ? this.discardPile : this.pool;
      this.drawPile = shuffle(refill);
      this.discardPile = [];
      idx = this.drawPile.findIndex((c) => c.blanksTotal === blanksTotal);
    }
    if (idx === -1) return null;
    const [card] = this.drawPile.splice(idx, 1);
    this.discardPile.push(card);
    return card;
  }

  // Nombre de cartes disponibles par nombre de trous, pour savoir quels
  // boutons "1 / 2 / 3" activer cote client.
  countByBlanks() {
    const counts = { 1: 0, 2: 0, 3: 0 };
    this.pool.forEach((c) => { counts[c.blanksTotal] += 1; });
    return counts;
  }
}

// ---------- Administration des packs (editeur de cartes) ----------

function adminListCards(packId) {
  if (!PACK_IDS.has(packId)) return null;
  const stats = cardStats.getStatsForPack(packId);
  return CATALOG[packId].map((c) => ({
    id: c.id,
    text: c.text,
    blanksTotal: c.blanksTotal,
    authorNickname: c.authorNickname || null,
    approvedAt: c.approvedAt || null,
    stats: stats[c.id] || { usageCount: 0, winCount: 0, winRate: 0, avgResponseMs: null },
  }));
}

function persistPack(packId) {
  const pack = PACKS.find((p) => p.id === packId);
  const filePath = path.join(DATA_DIR, pack.file);
  // Le pack communautaire garde la tracabilite (auteur/date) dans son JSON ;
  // les autres packs restent au format simple {text, blanks} edite a la main.
  const rows = packId === 'community'
    ? CATALOG[packId].map((c) => ({
        text: c.text, blanks: c.blanksTotal,
        authorNickname: c.authorNickname || null,
        authorAccountId: c.authorAccountId || null,
        approvedAt: c.approvedAt || null,
      }))
    : CATALOG[packId].map((c) => ({ text: c.text, blanks: c.blanksTotal }));
  writeJsonFile(filePath, rows);
}

function adminAddCard(packId, text) {
  if (!PACK_IDS.has(packId)) return { ok: false, error: 'Pack inconnu.' };
  const card = normalizeEntry({ text }, null, packId);
  if (!card) return { ok: false, error: 'Texte de carte invalide (doit contenir 1 a 3 ______).' };
  const dup = findDuplicate(card.text, CATALOG[packId]);
  if (dup) return { ok: false, error: `Trop similaire a une carte existante : "${dup.text}"` };
  CATALOG[packId].push(card);
  persistPack(packId);
  return { ok: true, card };
}

function adminUpdateCard(packId, cardId, text) {
  if (!PACK_IDS.has(packId)) return { ok: false, error: 'Pack inconnu.' };
  const idx = CATALOG[packId].findIndex((c) => c.id === cardId);
  if (idx === -1) return { ok: false, error: 'Carte introuvable.' };
  const card = normalizeEntry({ text }, cardId, packId);
  if (!card) return { ok: false, error: 'Texte de carte invalide.' };
  const dup = findDuplicate(card.text, CATALOG[packId], cardId);
  if (dup) return { ok: false, error: `Trop similaire a une carte existante : "${dup.text}"` };
  CATALOG[packId][idx] = card;
  persistPack(packId);
  return { ok: true, card };
}

function adminDeleteCard(packId, cardId) {
  if (!PACK_IDS.has(packId)) return { ok: false, error: 'Pack inconnu.' };
  const before = CATALOG[packId].length;
  CATALOG[packId] = CATALOG[packId].filter((c) => c.id !== cardId);
  if (CATALOG[packId].length === before) return { ok: false, error: 'Carte introuvable.' };
  persistPack(packId);
  return { ok: true };
}

// Export brut d'un pack (pour telechargement JSON par l'admin).
function adminExportPack(packId) {
  if (!PACK_IDS.has(packId)) return null;
  return CATALOG[packId].map((c) => ({ text: c.text, blanks: c.blanksTotal }));
}

// Import : remplace entierement le contenu d'un pack par le JSON fourni.
// Les doublons (quasi-identiques) sont retires automatiquement du lot importe.
function adminImportPack(packId, entries) {
  if (!PACK_IDS.has(packId)) return { ok: false, error: 'Pack inconnu.' };
  if (!Array.isArray(entries)) return { ok: false, error: 'Format invalide : tableau attendu.' };
  const parsed = entries.map((e) => normalizeEntry(e, null, packId)).filter(Boolean);
  const cards = [];
  let duplicates = 0;
  for (const card of parsed) {
    if (findDuplicate(card.text, cards)) { duplicates += 1; continue; }
    cards.push(card);
  }
  if (cards.length === 0) return { ok: false, error: 'Aucune carte valide dans le fichier.' };
  CATALOG[packId] = cards;
  persistPack(packId);
  return { ok: true, count: cards.length, duplicates };
}

// ---------- Deck communautaire (soumission joueurs + validation admin) ----------

function submitCommunityCard(text, author) {
  const card = normalizeEntry({ text }, null, 'community');
  if (!card) return { ok: false, error: 'Texte de carte invalide (doit contenir 1 a 3 ______).' };
  const pending = readJsonFile(PENDING_FILE);
  const dup = findDuplicate(card.text, CATALOG.community) || findDuplicate(card.text, pending);
  if (dup) return { ok: false, error: `Trop similaire a une carte deja proposee : "${dup.text}"` };
  pending.push({
    id: card.id,
    text: card.text,
    blanksTotal: card.blanksTotal,
    submittedAt: Date.now(),
    authorNickname: (author && author.nickname) || 'Anonyme',
    authorAccountId: (author && author.accountId) || null,
  });
  writeJsonFile(PENDING_FILE, pending);
  return { ok: true };
}

function listPendingCommunityCards() {
  return readJsonFile(PENDING_FILE);
}

function approveCommunityCard(cardId) {
  const pending = readJsonFile(PENDING_FILE);
  const idx = pending.findIndex((c) => c.id === cardId);
  if (idx === -1) return { ok: false, error: 'Carte introuvable.' };
  const [card] = pending.splice(idx, 1);
  writeJsonFile(PENDING_FILE, pending);
  CATALOG.community.push({
    id: card.id, text: card.text, blanksTotal: card.blanksTotal, packId: 'community',
    authorNickname: card.authorNickname || 'Anonyme',
    authorAccountId: card.authorAccountId || null,
    approvedAt: Date.now(),
  });
  persistPack('community');
  return { ok: true };
}

function rejectCommunityCard(cardId) {
  const pending = readJsonFile(PENDING_FILE);
  const next = pending.filter((c) => c.id !== cardId);
  if (next.length === pending.length) return { ok: false, error: 'Carte introuvable.' };
  writeJsonFile(PENDING_FILE, next);
  return { ok: true };
}

// ---------- Signalement de cartes ----------

function reportCard(packId, cardId, reason) {
  if (!PACK_IDS.has(packId)) return { ok: false, error: 'Pack inconnu.' };
  const card = CATALOG[packId].find((c) => c.id === cardId);
  const reports = readJsonFile(REPORTS_FILE);
  reports.push({
    id: generateId(),
    packId,
    cardId,
    cardText: card ? card.text : '(carte introuvable)',
    reason: String(reason || '').slice(0, 300),
    reportedAt: Date.now(),
  });
  writeJsonFile(REPORTS_FILE, reports);
  return { ok: true };
}

function listReports() {
  return readJsonFile(REPORTS_FILE);
}

function dismissReport(reportId) {
  const reports = readJsonFile(REPORTS_FILE);
  const next = reports.filter((r) => r.id !== reportId);
  if (next.length === reports.length) return { ok: false, error: 'Signalement introuvable.' };
  writeJsonFile(REPORTS_FILE, next);
  return { ok: true };
}

function estimatePoolSize(settings) {
  return buildPool(settings).length;
}

module.exports = {
  BLANK_TOKEN,
  MENTION_TOKEN,
  cardHasMention,
  PACKS,
  PACK_IDS,
  estimatePoolSize,
  parseCard,
  fillCard,
  CardDeck,
  escapeHtml,
  getPackMeta,
  reloadPack,
  adminListCards,
  adminAddCard,
  adminUpdateCard,
  adminDeleteCard,
  adminExportPack,
  adminImportPack,
  submitCommunityCard,
  listPendingCommunityCards,
  approveCommunityCard,
  rejectCommunityCard,
  reportCard,
  listReports,
  dismissReport,
};
