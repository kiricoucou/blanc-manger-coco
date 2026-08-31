'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    judge_count INTEGER NOT NULL DEFAULT 0,
    answer_count INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    UNIQUE(requester_id, target_id)
  );

  CREATE TABLE IF NOT EXISTS achievements (
    account_id TEXT NOT NULL,
    achievement_key TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, achievement_key)
  );

  CREATE TABLE IF NOT EXISTS card_stats (
    card_id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    win_count INTEGER NOT NULL DEFAULT 0,
    response_count INTEGER NOT NULL DEFAULT 0,
    total_response_ms INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'moderator',
    created_at INTEGER NOT NULL,
    created_by TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    admin_id TEXT,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  );

  -- Reglages globaux modifiables par le superadmin (ex. longueur max des
  -- reponses). Une ligne par cle, valeur en texte (parsee selon le besoin).
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Scenarios du mode pratique (tutoriel/demo) : carte + reponses fixes des
  -- 2 bots + vainqueur. Configurable par l'admin (onglet "Bots tuto/demo"),
  -- seede une fois depuis practiceScenarios.js au tout premier demarrage.
  CREATE TABLE IF NOT EXISTS practice_scenarios (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    blanks_total INTEGER NOT NULL,
    zoe_answers TEXT NOT NULL,
    max_answers TEXT NOT NULL,
    winner TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Journal d'activite joueurs (creation de partie, partie pratique, etc.).
  -- Stocke seulement l'IP brute, jamais de position resolue : la localisation
  -- se fait a la demande (bouton "localiser" cote admin), jamais en arriere-plan.
  -- Compteurs globaux simples (visites totales, parties jouees totales...),
  -- une ligne par cle. Volontairement plat : pas besoin d'historique fin,
  -- juste des totaux qui survivent aux redemarrages du serveur.
  CREATE TABLE IF NOT EXISTS site_stats (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    nickname TEXT,
    game_code TEXT,
    mode TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
`);

module.exports = db;
