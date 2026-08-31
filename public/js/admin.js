'use strict';

// Mini-app admin independante (page separee, pas liee au flux joueur).
// Le token de session admin est stocke a part du token de partie.
const ADMIN_TOKEN_KEY = 'blancManger.adminToken';

const Admin = {
  socket: null,
  token: null,
  role: null,
  email: null,
  view: 'DASHBOARD', // DASHBOARD, EDITOR, COMMUNITY, REPORTS, BANS, ADMINS, AUDIT (jamais affiche avant validation du token, voir connect handler)
  packs: [],
  games: [],
  currentPackId: null,
  cards: [],
  pending: [],
  reports: [],
  banned: [],
  admins: [],
  answerMaxLength: null,
  auditLog: [],
  activityLog: [],
  scenarios: [],
  stats: null,
  gifAvatars: [],
};

function adminEmit(event, payload) {
  return new Promise((resolve) => {
    Admin.socket.emit(event, { ...payload, token: Admin.token }, (res) => resolve(res || { ok: false }));
  });
}

function root() { return document.getElementById('admin-app'); }

async function requireLoginOr(fn) {
  const res = await fn();
  if (res && res.ok === false && /session admin/i.test(res.error || '')) {
    try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch (e) {}
    toast('Session expirée, reconnecte-toi depuis la page d\'accueil.', 'error');
    setTimeout(() => location.replace('/'), 1200);
    return null;
  }
  return res;
}

// ---------- Rendu ----------

function renderAdmin() {
  document.getElementById('admin-logout-btn').hidden = !Admin.token;
  switch (Admin.view) {
    case 'DASHBOARD': root().innerHTML = viewDashboard(); break;
    case 'EDITOR': root().innerHTML = viewEditor(); break;
    case 'COMMUNITY': root().innerHTML = viewCommunity(); break;
    case 'REPORTS': root().innerHTML = viewReports(); break;
    case 'BANS': root().innerHTML = viewBans(); break;
    case 'AUDIT': root().innerHTML = viewAudit(); break;
    case 'JOURNAL': root().innerHTML = viewJournal(); break;
    case 'SCENARIOS': root().innerHTML = viewScenarios(); break;
    case 'STATS': root().innerHTML = viewStats(); break;
    case 'GIFAVATARS': root().innerHTML = viewGifAvatars(); break;
    case 'ADMINS': root().innerHTML = viewAdmins(); break;
    default: root().innerHTML = '<p>?</p>';
  }
  applyEmojiOverridesIn(root());
}

function adminNav(active) {
  const items = [
    ['DASHBOARD', '📊 Dashboard'],
    ['STATS', '📈 Statistiques'],
    ['EDITOR', '🃏 Éditeur de cartes'],
    ['COMMUNITY', '👥 Communauté'],
    ['REPORTS', '🚩 Signalements'],
    ['BANS', '🚫 Comptes bannis'],
    ['AUDIT', '📜 Journal admin'],
    ['JOURNAL', '🕵️ Journal joueurs'],
    ['SCENARIOS', '🤖 Bots tuto/démo'],
    ['GIFAVATARS', '🎬 Avatars GIF'],
  ];
  if (Admin.role === 'superadmin') items.push(['ADMINS', '🛡️ Administrateurs']);
  return `<nav class="admin-nav">${items.map(([id, label]) =>
    `<button class="admin-nav-btn ${active === id ? 'admin-nav-active' : ''}" data-action="admin-nav" data-view="${id}">${label}</button>`
  ).join('')}</nav>`;
}

function viewDashboard() {
  const rows = Admin.games.length
    ? Admin.games.map((g) => `
      <li class="admin-game-row">
        <div class="admin-game-info">
          <span class="admin-game-code">${g.code}${g.paused ? ' ⏸️' : ''}</span>
          <span class="hint">${g.state} · ${g.playerCount} joueurs (${g.connectedCount} connectés) · ${g.visibility} · manche ${g.roundNumber}${g.mode ? ` · ${g.mode}` : ''}</span>
          <ul class="admin-game-players hint">
            ${g.players.map((p) => `<li>${p.isPlatformAdmin ? '👑 ' : ''}${escapeHtmlClient(p.nickname)}${p.isBot ? ' 🤖' : ''}${p.connected ? '' : ' (déco)'} — ${p.score} pt${p.score > 1 ? 's' : ''}</li>`).join('')}
          </ul>
        </div>
        <div class="admin-game-actions">
          <button class="btn-copy-code" data-action="admin-force-card-open" data-code="${g.code}">🎯 Forcer une carte</button>
          <button class="btn-copy-code" data-action="admin-join-game" data-code="${g.code}">👑 Rejoindre</button>
          ${g.paused
            ? `<button class="btn-copy-code" data-action="admin-resume-game" data-code="${g.code}">▶️ Reprendre</button>`
            : `<button class="btn-copy-code" data-action="admin-pause-game" data-code="${g.code}">⏸️ Pause</button>`}
          <button class="btn-kick" data-action="admin-stop-game" data-code="${g.code}" aria-label="Arrêter">⏹️</button>
          <button class="btn-kick" data-action="admin-delete-game" data-code="${g.code}" aria-label="Supprimer">🗑️</button>
        </div>
      </li>`).join('')
    : '<p class="hint">Aucune partie en cours.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('DASHBOARD')}
    <h2>Parties en cours (${Admin.games.length})</h2>
    <button class="btn btn-ghost" data-action="admin-refresh-games">🔄 Actualiser</button>
    <ul class="admin-game-list">${rows}</ul>
  </div>`;
}

function viewAudit() {
  const rows = Admin.auditLog.length
    ? Admin.auditLog.map((e) => `
      <li class="admin-audit-row">
        <span class="admin-audit-when hint">${new Date(e.created_at).toLocaleString('fr-FR')}</span>
        <span class="admin-audit-who">${escapeHtmlClient(e.admin_email)}</span>
        <span class="admin-audit-action">${escapeHtmlClient(e.action)}</span>
        ${e.target ? `<span class="hint">→ ${escapeHtmlClient(String(e.target))}</span>` : ''}
      </li>`).join('')
    : '<p class="hint">Aucune action enregistrée.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('AUDIT')}
    <h2>Journal des actions admin</h2>
    <button class="btn btn-ghost" data-action="admin-refresh-audit">🔄 Actualiser</button>
    <ul class="admin-audit-list">${rows}</ul>
  </div>`;
}

const ACTIVITY_LABELS = {
  game_created: '🎮 Partie créée',
  game_joined: '🔑 Partie rejointe',
  tutorial_game_created: '🎓 Tutoriel lancé',
  demo_game_created: '🤖 Démo lancée',
};

function viewJournal() {
  const rows = Admin.activityLog.length
    ? Admin.activityLog.map((e) => `
      <li class="admin-audit-row" data-entry-id="${e.id}">
        <span class="admin-audit-when hint">${new Date(e.created_at).toLocaleString('fr-FR')}</span>
        <span class="admin-audit-who">${escapeHtmlClient(e.nickname || '?')}</span>
        <span class="admin-audit-action">${ACTIVITY_LABELS[e.event_type] || escapeHtmlClient(e.event_type)}</span>
        ${e.game_code ? `<span class="hint">→ ${escapeHtmlClient(e.game_code)}</span>` : ''}
        <span class="hint">IP : ${escapeHtmlClient(e.ip || '?')}</span>
        <button class="btn-copy-code" data-action="admin-locate-ip" data-ip="${escapeHtmlClient(e.ip || '')}" data-entry-id="${e.id}">📍 Localiser</button>
        <div class="admin-locate-result" id="locate-${e.id}"></div>
      </li>`).join('')
    : '<p class="hint">Aucune activité enregistrée.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('JOURNAL')}
    <h2>Journal d'activité joueurs</h2>
    <p class="hint">Localisation à la demande uniquement (bouton "Localiser") — jamais automatique, jamais stockée.</p>
    <button class="btn btn-ghost" data-action="admin-refresh-journal">🔄 Actualiser</button>
    <ul class="admin-audit-list">${rows}</ul>
  </div>`;
}

const WINNER_LABELS = { human: '🧑 Humain', zoe: '🤖 Zoé', max: '👾 Max' };

function viewScenarios() {
  const rows = Admin.scenarios.length
    ? Admin.scenarios.map((s, i) => `
      <li class="admin-card-row admin-card-row-stacked">
        <div class="admin-card-main">
          <span class="admin-card-text">${i + 1}. ${escapeHtmlClient(s.text)}</span>
          <div class="admin-card-meta hint">
            🤖 Zoé : ${s.zoeAnswers.map(escapeHtmlClient).join(' · ')}<br>
            👾 Max : ${s.maxAnswers.map(escapeHtmlClient).join(' · ')}<br>
            🏆 Gagnant : ${WINNER_LABELS[s.winner] || s.winner}
          </div>
        </div>
        <div class="admin-card-actions">
          <button class="btn-copy-code" data-action="admin-edit-scenario" data-id="${s.id}">✏️</button>
          <button class="btn-kick" data-action="admin-delete-scenario" data-id="${s.id}">✕</button>
        </div>
      </li>`).join('')
    : '<p class="hint">Aucun scénario.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('SCENARIOS')}
    <h2>Bots tutoriel/démo (${Admin.scenarios.length})</h2>
    <p class="hint">Cartes et réponses fixes des 2 bots pour le tutoriel guidé et la partie démo — pas de hasard, tout est configurable ici.</p>
    <button class="btn btn-secondary" data-action="admin-add-scenario">➕ Ajouter un scénario</button>
    <ul class="admin-card-list">${rows}</ul>
  </div>`;
}

function viewStats() {
  const s = Admin.stats;
  if (!s) {
    return `<div class="screen admin-screen">${adminNav('STATS')}<p class="hint">Chargement...</p></div>`;
  }

  const statCards = [
    ['🎮', 'Parties jouées', s.totalGamesPlayed],
    ['🟢', 'Parties en cours', s.gamesInProgress],
    ['📡', 'Personnes en ligne', s.onlineNow],
    ['👣', 'Visites totales', s.totalVisits],
    ['👤', 'Comptes créés', s.totalUsers],
    ['🏷️', 'Pseudos distincts vus', s.nicknames.length],
  ].map(([emoji, label, value]) => `
    <div class="admin-stat-card">
      <span class="admin-stat-emoji">${emoji}</span>
      <span class="admin-stat-value">${value}</span>
      <span class="admin-stat-label">${label}</span>
    </div>`).join('');

  const maxWin = Math.max(1, ...s.topWinningCards.map((c) => c.winCount));
  const chartRows = s.topWinningCards.length
    ? s.topWinningCards.map((c) => `
      <li class="admin-bar-row">
        <span class="admin-bar-label" title="${escapeHtmlClient(c.text)}">${escapeHtmlClient(c.text)}</span>
        <div class="admin-bar-track">
          <div class="admin-bar-fill" style="width:${Math.round((c.winCount / maxWin) * 100)}%"></div>
        </div>
        <span class="admin-bar-value">${c.winCount} 🏆 <span class="hint">(${c.packName})</span></span>
      </li>`).join('')
    : '<p class="hint">Aucune carte gagnante enregistrée pour le moment.</p>';

  const nicknamesList = s.nicknames.length
    ? `<div class="admin-nickname-cloud">${s.nicknames.map((n) => `<span class="chip">${escapeHtmlClient(n)}</span>`).join('')}</div>`
    : '<p class="hint">Aucun pseudo enregistré.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('STATS')}
    <h2>Statistiques</h2>
    <button class="btn btn-ghost" data-action="admin-refresh-stats">🔄 Actualiser</button>
    <div class="admin-stat-grid">${statCards}</div>

    <h3>🏆 Cartes les plus gagnantes</h3>
    <ul class="admin-bar-chart">${chartRows}</ul>

    <h3>🏷️ Tous les pseudos vus</h3>
    ${nicknamesList}
  </div>`;
}

function viewGifAvatars() {
  const rows = Admin.gifAvatars.length
    ? Admin.gifAvatars.map((id) => `
      <li class="admin-card-row">
        <div class="admin-card-main" style="flex-direction:row; align-items:center; gap:12px;">
          <img src="assets/avatars/gif/${encodeURIComponent(id)}.gif" alt="${escapeHtmlClient(id)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;" />
          <span class="admin-card-text">${escapeHtmlClient(id)}</span>
        </div>
        <button class="btn-kick" data-action="admin-delete-gif-avatar" data-id="${escapeHtmlClient(id)}">✕</button>
      </li>`).join('')
    : '<p class="hint">Aucun avatar GIF pour le moment.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('GIFAVATARS')}
    <h2>Avatars GIF (${Admin.gifAvatars.length})</h2>
    <p class="hint">Uploade ici des GIF que les joueurs pourront choisir comme avatar (onglet "GIF" à la création de partie). Vérifié côté serveur : signature binaire réelle, 5 Mo max, jamais exécuté.</p>
    <div class="admin-toolbar">
      <input type="file" id="gif-avatar-file-input" accept="image/gif" hidden />
      <label class="btn btn-secondary admin-import-label" data-action="admin-pick-gif-avatar">📤 Uploader un GIF</label>
    </div>
    <ul class="admin-card-list">${rows}</ul>
  </div>`;
}

function viewAdmins() {
  const rows = Admin.admins.map((a) => `
    <li class="admin-account-row">
      <span>${escapeHtmlClient(a.email)}</span>
      <span class="chip ${a.role === 'superadmin' ? 'chip-active' : ''}">${a.role}</span>
      ${a.email !== Admin.email ? `
        <button class="btn-copy-code" data-action="admin-toggle-role" data-email="${escapeHtmlClient(a.email)}" data-role="${a.role === 'superadmin' ? 'moderator' : 'superadmin'}">🔁 ${a.role === 'superadmin' ? 'Rétrograder' : 'Promouvoir'}</button>
        <button class="btn-kick" data-action="admin-delete-admin" data-email="${escapeHtmlClient(a.email)}">✕</button>
      ` : '<span class="hint">(toi)</span>'}
    </li>`).join('');

  const amx = Admin.answerMaxLength || { value: 250, min: 100, max: 800, step: 100 };
  return `
  <div class="screen admin-screen">
    ${adminNav('ADMINS')}
    <h2>Réglages globaux</h2>
    <div class="admin-setting-block">
      <label for="answer-maxlength-slider">✍️ Longueur max d'une réponse : <strong id="answer-maxlength-value">${amx.value}</strong> caractères</label>
      <input id="answer-maxlength-slider" type="range" min="${amx.min}" max="${amx.max}" step="${amx.step}" value="${amx.value}" />
      <p class="hint">S'applique uniquement aux nouvelles parties créées après ce changement — les parties déjà en cours gardent leur ancienne limite.</p>
      <button class="btn btn-secondary" data-action="admin-save-maxlength">💾 Enregistrer</button>
    </div>
    <h2>Administrateurs (${Admin.admins.length})</h2>
    <div class="admin-toolbar">
      <input id="new-admin-email" class="text-input" type="email" placeholder="Email du nouvel admin" />
      <input id="new-admin-password" class="text-input" type="password" placeholder="Mot de passe (8+ caractères)" />
      <select id="new-admin-role" class="text-input">
        <option value="moderator">Modérateur</option>
        <option value="superadmin">Super-administrateur</option>
      </select>
      <button class="btn btn-secondary" data-action="admin-create-admin">➕ Créer</button>
    </div>
    <ul class="admin-account-list">${rows}</ul>
  </div>`;
}

function cardMetaLine(c) {
  const s = c.stats || { usageCount: 0, winCount: 0, winRate: 0, avgResponseMs: null };
  const parts = [
    `🎲 ${s.usageCount} partie${s.usageCount > 1 ? 's' : ''}`,
    `🏆 ${Math.round(s.winRate * 100)}% victoires`,
    s.avgResponseMs !== null ? `⏱️ ${Math.round(s.avgResponseMs / 1000)}s moy.` : '⏱️ —',
  ];
  if (c.authorNickname) parts.push(`👤 ${escapeHtmlClient(c.authorNickname)}`);
  if (c.approvedAt) parts.push(`📅 ${new Date(c.approvedAt).toLocaleDateString('fr-FR')}`);
  return `<div class="admin-card-meta hint">${parts.join(' · ')}</div>`;
}

function viewEditor() {
  const packOptions = Admin.packs.map((p) =>
    `<button class="chip ${Admin.currentPackId === p.id ? 'chip-active' : ''}" data-action="admin-select-pack" data-pack="${p.id}">${p.emoji} ${escapeHtmlClient(p.name)} (${p.count})</button>`
  ).join('');

  const cardsHtml = Admin.currentPackId
    ? Admin.cards.map((c) => `
      <li class="admin-card-row admin-card-row-stacked">
        <div class="admin-card-main">
          <span class="admin-card-text">${escapeHtmlClient(c.text)}</span>
          ${cardMetaLine(c)}
        </div>
        <div class="admin-card-actions">
          <button class="btn-copy-code" data-action="admin-edit-card" data-id="${c.id}">✏️</button>
          <button class="btn-kick" data-action="admin-delete-card" data-id="${c.id}">✕</button>
        </div>
      </li>`).join('')
    : '';

  return `
  <div class="screen admin-screen">
    ${adminNav('EDITOR')}
    <h2>Éditeur de cartes</h2>
    <div class="chip-row">${packOptions}</div>

    ${Admin.currentPackId ? `
      <div class="setting-row" style="align-items:flex-start;">
        <label for="admin-pack-desc-input" class="hint" style="flex-shrink:0;">Description du pack :</label>
        <input id="admin-pack-desc-input" class="text-input" type="text" maxlength="200"
          value="${escapeHtmlClient((Admin.packs.find((p) => p.id === Admin.currentPackId) || {}).description || '')}"
          placeholder="Visible par les joueurs au choix des packs..." />
        <button class="btn-copy-code" data-action="admin-save-pack-description" data-pack="${Admin.currentPackId}">💾</button>
      </div>
      <div class="admin-toolbar">
        <button class="btn btn-secondary" data-action="admin-add-card-open">➕ Ajouter une carte</button>
        <button class="btn btn-ghost" data-action="admin-export-pack">⬇️ Exporter JSON</button>
        <label class="btn btn-ghost admin-import-label">
          ⬆️ Importer JSON
          <input type="file" id="admin-import-file" accept="application/json" hidden />
        </label>
      </div>
      <ul class="admin-card-list">${cardsHtml}</ul>
    ` : '<p class="hint">Choisis un pack ci-dessus.</p>'}
  </div>`;
}

function viewCommunity() {
  const rows = Admin.pending.length
    ? Admin.pending.map((c) => `
      <li class="admin-card-row admin-card-row-stacked">
        <div class="admin-card-main">
          <span class="admin-card-text">${escapeHtmlClient(c.text)}</span>
          <div class="admin-card-meta hint">👤 ${escapeHtmlClient(c.authorNickname || 'Anonyme')} · 📅 ${new Date(c.submittedAt).toLocaleString('fr-FR')} · 🕳️ ${c.blanksTotal} trou${c.blanksTotal > 1 ? 's' : ''}</div>
        </div>
        <div class="admin-card-actions">
          <button class="btn-copy-code" data-action="admin-approve-community" data-id="${c.id}">✅ Approuver</button>
          <button class="btn-kick" data-action="admin-reject-community" data-id="${c.id}">✕ Rejeter</button>
        </div>
      </li>`).join('')
    : '<p class="hint">Aucune proposition en attente.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('COMMUNITY')}
    <h2>Deck communautaire — en attente (${Admin.pending.length})</h2>
    <ul class="admin-card-list">${rows}</ul>
  </div>`;
}

function viewReports() {
  const rows = Admin.reports.length
    ? Admin.reports.map((r) => `
      <li class="admin-card-row">
        <div>
          <span class="admin-card-text">${escapeHtmlClient(r.cardText)}</span>
          <div class="hint">Pack: ${escapeHtmlClient(r.packId)} · Raison: ${escapeHtmlClient(r.reason || '(aucune)')}</div>
        </div>
        <button class="btn-kick" data-action="admin-dismiss-report" data-id="${r.id}">✕ Classer</button>
      </li>`).join('')
    : '<p class="hint">Aucun signalement.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('REPORTS')}
    <h2>Signalements (${Admin.reports.length})</h2>
    <ul class="admin-card-list">${rows}</ul>
  </div>`;
}

function viewBans() {
  const rows = Admin.banned.length
    ? Admin.banned.map((b) => `
      <li class="admin-card-row">
        <div>
          <span class="admin-card-text">${escapeHtmlClient(b.username)}</span>
          <div class="hint">Raison : ${escapeHtmlClient(b.ban_reason || '(non précisée)')}</div>
        </div>
        <button class="btn-copy-code" data-action="admin-unban-account" data-username="${escapeHtmlClient(b.username)}">✅ Débannir</button>
      </li>`).join('')
    : '<p class="hint">Aucun compte banni.</p>';

  return `
  <div class="screen admin-screen">
    ${adminNav('BANS')}
    <h2>Comptes bannis (${Admin.banned.length})</h2>

    <div class="admin-toolbar">
      <input id="ban-username-input" class="text-input" type="text" placeholder="Pseudo du compte à bannir" />
      <input id="ban-reason-input" class="text-input" type="text" placeholder="Raison (optionnel)" />
      <button class="btn btn-danger" data-action="admin-ban-account">🚫 Bannir</button>
    </div>

    <ul class="admin-card-list">${rows}</ul>
  </div>`;
}

// ---------- Actions ----------

async function loadDashboard() {
  const res = await requireLoginOr(() => adminEmit('adminListGames'));
  if (res && res.ok) Admin.games = res.games;
  renderAdmin();
}

async function loadPacks() {
  const res = await requireLoginOr(() => adminEmit('adminGetPacks'));
  if (res && res.ok) Admin.packs = res.packs;
}

async function loadCards(packId) {
  const res = await requireLoginOr(() => adminEmit('adminListCards', { packId }));
  if (res && res.ok) Admin.cards = res.cards;
  renderAdmin();
}

async function loadCommunity() {
  const res = await requireLoginOr(() => adminEmit('adminListPendingCommunity'));
  if (res && res.ok) Admin.pending = res.cards;
  renderAdmin();
}

async function loadReports() {
  const res = await requireLoginOr(() => adminEmit('adminListReports'));
  if (res && res.ok) Admin.reports = res.reports;
  renderAdmin();
}

async function loadGifAvatars() {
  try {
    const res = await fetch('/api/gif-avatars');
    const data = await res.json();
    Admin.gifAvatars = data.ids || [];
  } catch (e) { /* liste inchangee */ }
  renderAdmin();
}

async function loadBans() {
  const res = await requireLoginOr(() => adminEmit('adminListBannedAccounts'));
  if (res && res.ok) Admin.banned = res.banned;
  renderAdmin();
}

async function loadAudit() {
  const res = await requireLoginOr(() => adminEmit('adminListAuditLog', { limit: 100 }));
  if (res && res.ok) Admin.auditLog = res.entries;
  renderAdmin();
}

async function loadJournal() {
  const res = await requireLoginOr(() => adminEmit('adminListActivityLog', { limit: 100 }));
  if (res && res.ok) Admin.activityLog = res.entries;
  renderAdmin();
}

async function loadStats() {
  const res = await requireLoginOr(() => adminEmit('adminGetStats'));
  if (res && res.ok) Admin.stats = res;
  renderAdmin();
}

async function loadScenarios() {
  const res = await requireLoginOr(() => adminEmit('adminListPracticeScenarios'));
  if (res && res.ok) Admin.scenarios = res.scenarios;
  renderAdmin();
}

async function loadAdmins() {
  const [res, amx] = await Promise.all([
    requireLoginOr(() => adminEmit('adminListAdmins')),
    requireLoginOr(() => adminEmit('adminGetAnswerMaxLength')),
  ]);
  if (res && res.ok) Admin.admins = res.admins;
  if (amx && amx.ok) Admin.answerMaxLength = amx;
  renderAdmin();
}

// Modale d'edition d'un scenario bot (carte + reponses fixes Zoe/Max +
// vainqueur). Le nombre de champs reponse suit le nombre de trous detecte
// dans le texte, en direct, comme cardPromptDialog pour l'editeur de cartes.
async function scenarioPromptDialog(existing) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-show';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>${existing ? 'Modifier le scénario' : 'Nouveau scénario'}</h3>
        <p class="hint">Utilise ______ pour chaque trou (1 à 3 trous).</p>
        <div class="card-face card-black card-face-sm admin-card-preview-stage">
          <div class="card-text" id="scenario-preview-text" data-fit></div>
        </div>
        <p class="hint" id="scenario-preview-status"></p>
        <textarea id="scenario-text-area" class="text-input admin-textarea" rows="3">${existing ? escapeHtmlClient(existing.text) : ''}</textarea>
        <div id="scenario-answers-zoe"></div>
        <div id="scenario-answers-max"></div>
        <label class="hint" for="scenario-winner">Qui gagne cette manche ?</label>
        <select id="scenario-winner" class="text-input">
          <option value="human" ${!existing || existing.winner === 'human' ? 'selected' : ''}>🧑 Le joueur humain</option>
          <option value="zoe" ${existing && existing.winner === 'zoe' ? 'selected' : ''}>🤖 Bot Zoé</option>
          <option value="max" ${existing && existing.winner === 'max' ? 'selected' : ''}>👾 Bot Max</option>
        </select>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-x="cancel">ANNULER</button>
          <button class="btn btn-primary" data-x="ok">VALIDER</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#scenario-text-area');
    const previewText = overlay.querySelector('#scenario-preview-text');
    const previewStatus = overlay.querySelector('#scenario-preview-status');
    const zoeBlock = overlay.querySelector('#scenario-answers-zoe');
    const maxBlock = overlay.querySelector('#scenario-answers-max');

    function answerFields(container, label, botKey, values) {
      const blanksTotal = Math.max(1, Math.min(3, (textarea.value.match(/_{3,}/g) || []).length || 1));
      const prev = Array.from(container.querySelectorAll('input')).map((i) => i.value);
      const source = values || prev;
      container.innerHTML = `<p class="hint">${label} :</p>` + Array.from({ length: blanksTotal }, (_, i) => `
        <input class="text-input scenario-answer-input" data-bot="${botKey}" data-index="${i}" placeholder="Trou ${i + 1}" value="${escapeHtmlClient(source[i] || '')}" />
      `).join('');
    }

    function updatePreview() {
      const raw = textarea.value;
      const blanksTotal = (raw.match(/_{3,}/g) || []).length;
      previewText.innerHTML = raw ? cardTextWithBlanks(raw) : '<span class="hint">Aperçu en direct...</span>';
      fitCardText(previewText);
      previewStatus.textContent = !raw.trim() ? '' : (blanksTotal < 1 || blanksTotal > 3)
        ? `⚠️ ${blanksTotal} trou(s) détecté(s) (il en faut 1 à 3).`
        : `✅ ${blanksTotal} trou${blanksTotal > 1 ? 's' : ''}.`;
      answerFields(zoeBlock, '🤖 Réponses de Bot Zoé', 'zoe');
      answerFields(maxBlock, '👾 Réponses de Bot Max', 'max');
    }
    textarea.addEventListener('input', updatePreview);
    answerFields(zoeBlock, '🤖 Réponses de Bot Zoé', 'zoe', existing ? existing.zoeAnswers : null);
    answerFields(maxBlock, '👾 Réponses de Bot Max', 'max', existing ? existing.maxAnswers : null);
    updatePreview();
    if (existing) {
      // Re-remplit apres le premier updatePreview (qui a reconstruit les champs).
      answerFields(zoeBlock, '🤖 Réponses de Bot Zoé', 'zoe', existing.zoeAnswers);
      answerFields(maxBlock, '👾 Réponses de Bot Max', 'max', existing.maxAnswers);
    }
    textarea.focus();

    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset && e.target.dataset.x;
      if (e.target === overlay || action === 'cancel') { overlay.remove(); resolve(null); }
      if (action === 'ok') {
        const text = textarea.value.trim();
        const zoeAnswers = Array.from(zoeBlock.querySelectorAll('input')).map((i) => i.value.trim());
        const maxAnswers = Array.from(maxBlock.querySelectorAll('input')).map((i) => i.value.trim());
        const winner = overlay.querySelector('#scenario-winner').value;
        overlay.remove();
        resolve({ text, zoeAnswers, maxAnswers, winner });
      }
    });
  });
}

async function cardPromptDialog(defaultText) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-show';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>Texte de la carte</h3>
        <p class="hint">Utilise ______ pour chaque trou (1 à 3 trous).</p>
        <div class="card-face card-black card-face-sm admin-card-preview-stage">
          <div class="card-text" id="card-preview-text" data-fit></div>
        </div>
        <p class="hint" id="card-preview-status"></p>
        <textarea id="card-text-area" class="text-input admin-textarea" rows="4">${defaultText ? escapeHtmlClient(defaultText) : ''}</textarea>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-x="cancel">ANNULER</button>
          <button class="btn btn-primary" data-x="ok">VALIDER</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#card-text-area');
    const previewText = overlay.querySelector('#card-preview-text');
    const previewStatus = overlay.querySelector('#card-preview-status');
    const previewStage = overlay.querySelector('.admin-card-preview-stage');

    function updatePreview() {
      const raw = textarea.value;
      const blanksTotal = raw.split('______').length - 1;
      previewText.innerHTML = raw ? cardTextWithBlanks(raw) : '<span class="hint">Apercu en direct...</span>';
      fitCardText(previewText);
      if (!raw.trim()) { previewStatus.textContent = ''; }
      else if (blanksTotal < 1 || blanksTotal > 3) {
        previewStatus.textContent = `⚠️ ${blanksTotal} trou${blanksTotal > 1 ? 's' : ''} detecte${blanksTotal > 1 ? 's' : ''} (il en faut 1 a 3).`;
      } else {
        previewStatus.textContent = `✅ ${blanksTotal} trou${blanksTotal > 1 ? 's' : ''}.`;
      }
    }
    textarea.addEventListener('input', updatePreview);
    updatePreview();
    textarea.focus();

    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset && e.target.dataset.x;
      if (e.target === overlay || action === 'cancel') { overlay.remove(); resolve(null); }
      if (action === 'ok') { const v = textarea.value.trim(); overlay.remove(); resolve(v || null); }
    });
  });
}

const AdminActions = {
  'toggle-password-visibility': (e, t) => {
    const input = document.getElementById(t.dataset.target);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    t.textContent = showing ? '👁' : '🙈';
    t.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  },
  'admin-nav': async (e, t) => {
    Admin.view = t.dataset.view;
    if (Admin.view === 'DASHBOARD') return loadDashboard();
    if (Admin.view === 'STATS') return loadStats();
    if (Admin.view === 'EDITOR') { await loadPacks(); return renderAdmin(); }
    if (Admin.view === 'COMMUNITY') return loadCommunity();
    if (Admin.view === 'REPORTS') return loadReports();
    if (Admin.view === 'BANS') return loadBans();
    if (Admin.view === 'AUDIT') return loadAudit();
    if (Admin.view === 'JOURNAL') return loadJournal();
    if (Admin.view === 'SCENARIOS') return loadScenarios();
    if (Admin.view === 'GIFAVATARS') return loadGifAvatars();
    if (Admin.view === 'ADMINS') return loadAdmins();
    renderAdmin();
  },
  'admin-refresh-games': () => loadDashboard(),
  'admin-refresh-stats': () => loadStats(),
  'admin-refresh-audit': () => loadAudit(),
  'admin-refresh-journal': () => loadJournal(),
  'admin-pick-gif-avatar': () => {
    document.getElementById('gif-avatar-file-input').click();
  },
  'admin-delete-gif-avatar': async (e, t) => {
    const id = t.dataset.id;
    const ok = await confirmModal({
      title: `Supprimer l'avatar "${id}" ?`,
      body: 'Les joueurs qui l\'utilisent actuellement garderont leur pseudo mais perdront cet avatar visuellement.',
      confirmLabel: 'SUPPRIMER',
      cancelLabel: 'ANNULER',
      danger: true,
    });
    if (!ok) return;
    const res = await requireLoginOr(() => adminEmit('adminDeleteGifAvatar', { id }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Avatar supprimé.');
    loadGifAvatars();
  },
  'admin-locate-ip': async (e, t) => {
    const ip = t.dataset.ip;
    const entryId = t.dataset.entryId;
    const target = document.getElementById(`locate-${entryId}`);
    if (!ip) { if (target) target.innerHTML = '<p class="hint">Pas d\'IP enregistrée.</p>'; return; }
    if (target) target.innerHTML = '<p class="hint">Recherche...</p>';
    const res = await requireLoginOr(() => adminEmit('adminGeolocateIp', { ip }));
    if (!res || !res.ok) {
      if (target) target.innerHTML = `<p class="hint">${escapeHtmlClient((res && res.error) || 'Erreur.')}</p>`;
      return;
    }
    if (!target) return;
    target.innerHTML = `
      <p class="hint">📍 ${escapeHtmlClient(res.city || '?')}, ${escapeHtmlClient(res.country || '?')} · ${escapeHtmlClient(res.isp || '')} (approximatif, base sur l'IP)</p>
      <iframe class="admin-locate-map" loading="lazy"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${res.lon - 0.15}%2C${res.lat - 0.1}%2C${res.lon + 0.15}%2C${res.lat + 0.1}&layer=mapnik&marker=${res.lat}%2C${res.lon}">
      </iframe>`;
  },
  'admin-stop-game': async (e, t) => {
    const ok = await confirmModal({ title: 'Arrêter cette partie ?', body: t.dataset.code, confirmLabel: 'ARRÊTER', danger: true });
    if (!ok) return;
    await requireLoginOr(() => adminEmit('adminStopGame', { code: t.dataset.code }));
    loadDashboard();
  },
  'admin-pause-game': async (e, t) => {
    await requireLoginOr(() => adminEmit('adminPauseGame', { code: t.dataset.code }));
    loadDashboard();
  },
  'admin-resume-game': async (e, t) => {
    await requireLoginOr(() => adminEmit('adminResumeGame', { code: t.dataset.code }));
    loadDashboard();
  },
  'admin-delete-game': async (e, t) => {
    const ok = await confirmModal({ title: 'Supprimer définitivement cette partie ?', body: `${t.dataset.code} — tous les joueurs seront déconnectés immédiatement.`, confirmLabel: 'SUPPRIMER', danger: true });
    if (!ok) return;
    await requireLoginOr(() => adminEmit('adminDeleteGame', { code: t.dataset.code }));
    loadDashboard();
  },
  'admin-join-game': async (e, t) => {
    const res = await requireLoginOr(() => adminEmit('adminJoinGameTicket', { code: t.dataset.code }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    window.open(`/?adminJoin=${encodeURIComponent(res.ticket)}`, '_blank', 'noopener');
  },
  'admin-create-admin': async () => {
    const email = document.getElementById('new-admin-email').value.trim();
    const password = document.getElementById('new-admin-password').value;
    const role = document.getElementById('new-admin-role').value;
    const res = await requireLoginOr(() => adminEmit('adminCreateAdmin', { email, password, role }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Administrateur créé.');
    loadAdmins();
  },
  'admin-save-maxlength': async () => {
    const slider = document.getElementById('answer-maxlength-slider');
    if (!slider) return;
    const value = Number(slider.value);
    const res = await requireLoginOr(() => adminEmit('adminSetAnswerMaxLength', { value }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast(`Nouvelle limite : ${value} caractères (parties futures uniquement).`);
    loadAdmins();
  },
  'admin-toggle-role': async (e, t) => {
    await requireLoginOr(() => adminEmit('adminUpdateAdminRole', { email: t.dataset.email, role: t.dataset.role }));
    loadAdmins();
  },
  'admin-delete-admin': async (e, t) => {
    const ok = await confirmModal({ title: `Supprimer l'admin ${t.dataset.email} ?`, body: '', confirmLabel: 'SUPPRIMER', danger: true });
    if (!ok) return;
    await requireLoginOr(() => adminEmit('adminDeleteAdmin', { email: t.dataset.email }));
    loadAdmins();
  },
  'admin-force-card-open': async (e, t) => {
    const code = t.dataset.code;
    if (Admin.packs.length === 0) await loadPacks();
    const packId = Admin.packs[0].id;
    const res = await requireLoginOr(() => adminEmit('adminListCards', { packId }));
    if (!res || !res.ok || res.cards.length === 0) return toast('Aucune carte disponible.', 'error');
    const card = res.cards[Math.floor(Math.random() * res.cards.length)];
    const ok = await confirmModal({
      title: 'Forcer cette carte au prochain tour ?',
      body: card.text,
      confirmLabel: 'FORCER',
    });
    if (!ok) return;
    const forced = await requireLoginOr(() => adminEmit('adminForceNextCard', { code, packId, cardId: card.id }));
    if (forced && forced.ok) toast('Carte forcée pour la prochaine manche.');
  },
  'admin-select-pack': async (e, t) => {
    Admin.currentPackId = t.dataset.pack;
    await loadCards(Admin.currentPackId);
  },
  'admin-save-pack-description': async (e, t) => {
    const input = document.getElementById('admin-pack-desc-input');
    const description = input ? input.value : '';
    const res = await requireLoginOr(() => adminEmit('adminSetPackDescription', { packId: t.dataset.pack, description }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Description enregistrée.');
    await loadPacks();
    renderAdmin();
  },
  'admin-add-scenario': async () => {
    const data = await scenarioPromptDialog(null);
    if (!data) return;
    const res = await requireLoginOr(() => adminEmit('adminAddPracticeScenario', data));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Scénario ajouté.');
    loadScenarios();
  },
  'admin-edit-scenario': async (e, t) => {
    const existing = Admin.scenarios.find((s) => s.id === t.dataset.id);
    const data = await scenarioPromptDialog(existing);
    if (!data) return;
    const res = await requireLoginOr(() => adminEmit('adminUpdatePracticeScenario', { id: t.dataset.id, ...data }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Scénario modifié.');
    loadScenarios();
  },
  'admin-delete-scenario': async (e, t) => {
    const ok = await confirmModal({ title: 'Supprimer ce scénario ?', body: 'Action irréversible.', confirmLabel: 'SUPPRIMER', danger: true });
    if (!ok) return;
    const res = await requireLoginOr(() => adminEmit('adminDeletePracticeScenario', { id: t.dataset.id }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    loadScenarios();
  },
  'admin-add-card-open': async () => {
    const text = await cardPromptDialog('');
    if (!text) return;
    const res = await requireLoginOr(() => adminEmit('adminAddCard', { packId: Admin.currentPackId, text }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Carte ajoutée.');
    await loadPacks();
    loadCards(Admin.currentPackId);
  },
  'admin-edit-card': async (e, t) => {
    const card = Admin.cards.find((c) => c.id === t.dataset.id);
    const text = await cardPromptDialog(card ? card.text : '');
    if (!text) return;
    const res = await requireLoginOr(() => adminEmit('adminUpdateCard', { packId: Admin.currentPackId, cardId: t.dataset.id, text }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Carte modifiée.');
    loadCards(Admin.currentPackId);
  },
  'admin-delete-card': async (e, t) => {
    const ok = await confirmModal({ title: 'Supprimer cette carte ?', body: 'Action irréversible.', confirmLabel: 'SUPPRIMER', danger: true });
    if (!ok) return;
    await requireLoginOr(() => adminEmit('adminDeleteCard', { packId: Admin.currentPackId, cardId: t.dataset.id }));
    await loadPacks();
    loadCards(Admin.currentPackId);
  },
  'admin-export-pack': async () => {
    const res = await requireLoginOr(() => adminEmit('adminExportPack', { packId: Admin.currentPackId }));
    if (!res || !res.ok) return toast('Erreur export.', 'error');
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${Admin.currentPackId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  'admin-approve-community': async (e, t) => {
    await requireLoginOr(() => adminEmit('adminApproveCommunity', { cardId: t.dataset.id }));
    toast('Carte approuvée, ajoutée au pack Communauté.');
    loadCommunity();
  },
  'admin-reject-community': async (e, t) => {
    await requireLoginOr(() => adminEmit('adminRejectCommunity', { cardId: t.dataset.id }));
    loadCommunity();
  },
  'admin-dismiss-report': async (e, t) => {
    await requireLoginOr(() => adminEmit('adminDismissReport', { reportId: t.dataset.id }));
    loadReports();
  },
  'admin-ban-account': async () => {
    const username = document.getElementById('ban-username-input').value.trim();
    const reason = document.getElementById('ban-reason-input').value.trim();
    if (!username) return toast('Indique un pseudo.', 'error');
    const ok = await confirmModal({ title: `Bannir ${username} ?`, body: reason || '(aucune raison précisée)', confirmLabel: 'BANNIR', danger: true });
    if (!ok) return;
    const res = await requireLoginOr(() => adminEmit('adminBanAccount', { username, reason }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast(`${username} banni.`);
    loadBans();
  },
  'admin-unban-account': async (e, t) => {
    const username = t.dataset.username;
    const ok = await confirmModal({ title: `Débannir ${username} ?`, body: '', confirmLabel: 'DÉBANNIR' });
    if (!ok) return;
    await requireLoginOr(() => adminEmit('adminUnbanAccount', { username }));
    loadBans();
  },
};

function onAdminClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const handler = AdminActions[target.dataset.action];
  if (handler) handler(e, target);
}

// Date/heure de demarrage du serveur, affichee uniquement ici (pas cote
// joueur) : outil de diagnostic reserve a l'admin pour confirmer d'un coup
// d'oeil qu'un navigateur atteint bien le serveur courant.
async function loadServerVersionTag() {
  const tag = document.getElementById('server-version-tag');
  if (!tag) return;
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    const { v } = await res.json();
    tag.textContent = new Date(Number(v)).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch (e) {
    tag.textContent = '?';
  }
}

// Purge manuelle du cache JS/CSS de CE navigateur (service worker mis a
// jour, tout Cache Storage vide, marqueur de version local efface) puis
// rechargement force — pour eviter de rejouer le meme diagnostic "vieux
// JS en cache" que celui qui a bloque l'acces a la derniere version.
async function purgeCache() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    try { localStorage.removeItem('blancManger.appVersion'); } catch (e) { /* ignore */ }
  } finally {
    location.reload(true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  Particles.start();
  loadServerVersionTag();
  document.getElementById('purge-cache-btn').addEventListener('click', purgeCache);
  Admin.socket = io({ transports: ['websocket', 'polling'] });
  root().addEventListener('click', onAdminClick);

  // Curseur "longueur max reponse" : maj du chiffre affiche en direct, sans
  // re-render complet (perdrait le focus/la position du curseur en cours de
  // glisse). L'enregistrement reel se fait via le bouton dedie.
  root().addEventListener('input', (e) => {
    if (e.target.id !== 'answer-maxlength-slider') return;
    const label = document.getElementById('answer-maxlength-value');
    if (label) label.textContent = e.target.value;
  });

  root().addEventListener('change', async (e) => {
    if (e.target.id !== 'admin-import-file') return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const entries = JSON.parse(text);
      const res = await requireLoginOr(() => adminEmit('adminImportPack', { packId: Admin.currentPackId, entries }));
      if (!res || !res.ok) return toast((res && res.error) || 'Import invalide.', 'error');
      toast(`${res.count} cartes importées.`);
      await loadPacks();
      loadCards(Admin.currentPackId);
    } catch (err) {
      toast('Fichier JSON invalide.', 'error');
    }
    e.target.value = '';
  });

  root().addEventListener('change', async (e) => {
    if (e.target.id !== 'gif-avatar-file-input') return;
    const file = e.target.files[0];
    if (!file) return;
    if (file.type && file.type !== 'image/gif' && !file.name.toLowerCase().endsWith('.gif')) {
      toast('Seuls les fichiers .gif sont acceptés.', 'error');
      e.target.value = '';
      return;
    }
    const defaultId = file.name.replace(/\.gif$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'avatar';
    const id = prompt('Nom de cet avatar (lettres, chiffres, _ et - uniquement) :', defaultId);
    e.target.value = '';
    if (!id) return;
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id)) return toast('Nom invalide.', 'error');

    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataBase64) return toast('Lecture du fichier impossible.', 'error');

    const res = await requireLoginOr(() => adminEmit('adminUploadGifAvatar', { id, dataBase64 }));
    if (!res || !res.ok) return toast((res && res.error) || 'Erreur.', 'error');
    toast('Avatar GIF ajouté !');
    loadGifAvatars();
  });

  document.getElementById('admin-logout-btn').addEventListener('click', async () => {
    await adminEmit('adminLogout');
    try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch (err) {}
    location.replace('/');
  });

  let savedToken = null;
  try { savedToken = localStorage.getItem(ADMIN_TOKEN_KEY); } catch (e) {}

  // Page privee : aucun formulaire de connexion ici. La seule porte d'entree
  // est la page d'accueil (bouton "👤 Connexion", identifiants admin) qui
  // pose le token puis redirige ici. Sans token valide, retour immediat a
  // l'accueil plutot que d'afficher quoi que ce soit.
  Admin.socket.on('connect', async () => {
    if (!savedToken) { location.replace('/'); return; }
    Admin.token = savedToken;
    const who = await adminEmit('adminWhoAmI');
    const res = who.ok ? await adminEmit('adminListGames') : who;
    if (who.ok && res.ok) {
      Admin.role = who.role;
      Admin.email = who.email;
      Admin.games = res.games;
      Admin.view = 'DASHBOARD';
      await loadPacks();
      renderAdmin();
      if (new URLSearchParams(location.search).get('welcome')) {
        toast('🎉 Bienvenue sur le panel !');
        history.replaceState(null, '', location.pathname);
      }
    } else {
      try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch (err) {}
      location.replace('/');
    }
  });
});
