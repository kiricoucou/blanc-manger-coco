'use strict';

// Panneau de chat persistant, monte une seule fois dans #chat-root. On ne
// reconstruit jamais le champ de saisie au fil des messages recus, sinon le
// texte en cours de frappe serait efface a chaque nouveau message (meme
// piege que le formulaire de reponse ailleurs dans l'app).
const ChatUI = (() => {
  let mounted = false;

  function mount() {
    if (mounted) return;
    const root = document.getElementById('chat-root');
    root.innerHTML = `
      <button id="chat-toggle" class="chat-toggle" aria-label="Ouvrir le chat">
        💬<span id="chat-unread-badge" class="chat-unread-badge" hidden>0</span>
      </button>
      <div id="chat-panel" class="chat-panel" hidden>
        <div class="chat-panel-header">
          <div id="chat-tabs" class="chat-tabs"></div>
          <button id="chat-close" class="chat-close" aria-label="Fermer le chat">✕</button>
        </div>
        <div id="chat-messages" class="chat-messages"></div>
        <form id="chat-form" class="chat-form">
          <input id="chat-input" class="chat-input" type="text" maxlength="300" placeholder="Message..." autocomplete="off" />
          <button type="submit" class="chat-send" aria-label="Envoyer">➤</button>
        </form>
      </div>
    `;
    document.getElementById('chat-toggle').addEventListener('click', () => {
      AppState.chatOpen = !AppState.chatOpen;
      AppState.chatUnread = 0;
      render();
    });
    document.getElementById('chat-close').addEventListener('click', () => {
      AppState.chatOpen = false;
      render();
    });
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text) return;
      const payload = { scope: AppState.chatTab === 'general' ? 'general' : 'private', text };
      if (payload.scope === 'private') payload.toPlayerId = AppState.chatTab;
      AppState.socket.emit('chatSend', payload, (res) => {
        if (!res || !res.ok) toast((res && res.error) || 'Message non envoye.', 'error');
      });
      input.value = '';
    });
    mounted = true;
  }

  function messagesForTab(tab) {
    return AppState.chatMessages.filter((m) => {
      if (tab === 'general') return m.scope === 'general';
      return m.scope === 'private' && (m.fromId === tab || m.toId === tab);
    });
  }

  // Met a jour l'affichage (visibilite, onglets, liste de messages, badge)
  // sans jamais toucher au champ de saisie.
  function update() {
    if (!AppState.gameCode || !AppState.publicState) {
      document.getElementById('chat-root').style.display = 'none';
      return;
    }
    mount();
    document.getElementById('chat-root').style.display = '';

    const badge = document.getElementById('chat-unread-badge');
    if (AppState.chatUnread > 0 && !AppState.chatOpen) {
      badge.hidden = false;
      badge.textContent = AppState.chatUnread > 9 ? '9+' : String(AppState.chatUnread);
    } else {
      badge.hidden = true;
    }

    const panel = document.getElementById('chat-panel');
    panel.hidden = !AppState.chatOpen;
    if (!AppState.chatOpen) return;

    const players = (AppState.publicState.players || []).filter((p) => p.id !== AppState.playerId);
    const tabsEl = document.getElementById('chat-tabs');
    tabsEl.innerHTML = [
      `<button class="chat-tab ${AppState.chatTab === 'general' ? 'chat-tab-active' : ''}" data-tab="general">Général</button>`,
      ...players.map((p) => `<button class="chat-tab ${AppState.chatTab === p.id ? 'chat-tab-active' : ''}" data-tab="${p.id}">${p.avatar}</button>`),
    ].join('');
    tabsEl.querySelectorAll('.chat-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        AppState.chatTab = btn.dataset.tab;
        update();
      });
    });

    const list = messagesForTab(AppState.chatTab);
    const messagesEl = document.getElementById('chat-messages');
    messagesEl.innerHTML = list.length
      ? list.map((m) => {
          if (m.isSystem) return `<div class="chat-msg chat-msg-system">${m.text}</div>`;
          const own = m.fromId === AppState.playerId;
          return `<div class="chat-msg ${own ? 'chat-msg-own' : ''}">
            <span class="chat-msg-author">${m.fromAvatar} ${m.fromNickname}</span>
            <span class="chat-msg-text">${m.text}</span>
          </div>`;
        }).join('')
      : '<p class="chat-empty">Aucun message pour l\'instant.</p>';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  return { update };
})();
