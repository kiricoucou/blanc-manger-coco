'use strict';

function screenAccountLogin() {
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>${t('account.login.title')}</h2>
    <input id="account-username" class="text-input" type="text" placeholder="${t('account.login.usernamePlaceholder')}" autocomplete="username" />
    <div class="password-field-wrap">
      <input id="account-password" class="text-input" type="password" placeholder="${t('account.login.passwordPlaceholder')}" autocomplete="current-password" />
      <button type="button" class="password-toggle-btn" data-action="toggle-password-visibility" data-target="account-password" aria-label="Afficher le mot de passe">👁</button>
    </div>
    <button class="btn btn-primary btn-lg" data-action="account-login">${t('account.login.submit')}</button>
    <button class="btn btn-ghost" data-action="go-account-register">${t('account.login.createAccount')}</button>
  </div>`;
}

function screenAccountRegister() {
  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>${t('account.register.title')}</h2>
    <p class="hint">${t('account.register.hint')}</p>
    <input id="account-username" class="text-input" type="text" placeholder="${t('account.register.usernamePlaceholder')}" autocomplete="username" />
    <div class="password-field-wrap">
      <input id="account-password" class="text-input" type="password" placeholder="${t('account.register.passwordPlaceholder')}" autocomplete="new-password" />
      <button type="button" class="password-toggle-btn" data-action="toggle-password-visibility" data-target="account-password" aria-label="Afficher le mot de passe">👁</button>
    </div>
    <label class="modal-checkbox-row">
      <input type="checkbox" id="account-age-confirm" />
      <span>Je certifie avoir 15 ans ou plus.</span>
    </label>
    <button class="btn btn-primary btn-lg" data-action="account-register">${t('account.register.submit')}</button>
    <button class="btn btn-ghost" data-action="go-account-login">${t('account.register.haveAccount')}</button>
  </div>`;
}

function achievementBadge(a) {
  return `
    <div class="achievement-badge ${a.unlocked ? 'achievement-unlocked' : 'achievement-locked'}" title="${escapeHtmlClient(a.desc)}">
      <span class="achievement-icon">${a.unlocked ? '🏆' : '🔒'}</span>
      <span class="achievement-name">${escapeHtmlClient(a.name)}</span>
    </div>`;
}

function friendRow(f, opts) {
  opts = opts || {};
  return `
    <li class="friend-row">
      <span class="friend-dot ${f.online ? 'friend-online' : ''}"></span>
      <span class="friend-name">${escapeHtmlClient(f.username)}</span>
      ${opts.actions || ''}
    </li>`;
}

function screenAccountProfile() {
  const acc = AppState.account;
  if (!acc) return screenAccountLogin();

  const nextLevelXp = acc.level * acc.level * 50;
  const prevLevelXp = (acc.level - 1) * (acc.level - 1) * 50;
  const pct = Math.min(100, Math.max(0, ((acc.xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100));

  const fd = AppState.friendsData || { friends: [], incomingRequests: [], outgoingRequests: [] };

  return `
  <div class="screen center-screen">
    <button class="btn-back" data-action="back-to-home">${t('back')}</button>
    <h2>👤 ${escapeHtmlClient(acc.username)}</h2>

    <div class="account-level-block">
      <span class="account-level-label">${t('account.profile.level')} ${acc.level}</span>
      <div class="mini-scoreboard-bar"><div class="mini-scoreboard-fill" style="width:${pct}%"></div></div>
      <span class="hint">${acc.xp} XP</span>
    </div>

    <div class="account-stats-row">
      <div class="account-stat"><span class="account-stat-num">${acc.wins}</span><span class="hint">${t('account.profile.statsWins')}</span></div>
      <div class="account-stat"><span class="account-stat-num">${acc.judgeCount}</span><span class="hint">${t('account.profile.statsJudge')}</span></div>
      <div class="account-stat"><span class="account-stat-num">${acc.answerCount}</span><span class="hint">${t('account.profile.statsAnswers')}</span></div>
    </div>

    <h3>${t('account.profile.achievements')}</h3>
    <div class="achievement-grid">${acc.achievements.map(achievementBadge).join('')}</div>

    <h3>${t('account.profile.friends')}</h3>
    <div class="friend-add-row">
      <input id="friend-username-input" class="text-input" type="text" placeholder="${t('account.profile.addFriendPlaceholder')}" />
      <button class="btn btn-secondary" data-action="add-friend">${t('account.profile.add')}</button>
    </div>

    ${fd.incomingRequests.length ? `
      <p class="hint">${t('account.profile.incoming')}</p>
      <ul class="friend-list">${fd.incomingRequests.map((r) => friendRow(r, {
        actions: `<button class="btn-copy-code" data-action="accept-friend" data-id="${r.id}">✅</button><button class="btn-kick" data-action="reject-friend" data-id="${r.id}">✕</button>`,
      })).join('')}</ul>` : ''}

    ${fd.outgoingRequests.length ? `
      <p class="hint">${t('account.profile.outgoing')}</p>
      <ul class="friend-list">${fd.outgoingRequests.map((r) => friendRow(r)).join('')}</ul>` : ''}

    <ul class="friend-list">
      ${fd.friends.length ? fd.friends.map((f) => friendRow(f, {
        actions: `<button class="btn-kick" data-action="remove-friend" data-id="${f.id}">✕</button>`,
      })).join('') : `<p class="hint">${t('account.profile.noFriends')}</p>`}
    </ul>

    <button class="btn btn-ghost" data-action="account-logout">${t('account.profile.logout')}</button>
    <button class="btn btn-danger" data-action="account-delete">🗑️ Supprimer mon compte définitivement</button>
  </div>`;
}

async function refreshFriends() {
  if (!AppState.accountToken) return;
  const res = await Net.emit('accountListFriends', { token: AppState.accountToken });
  if (res.ok) {
    AppState.friendsData = { friends: res.friends, incomingRequests: res.incomingRequests, outgoingRequests: res.outgoingRequests };
    render();
  }
}
