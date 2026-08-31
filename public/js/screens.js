'use strict';

// ---------- Rendu principal ----------

function render() {
  const root = $app();
  document.getElementById('top-bar-code-block').hidden = !AppState.gameCode;
  document.querySelector('.top-bar-code-label').textContent = t('lobby.codeLabel');
  document.getElementById('top-bar-code-value').textContent = AppState.gameCode ? AppState.gameCode : '';
  document.getElementById('game-menu-toggle').hidden = !AppState.gameCode;

  if (!AppState.connected) {
    root.innerHTML = screenLoading('Connexion au serveur...');
    return;
  }

  if (AppState.localFlow === 'CODE_REVEAL') {
    // L'ecran "TA PARTIE EST PRETE" doit s'afficher meme si le gameState du
    // lobby est deja arrive (quasi instantane) : sinon il n'est jamais vu.
    root.innerHTML = screenCodeReveal();
  } else if (AppState.gameCode && AppState.publicState) {
    renderGameScreen(root);
  } else if (AppState.gameCode && !AppState.publicState) {
    root.innerHTML = screenLoading('Synchronisation de la partie...');
  } else {
    renderLocalFlow(root);
  }

  fitAllCardText(root);
  TimerDisplay.tick();
  initSignatureTilt(root);
}

function screenLoading(msg) {
  return `<div class="screen center-screen"><div class="spinner" aria-hidden="true"></div><p>${escapeHtmlClient(msg)}</p></div>`;
}

// ---------- Ecrans hors-partie (accueil, creation, jonction) ----------

function renderLocalFlow(root) {
  switch (AppState.localFlow) {
    case 'CREATE_NICKNAME': root.innerHTML = screenNickname('create'); break;
    case 'CREATE_AVATAR': root.innerHTML = screenAvatar('create'); break;
    case 'CREATE_SETTINGS': root.innerHTML = screenCreateSettings(); break;
    case 'CODE_REVEAL': root.innerHTML = screenCodeReveal(); break;
    case 'JOIN_CODE': root.innerHTML = screenJoinCode(); break;
    case 'PUBLIC_GAMES': root.innerHTML = screenPublicGames(); break;
    case 'ACCOUNT_LOGIN': root.innerHTML = screenAccountLogin(); break;
    case 'ACCOUNT_REGISTER': root.innerHTML = screenAccountRegister(); break;
    case 'ACCOUNT_PROFILE': root.innerHTML = screenAccountProfile(); break;
    case 'JOIN_NICKNAME': root.innerHTML = screenNickname('join'); break;
    case 'JOIN_AVATAR': root.innerHTML = screenAvatar('join'); break;
    case 'CHOOSE_CREATE_MODE': root.innerHTML = screenChooseMode(); break;
    case 'PRACTICE_NICKNAME': root.innerHTML = screenPracticeNickname(); break;
    case 'QUICK_PREVIEW': root.innerHTML = screenQuickPreview(); break;
    default: root.innerHTML = screenHome();
  }
}

// Petite carte a jouer dessinee en SVG (coin indice + pip), pour remplacer les
// emojis de decor par un motif qui appartient vraiment a l'identite du jeu.
function miniCardSvg(label, color) {
  return `
    <svg width="40" height="56" viewBox="0 0 40 56" aria-hidden="true">
      <rect x="2" y="2" width="36" height="52" rx="7" fill="var(--surface)" stroke="var(--ink)" stroke-width="3"/>
      <text x="7" y="17" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="700" fill="${color}">${label}</text>
      <text x="33" y="46" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="700" fill="${color}" text-anchor="end">${label}</text>
    </svg>`;
}

function screenHome() {
  return `
  <div class="screen home-screen center-screen">
    <div class="home-cards-fx" aria-hidden="true">
      <span class="floating-card fc1">${miniCardSvg('♠', 'var(--text-0)')}</span>
      <span class="floating-card fc2">${miniCardSvg('♥', 'var(--pink)')}</span>
      <span class="floating-card fc3">${miniCardSvg('♦', 'var(--gold)')}</span>
    </div>
    <div class="logo-wrap">
      <img class="logo-image" src="assets/brand/logo.png" alt="Ça va mal finir" />
      <h1 class="sr-only">Ça va mal finir</h1>
    </div>
    <p class="tagline">${t('home.tagline')}</p>
    <p class="fun-disclaimer">🎉 On est ici pour rigoler ! L'humour peut être noir, ça reste un jeu entre vous : ce qui se dit dans la partie reste dans la partie. L'appli n'est pas responsable de ce qui déborderait en dehors. Amusez-vous bien ce soir 🥳 <a href="/legal.html#charte" target="_blank" rel="noopener">Charte d'utilisation &amp; CGU</a></p>
    <div class="home-actions">
      <button class="btn btn-primary btn-lg" data-action="go-create">${t('home.create')}</button>
      <button class="btn btn-secondary btn-lg" data-action="go-join">${t('home.join')}</button>
      <button class="btn btn-ghost" data-action="view-public-games">${t('home.publicGames')}</button>
      <button class="btn btn-ghost" data-action="view-quick-preview">👀 Essai rapide</button>
      <button class="btn btn-ghost" data-action="view-account">${AppState.account ? `👤 ${escapeHtmlClient(AppState.account.username)} (niv. ${AppState.account.level})` : t('home.account')}</button>
    </div>

    ${rulesSection()}
  </div>`;
}

function screenChooseMode() {
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>Comment veux-tu jouer ?</h2>
    <p class="hint">Tu pourras toujours créer une vraie partie ensuite.</p>
    <button class="btn btn-secondary btn-lg" data-action="choose-mode-tutorial">🎓 Tutoriel guidé</button>
    <p class="hint">Une partie solo contre 2 bots, avec des explications à chaque étape.</p>
    <button class="btn btn-secondary btn-lg" data-action="choose-mode-demo">🤖 Partie démo</button>
    <p class="hint">Même partie solo contre des bots, sans les explications.</p>
    <button class="btn btn-primary btn-lg" data-action="choose-mode-normal">🎮 Partie normale</button>
    <p class="hint">Avec de vrais joueurs, tes propres réglages.</p>
  </div>`;
}

function screenPracticeNickname() {
  const value = escapeHtmlClient(AppState.draft.nickname || '');
  const mode = AppState.draft.practiceMode;
  const title = mode === 'demo' ? '🤖 Partie démo' : '🎓 Tutoriel guidé';
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-choose-mode">${t('back')}</button>
    <h2>${title}</h2>
    <p class="hint">Choisis un pseudo, la partie démarre tout de suite avec 2 bots.</p>
    <input id="nickname-input" class="text-input" type="text" maxlength="16" placeholder="Nayzox" value="${value}" autocomplete="off" />
    <button class="btn btn-primary btn-lg" data-action="practice-nickname-continue">C'EST PARTI</button>
  </div>`;
}

// Aperçu statique d'une manche (aucune vraie partie creee), pour se faire une
// idee du jeu en quelques secondes depuis l'accueil.
function screenQuickPreview() {
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>👀 Aperçu d'une manche</h2>
    <p class="hint">Voici à quoi ressemble le moment où le juge choisit la meilleure réponse.</p>
    <div class="card-face card-black card-face-md">
      <div class="card-text" data-fit>${cardTextWithBlanks('Le pire cadeau à offrir à ______, c\'est ______.', ['ma belle-mère', 'un calendrier périmé'])}</div>
    </div>
    <ul class="pick-card-row">
      ${['un vieux sandwich oublié', 'la honte de toute la famille', 'mon voisin bizarre'].map((txt, i) => `
        <li class="pick-card" style="--i:${i}">
          <div class="card-face pick-card-face card-face-sm">
            <div class="card-text">${escapeHtmlClient(txt)}</div>
          </div>
        </li>`).join('')}
    </ul>
    <p class="hint">Le juge lit les réponses mélangées et anonymes, puis choisit la meilleure. +1 point pour l'auteur !</p>
    <button class="btn btn-primary btn-lg" data-action="choose-mode-normal">🎮 CRÉER UNE PARTIE</button>
  </div>`;
}

function ruleStep(n, title, text, img) {
  return `
    <div class="rule-step">
      <img class="rule-screenshot" src="assets/rules/${img}" alt="${escapeHtmlClient(title)}" loading="lazy" />
      <div class="rule-step-body">
        <span class="rule-step-num">${n}</span>
        <div>
          <h3 class="rule-step-title">${escapeHtmlClient(title)}</h3>
          <p class="rule-step-text">${text}</p>
        </div>
      </div>
    </div>`;
}

function rulesSection() {
  return `
  <section class="rules-section">
    <h2 class="rules-title">📖 COMMENT JOUER</h2>
    <p class="hint">Tout ce qu'il faut savoir pour une première partie sans accroc.</p>

    ${ruleStep(1, 'Crée ou rejoins une partie', "L'admin choisit ses packs de cartes, la visibilité (privée avec code, ou publique dans la liste) et lance la partie dès que 3 joueurs sont réunis.", '02-lobby.jpg')}
    ${ruleStep(2, 'Le juge choisit sa carte', "À chaque manche, le joueur désigné juge reçoit 3 cartes noires au choix. Il en sélectionne une seule, définitivement.", '03-choix-carte.jpg')}
    ${ruleStep(3, 'Tout le monde complète la carte', "Les autres joueurs remplissent les trous de la carte choisie avant la fin du chrono. Textes et emojis autorisés, rien d'autre.", '04-reponse.jpg')}
    ${ruleStep(4, 'Le juge tranche', "Les réponses arrivent mélangées et anonymes. Le juge les parcourt, peut liker/disliker pour s'organiser, puis choisit la meilleure.", '05-jugement.jpg')}
    ${ruleStep(5, 'Résultat et point', "La carte gagnante est révélée avec son auteur. +1 point, et la carte est téléchargeable en image pour la garder.", '06-resultat.jpg')}
    ${ruleStep(6, 'Premier à l\'objectif gagne', "Le gagnant de chaque manche devient le juge suivant. Premier à atteindre le score cible : victoire, confettis et podium.", '07-victoire.jpg')}

    <div class="rules-tips">
      <h3>💡 Bon à savoir</h3>
      <ul class="rules-tips-list">
        <li>Rejoindre en cours de partie est possible : tu es spectateur jusqu'à la manche suivante.</li>
        <li>Un chat général et des messages privés sont disponibles pendant toute la partie (icône 💬).</li>
        <li>Le deck communautaire permet de proposer tes propres cartes, validées par un admin avant d'entrer en jeu.</li>
        <li>Active les notifications dans le lobby pour être prévenu quand c'est ton tour de juger.</li>
      </ul>
    </div>
  </section>`;
}

function screenNickname(mode) {
  const value = escapeHtmlClient(AppState.draft.nickname || '');
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>${t('nickname.title')}</h2>
    <input id="nickname-input" class="text-input" type="text" maxlength="16" placeholder="Nayzox" value="${value}" autocomplete="off" />
    <div id="nickname-status" class="field-status"></div>
    <button class="btn btn-primary btn-lg" data-action="${mode}-nickname-continue" id="nickname-continue-btn">${t('continue')}</button>
  </div>`;
}

function screenAvatar(mode) {
  const grid = AVATARS.map((a, i) => {
    const selected = AppState.draft.avatar === a ? 'avatar-selected' : '';
    return `<button class="avatar-btn ${selected}" style="--i:${i}" data-action="select-avatar" data-avatar="${a}" aria-label="Avatar ${a}">${a}</button>`;
  }).join('');
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-nickname" data-mode="${mode}">${t('back')}</button>
    <h2>${t('avatar.title')}</h2>
    <div class="avatar-grid">${grid}</div>
    <button class="btn btn-primary btn-lg" data-action="${mode}-avatar-continue" ${AppState.draft.avatar ? '' : 'disabled'}>${t('continue')}</button>
  </div>`;
}

// Une ligne "pack de cartes" avec compteur et etat coche/desactive.
function packToggleRow(pack, selectedPacks, actionName) {
  const selected = selectedPacks.includes(pack.id);
  const requiresOk = !pack.requires || selectedPacks.includes(pack.requires);
  const disabled = !requiresOk;
  return `
    <div class="setting-row pack-row ${disabled ? 'setting-disabled' : ''}">
      <span>${pack.emoji} ${escapeHtmlClient(pack.name)} <span class="pack-count">${pack.count} carte${pack.count > 1 ? 's' : ''}</span></span>
      <button class="toggle ${selected ? 'toggle-on' : ''}" data-action="${actionName}" data-pack="${pack.id}" role="switch" aria-checked="${selected}" ${disabled ? 'disabled' : ''}>
        <span class="toggle-knob"></span>
      </button>
    </div>`;
}

function packsBlock(selectedPacks, actionName) {
  const packs = AppState.packMeta || [];
  if (packs.length === 0) return '<p class="hint">Chargement des packs de cartes...</p>';
  return packs.map((p) => packToggleRow(p, selectedPacks, actionName)).join('');
}

function visibilityBlock(visibility, actionName) {
  return `
    <div class="setting-block">
      <span class="setting-label">${t('visibility.label')}</span>
      <div class="chip-row">
        <button class="chip ${visibility === 'private' ? 'chip-active' : ''}" data-action="${actionName}" data-visibility="private">${t('visibility.private')}</button>
        <button class="chip ${visibility === 'public' ? 'chip-active' : ''}" data-action="${actionName}" data-visibility="public">${t('visibility.public')}</button>
      </div>
    </div>`;
}

function screenCreateSettings() {
  const s = AppState.draft.settings;
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-avatar" data-mode="create">${t('back')}</button>
    <h2>${t('create.settingsTitle')}</h2>

    <h3>${t('create.packsTitle')}</h3>
    ${packsBlock(s.packs, 'toggle-pack')}

    ${visibilityBlock(s.visibility, 'set-visibility')}

    <div class="setting-block">
      <span class="setting-label">${t('score.label')} <b>${s.winningScore}</b></span>
      <input type="range" min="1" max="15" step="1" value="${s.winningScore}" class="range-input" data-action="set-score" />
    </div>

    <div class="setting-block">
      <span class="setting-label">${t('time.label')} <b>${s.answerTime}s</b></span>
      <div class="chip-row">
        ${TIME_OPTIONS.map((tOpt) => `<button class="chip ${tOpt === s.answerTime ? 'chip-active' : ''}" data-action="set-time" data-time="${tOpt}">${tOpt}</button>`).join('')}
      </div>
    </div>

    <div class="setting-block">
      <span class="setting-label">${t('cardChanges.label')} <b>${s.cardChangesMax}</b></span>
      <div class="chip-row">
        ${CARD_CHANGE_OPTIONS.map((n) => `<button class="chip ${n === s.cardChangesMax ? 'chip-active' : ''}" data-action="set-card-changes" data-value="${n}">${n}</button>`).join('')}
      </div>
    </div>

    <button class="btn btn-primary btn-lg" data-action="create-settings-continue">${t('create.launch')}</button>
  </div>`;
}

function screenCodeReveal() {
  return `
  <div class="screen center-screen code-reveal-screen">
    <h2 class="celebrate">${t('codeReveal.title')}</h2>
    <div class="game-code">${escapeHtmlClient(AppState.gameCode || '')}</div>
    <button class="btn btn-secondary" data-action="copy-code">${t('codeReveal.copy')}</button>
    <p class="hint">${t('codeReveal.hint')}</p>
    <button class="btn btn-primary btn-lg" data-action="code-continue">${t('codeReveal.goLobby')}</button>
  </div>`;
}

function screenJoinCode() {
  const value = escapeHtmlClient(AppState.draft.joinCode || '');
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>${t('join.title')}</h2>
    <input id="join-code-input" class="text-input code-input" type="text" maxlength="6" placeholder="K7P4XZ" value="${value}" autocomplete="off" />
    <button class="btn btn-primary btn-lg" data-action="join-code-continue">${t('join.button')}</button>
    <button class="btn btn-ghost" data-action="view-public-games">${t('home.publicGames')}</button>
  </div>`;
}

function screenPublicGames() {
  const list = AppState.publicGamesList || [];
  const rows = list.length
    ? list.map((g) => `
      <li class="public-game-row">
        <div class="public-game-info">
          <span class="public-game-code">${g.code}</span>
          <span class="public-game-count">${g.playerCount} / ${g.maxPlayers} joueurs</span>
        </div>
        <button class="btn btn-secondary" data-action="join-public-game" data-code="${g.code}">${t('publicGames.join')}</button>
      </li>`).join('')
    : `<p class="hint">${t('publicGames.empty')}</p>`;

  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>${t('publicGames.title')}</h2>
    <p class="hint">${t('publicGames.hint')}</p>
    <ul class="public-games-list">${rows}</ul>
    <button class="btn btn-ghost" data-action="refresh-public-games">${t('publicGames.refresh')}</button>
  </div>`;
}

// ---------- Ecrans pilotes par l'etat serveur ----------

function renderGameScreen(root) {
  const s = AppState.publicState;
  switch (s.state) {
    case 'LOBBY': root.innerHTML = s.mode ? screenPracticeLobby(s) : screenLobby(s); break;
    case 'JUDGE_SELECTION': root.innerHTML = screenJudgeSelection(s); break;
    case 'CARD_SELECTION': root.innerHTML = screenCardSelection(s); break;
    case 'ANSWERING': root.innerHTML = screenAnswering(s); break;
    case 'JUDGING': root.innerHTML = screenJudging(s); break;
    case 'RESULTS': root.innerHTML = screenResults(s); break;
    case 'NEXT_ROUND': root.innerHTML = screenNextRound(s); break;
    case 'GAME_OVER': root.innerHTML = screenGameOver(s); break;
    case 'STOPPED': root.innerHTML = screenStopped(); break;
    default: root.innerHTML = screenLoading('Chargement...');
  }
}

function playerRow(p, opts) {
  opts = opts || {};
  const crown = p.isAdmin ? '👑 ' : '';
  const offline = !p.connected ? ' player-offline' : '';
  const kickBtn = opts.canKick && !p.isAdmin && !p.isBot
    ? `<button class="btn-kick" data-action="kick-player" data-player-id="${p.id}" aria-label="Expulser ${p.nickname}">✕</button>`
    : '';
  const spectatorTag = p.spectating ? '<span class="spectator-tag">👀 rejoint bientôt</span>' : '';
  return `
    <li class="player-row${offline}">
      <span class="player-avatar">${p.avatar}</span>
      <span class="player-name">${crown}${p.nickname}${spectatorTag}</span>
      ${opts.showScore ? `<span class="player-score">${p.score}</span>` : ''}
      ${kickBtn}
    </li>`;
}

// Lobby dedie tutoriel/demo : reglages verrouilles + explication, attente
// des bots, puis choix du role avant de lancer la manche unique.
function screenPracticeLobby(s) {
  const isDemo = s.mode === 'demo';
  const title = isDemo ? '🤖 Partie démo' : '🎓 Tutoriel guidé';
  const botsReady = s.players.filter((p) => p.isBot).length >= 2;
  const role = AppState.draft.practiceRole;

  const settingsSummary = `
    <ul class="practice-settings-summary">
      <li>🃏 Cartes normales</li>
      <li>🔒 Visibilité : privée (personne d'autre ne peut rejoindre)</li>
      <li>🏆 1 point pour gagner</li>
      <li>⏱️ 30 secondes pour répondre</li>
      <li>🔁 1 changement de carte maximum</li>
    </ul>`;

  const roleChoice = botsReady ? `
    <p class="hint">Choisis ton rôle pour cette manche :</p>
    <div class="chip-row practice-role-row">
      <button class="chip practice-role-chip ${role === 'judge' ? 'chip-active' : ''}" data-action="choose-practice-role" data-role="judge">⚖️ Juge</button>
      <button class="chip practice-role-chip ${role === 'player' ? 'chip-active' : ''}" data-action="choose-practice-role" data-role="player">✍️ Joueur</button>
    </div>
    <button class="btn btn-primary btn-lg" data-action="start-practice-game" ${role ? '' : 'disabled'}>LANCER LA PARTIE</button>
  ` : `<p class="hint practice-waiting">🤖 En attente des bots...</p>`;

  return `
  <div class="screen center-screen">
    <h2>${title}</h2>
    <p class="practice-banner">Vous êtes en ${isDemo ? 'partie démo' : 'tutoriel guidé'}. Pour une meilleure explication, nous gardons ces paramètres par défaut.</p>
    ${settingsSummary}
    <ul class="player-list">${s.players.map((p) => playerRow(p, {})).join('')}</ul>
    ${roleChoice}
    <button class="btn btn-ghost" data-action="leave-game">Quitter</button>
  </div>`;
}

function screenLobby(s) {
  const isAdmin = s.adminId === AppState.playerId;
  const count = s.players.length;
  const canStart = isAdmin && count >= s.minPlayers;
  const list = s.players.map((p) => playerRow(p, { canKick: isAdmin })).join('');

  return `
  <div class="screen lobby-screen">
    <div class="lobby-header">
      <div class="lobby-code-row">
        <span class="lobby-code-label">${t('lobby.codeLabel')}</span>
        <span class="lobby-code">${s.code}</span>
        <button class="btn-copy-code" data-action="copy-code" aria-label="Copier le code">${t('lobby.copy')}</button>
        <button class="btn-copy-code" data-action="copy-link" aria-label="Copier le lien d'invitation">${t('lobby.link')}</button>
      </div>
      <div class="lobby-count">${count} / ${s.maxPlayers} joueurs</div>
    </div>
    <ul class="player-list">${list}</ul>

    ${isAdmin ? screenLobbySettings(s) : ''}

    <div class="lobby-actions">
      ${isAdmin
        ? `<button class="btn btn-primary btn-lg" data-action="start-game" ${canStart ? '' : 'disabled'}>${t('lobby.launch')}</button>
           ${count < s.minPlayers ? `<p class="hint">Il faut au moins ${s.minPlayers} joueurs pour lancer.</p>` : ''}
           <button class="btn btn-danger" data-action="stop-game">${t('lobby.stop')}</button>`
        : `<p class="hint waiting-hint">${t('lobby.waiting')}</p>`}
      ${!AppState.pushSubscribed ? `<button class="btn btn-ghost" data-action="enable-push">${t('lobby.enablePush')}</button>` : ''}
      <button class="btn btn-ghost" data-action="leave-game">${t('lobby.leave')}</button>
    </div>
  </div>`;
}

function screenLobbySettings(s) {
  const st = s.settings;
  return `
  <div class="settings-panel">
    <h3>${t('lobby.settingsTitle')}</h3>
    ${packsBlock(st.packs, 'live-toggle-pack')}
    ${visibilityBlock(st.visibility, 'live-set-visibility')}
    <div class="setting-block">
      <span class="setting-label">${t('score.label')} <b>${st.winningScore}</b></span>
      <input type="range" min="1" max="15" step="1" value="${st.winningScore}" class="range-input" data-action="live-set-score" />
    </div>
    <div class="setting-block">
      <span class="setting-label">${t('time.label')} <b>${st.answerTime}s</b></span>
      <div class="chip-row">
        ${TIME_OPTIONS.map((tOpt) => `<button class="chip ${tOpt === st.answerTime ? 'chip-active' : ''}" data-action="live-set-time" data-time="${tOpt}">${tOpt}</button>`).join('')}
      </div>
    </div>
    <div class="setting-block">
      <span class="setting-label">${t('cardChanges.label')} <b>${st.cardChangesMax}</b></span>
      <div class="chip-row">
        ${CARD_CHANGE_OPTIONS.map((n) => `<button class="chip ${n === st.cardChangesMax ? 'chip-active' : ''}" data-action="live-set-card-changes" data-value="${n}">${n}</button>`).join('')}
      </div>
    </div>
  </div>`;
}

function judgeName(s) {
  const j = s.players.find((p) => p.id === s.judgeId);
  return j ? j.nickname : '?';
}
function judgeAvatar(s) {
  const j = s.players.find((p) => p.id === s.judgeId);
  return j ? j.avatar : '👑';
}

function screenJudgeSelection(s) {
  return `
  <div class="screen center-screen">
    <p class="dice-emoji">🎲</p>
    <h2>TIRAGE DU PREMIER JUGE...</h2>
    <div class="countdown-huge" data-endsat="${s.judgeSelectionEndsAt}">3</div>
    <div class="judge-reveal">
      <span class="judge-avatar">${judgeAvatar(s)}</span>
      <p class="judge-name">👑 ${judgeName(s).toUpperCase()}</p>
      <p class="judge-sub">C'EST TON TOUR !</p>
    </div>
  </div>`;
}

function screenCardSelection(s) {
  const priv = AppState.privateState || {};
  const isJudge = !!priv.isJudge;
  const remaining = (s.rerollsMax || 0) - (s.rerollsUsed || 0);
  const avail = s.blanksAvailability || { 1: 0, 2: 0, 3: 0 };
  const current = s.card.blanksTotal;

  const holeButtons = [1, 2, 3].map((n) => {
    const disabled = !isJudge || n === current || remaining <= 0 || !avail[n];
    return `<button class="btn btn-choice ${n === current ? 'chip-active' : ''}" data-action="reroll-card" data-blanks="${n}" ${disabled ? 'disabled' : ''}>${n}</button>`;
  }).join('');

  const needsMention = cardHasMention(s.card.text);
  const mentionChosenId = AppState.draft.cardMentionPlayerId;
  const mentionBlock = (isJudge && needsMention) ? `
    <div class="mention-block">
      <span class="reroll-label">🎯 Cette carte mentionne un joueur, choisis qui :</span>
      <div class="chip-row">
        ${s.players.filter((p) => p.id !== s.judgeId).map((p) => `
          <button class="chip" data-action="select-card-mention" data-player-id="${p.id}" ${p.id === mentionChosenId ? 'style="border-color:var(--gold)"' : ''}>${p.avatar} ${escapeHtmlClient(p.nickname)}</button>
        `).join('')}
      </div>
    </div>
  ` : '';

  const canConfirm = isJudge && (!needsMention || !!mentionChosenId);

  return `
  <div class="screen center-screen">
    <h2>${isJudge ? 'CHOISIS TA CARTE' : `👑 ${judgeName(s)} choisit sa carte...`}</h2>

    <div class="card-reveal-stage">
      <div class="card-reveal-spotlight" aria-hidden="true"></div>
      <div class="card-reveal-card" id="card-reveal-card">
        <div id="card-reveal-text" class="card-reveal-text" data-card-text="${escapeHtmlClient(needsMention ? s.card.text.split(MENTION_TOKEN).join('🎯 ???') : s.card.text)}"></div>
      </div>
    </div>

    ${s.mode ? `
      <p class="hint">🔒 Carte fixe pour cette manche de ${s.mode === 'tutorial' ? 'tutoriel' : 'démo'}.</p>
    ` : `
      <div class="reroll-block">
        <span class="reroll-label">🕳️ Trous :</span>
        <div class="reroll-row">${holeButtons}</div>
        <p class="hint">${remaining > 0 ? `Changer la carte : ${remaining} fois restante${remaining > 1 ? 's' : ''}` : 'Plus aucun changement disponible.'}</p>
      </div>
    `}
    ${mentionBlock}

    <button class="btn btn-primary btn-lg" data-action="confirm-card" ${canConfirm ? '' : 'disabled'}>✅ VALIDER</button>
  </div>`;
}

function screenAnswering(s) {
  const priv = AppState.privateState || {};
  if (priv.spectating) {
    return `
    <div class="screen center-screen">
      <h2>👀 TU REGARDES CETTE MANCHE</h2>
      <p class="hint">Tu rejoins la partie à la manche suivante.</p>
      <div class="card-face card-face-sm">
        <div class="card-text" data-fit>${cardTextWithBlanks(s.card.text)}</div>
      </div>
    </div>`;
  }
  if (priv.isJudge) {
    return `
    <div class="screen center-screen">
      <h2>👑 LES AUTRES RÉPONDENT...</h2>
      <div class="timer-ring"><span data-endsat="${s.answeringEndsAt}">--</span></div>
      <p class="answering-progress">${s.answeredCount} / ${s.expectedCount} réponses reçues</p>
      <div class="card-face card-face-sm">
        <div class="card-text" data-fit>${cardTextWithBlanks(s.card.text)}</div>
      </div>
      ${reactionBar()}
    </div>`;
  }

  if (priv.hasAnswered && !AppState.editingAnswer) {
    return `
    <div class="screen center-screen">
      <h2><span class="answer-check">✅</span> RÉPONSE ENVOYÉE</h2>
      <div class="timer-ring"><span data-endsat="${s.answeringEndsAt}">--</span></div>
      <p class="answering-progress">${s.answeredCount} / ${s.expectedCount} réponses reçues</p>
      <button class="btn btn-ghost" data-action="edit-answer">✏️ Modifier ma réponse</button>
      ${reactionBar()}
    </div>`;
  }

  const answerMaxLength = (s.settings && s.settings.answerMaxLength) || 250;
  const inputs = Array.from({ length: s.card.blanksTotal }, (_, i) => `
    <div class="answer-field">
      <label for="answer-${i}">${i + 1}.</label>
      <input id="answer-${i}" class="text-input answer-input" data-answer-index="${i}" maxlength="${answerMaxLength}" placeholder="Ta réponse..." />
      <div class="char-counter" data-counter-for="${i}">0 / ${answerMaxLength}</div>
    </div>`).join('');

  return `
  <div class="screen center-screen">
    <h2>COMPLÈTE LA CARTE</h2>
    <div class="timer-ring"><span data-endsat="${s.answeringEndsAt}">--</span></div>
    <p class="answering-progress">${s.answeredCount} / ${s.expectedCount} réponses reçues</p>
    <div class="card-face card-face-sm">
      <div class="card-text" data-fit>${cardTextWithBlanks(s.card.text)}</div>
    </div>
    <form id="answer-form">
      ${inputs}
      <button class="btn btn-primary btn-lg" data-action="submit-answer" type="button">ENVOYER</button>
    </form>
    ${reactionBar()}
  </div>`;
}

function reactionBar() {
  const emojis = ['😂', '😭', '🔥', '💀', '👏', '😱'];
  return `<div class="reaction-bar">${emojis.map((e) => `<button class="reaction-btn" data-action="send-reaction" data-emoji="${e}">${e}</button>`).join('')}</div>`;
}

function screenJudging(s) {
  const priv = AppState.privateState || {};
  if (!priv.isJudge) {
    return `
    <div class="screen center-screen">
      <p class="crown-emoji">👑</p>
      <h2>LE JUGE CHOISIT...</h2>
      <div class="timer-ring"><span data-endsat="${s.judgingEndsAt}">--</span></div>
      <p class="hint">Il examine les propositions...</p>
    </div>`;
  }

  const cards = priv.cards || [];
  const idx = Math.min(AppState.judgingIndex, cards.length - 1);
  const current = cards[idx];
  const reaction = AppState.judgingReactions[idx];

  return `
  <div class="screen center-screen">
    <h2>CHOISIS LA MEILLEURE RÉPONSE</h2>
    <div class="timer-ring"><span data-endsat="${s.judgingEndsAt}">--</span></div>
    <div class="card-face card-face-lg card-black ${reaction === 'like' ? 'card-liked' : ''} ${reaction === 'dislike' ? 'card-disliked' : ''}">
      <div class="card-text" data-fit>${current ? current.filledText.replace(/\n/g, '<br>') : ''}</div>
    </div>
    <div class="reaction-row">
      <button class="btn-reaction ${reaction === 'dislike' ? 'reaction-active' : ''}" data-action="judging-react" data-reaction="dislike" data-index="${idx}" aria-label="Je n'aime pas">👎</button>
      <button class="btn-reaction ${reaction === 'like' ? 'reaction-active' : ''}" data-action="judging-react" data-reaction="like" data-index="${idx}" aria-label="J'aime">👍</button>
    </div>
    <div class="judging-nav">
      <button class="btn btn-ghost" data-action="judging-prev" ${idx <= 0 ? 'disabled' : ''}>◀ PRÉCÉDENT</button>
      <span class="judging-pos">${cards.length ? idx + 1 : 0} / ${cards.length}</span>
      <button class="btn btn-ghost" data-action="judging-next" ${idx >= cards.length - 1 ? 'disabled' : ''}>SUIVANT ▶</button>
    </div>
    <button class="btn btn-primary btn-lg" data-action="judging-choose" data-index="${idx}">🏆 CHOISIR CETTE RÉPONSE</button>
  </div>`;
}

function screenResults(s) {
  const r = s.result;
  const others = r.others.map((o) => `
    <li class="other-answer">
      <div class="other-answer-head">${o.avatar} ${o.nickname}</div>
      <div class="other-answer-text">${o.filledText.replace(/\n/g, '<br>')}</div>
    </li>`).join('');

  const board = s.leaderboard.map((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
    return `<li class="leaderboard-row"><span>${medal}</span><span class="player-avatar">${p.avatar}</span><span class="player-name">${p.nickname}</span><span class="player-score">${p.score}</span></li>`;
  }).join('');

  return `
  <div class="screen center-screen">
    ${r.wasAuto ? '<p class="hint">⏰ TEMPS ÉCOULÉ — réponse choisie automatiquement.</p>' : ''}
    <p class="drum-emoji">🥁</p>
    <h2>🏆 GAGNANT !</h2>
    <div class="winner-reveal">
      <span class="judge-avatar">${r.winnerAvatar}</span>
      <p class="judge-name">${r.winnerNickname.toUpperCase()}</p>
      <p class="point-badge">+1 POINT</p>
    </div>
    <div class="card-face card-face-md card-black card-winner">
      <div class="card-text" data-fit>${r.filledText.replace(/\n/g, '<br>')}<br><span class="trophy-mark">🏆</span></div>
    </div>
    <button class="btn btn-secondary" data-action="download-card-image">📸 Télécharger la carte (.jpg)</button>

    ${others.length ? `<h3>AUTRES PROPOSITIONS</h3><ul class="other-answers-list">${others}</ul>` : ''}

    <h3>🏆 CLASSEMENT</h3>
    <ul class="leaderboard-list">${board}</ul>
  </div>`;
}

function screenNextRound(s) {
  return `
  <div class="screen center-screen">
    <div class="countdown-huge" data-endsat="${s.nextRoundEndsAt}">3</div>
    <p>Prochain juge :</p>
    <div class="judge-reveal">
      <span class="judge-avatar">${judgeAvatar(s)}</span>
      <p class="judge-name">👑 ${judgeName(s).toUpperCase()}</p>
    </div>
  </div>`;
}

function podiumStep(p, place) {
  if (!p) return '<div class="podium-step podium-empty"></div>';
  const medal = ['🥇', '🥈', '🥉'][place - 1];
  return `
    <div class="podium-step podium-step-${place}" style="--i:${place}">
      <span class="podium-avatar">${p.avatar}</span>
      <span class="podium-medal">${medal}</span>
      <span class="podium-name">${p.nickname}</span>
      <span class="podium-score">${p.score} pts</span>
      <div class="podium-bar podium-bar-${place}"></div>
    </div>`;
}

function screenGameOver(s) {
  const winner = s.leaderboard[0];
  const isAdmin = s.adminId === AppState.playerId;
  const [first, second, third] = s.leaderboard;
  const rest = s.leaderboard.slice(3);
  const restList = rest.map((p, i) => `
    <li class="leaderboard-row"><span>${i + 4}.</span><span class="player-avatar">${p.avatar}</span><span class="player-name">${p.nickname}</span><span class="player-score">${p.score}</span></li>`
  ).join('');

  return `
  <div class="screen center-screen victory-screen">
    <p class="confetti-emoji">🎉🎉🎉🎉🎉</p>
    <h1>VICTOIRE !</h1>
    <div class="winner-reveal winner-reveal-lg">
      <span class="judge-avatar judge-avatar-xl">${winner ? winner.avatar : '🏆'}</span>
      <p class="judge-name">${winner ? winner.nickname.toUpperCase() : ''}</p>
      <p class="point-badge">${winner ? winner.score : 0} POINTS</p>
      <p class="champion-tag">🏆 CHAMPION 🏆</p>
    </div>

    <div class="podium-row">
      ${podiumStep(second, 2)}
      ${podiumStep(first, 1)}
      ${podiumStep(third, 3)}
    </div>

    ${rest.length ? `<h3>CLASSEMENT COMPLET</h3><ul class="leaderboard-list">${restList}</ul>` : ''}

    ${s.mode ? `
      <p class="hint">${s.mode === 'tutorial' ? '🎓 Tutoriel terminé, tu connais les bases !' : '🤖 Partie démo terminée.'}</p>
      <button class="btn btn-primary btn-lg" data-action="practice-replay-same-role">🔁 Rejouer (même rôle)</button>
      <button class="btn btn-secondary btn-lg" data-action="practice-replay-other-role">🔀 Essayer l'autre rôle</button>
      <button class="btn btn-ghost" data-action="practice-go-real-game">🎮 Lancer une vraie partie avec des amis</button>
    ` : (isAdmin
      ? `<button class="btn btn-primary btn-lg" data-action="play-again">🔄 RELANCER UNE PARTIE</button>`
      : `<p class="hint">En attente que l'admin relance la partie...</p>`)}
    <button class="btn btn-ghost" data-action="leave-game">Quitter</button>
  </div>`;
}

function screenStopped() {
  return `
  <div class="screen center-screen">
    <h2>PARTIE ARRÊTÉE</h2>
    <p>L'admin a arrêté cette partie.</p>
    <button class="btn btn-primary btn-lg" data-action="back-home-hard">RETOUR À L'ACCUEIL</button>
  </div>`;
}
