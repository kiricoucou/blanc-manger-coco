'use strict';

const Net = (() => {
  function connect() {
    const socket = io({ transports: ['websocket', 'polling'], reconnection: true });
    AppState.socket = socket;

    socket.on('connect', () => {
      AppState.connected = true;
      WifiIndicator.refresh(); // mesure immediate, pas d'attente du prochain tick de l'intervalle

      // Lien "Rejoindre en spectateur" ouvert depuis le dashboard admin :
      // ticket a usage unique, prioritaire sur une eventuelle reconnexion.
      const adminJoinTicket = new URLSearchParams(location.search).get('adminJoin');
      if (adminJoinTicket) {
        history.replaceState(null, '', location.pathname);
        socket.emit('joinGameAsAdmin', { ticket: adminJoinTicket }, (res) => {
          if (res && res.ok) {
            AppState.gameCode = res.code;
            AppState.token = res.token;
            AppState.playerId = res.playerId;
            Storage.save();
          } else {
            toast((res && res.error) || 'Lien invalide ou expire.', 'error');
          }
          render();
        });
        return;
      }

      const saved = Storage.load();
      if (saved && saved.code && saved.token) {
        socket.emit('reconnectPlayer', { code: saved.code, token: saved.token }, (res) => {
          if (res && res.ok) {
            AppState.gameCode = saved.code;
            AppState.token = saved.token;
            AppState.playerId = res.playerId;
          } else {
            Storage.clear();
            render();
          }
        });
      } else {
        render();
      }

      const savedAccountToken = AccountStorage.load();
      if (savedAccountToken) {
        socket.emit('accountResumeSession', { token: savedAccountToken }, (res) => {
          if (res && res.ok) {
            AppState.accountToken = savedAccountToken;
            AppState.account = res.profile;
            render();
          } else {
            AccountStorage.clear();
          }
        });
      }
    });

    socket.on('achievementUnlocked', (payload) => {
      toast(`🏆 Succès débloqué : ${payload.name}`, 'info');
      if (AppState.account) {
        AppState.account.achievements = AppState.account.achievements.map((a) =>
          a.key === payload.key ? { ...a, unlocked: true } : a
        );
      }
    });

    socket.on('disconnect', () => {
      AppState.connected = false;
      toast('Connexion perdue, reconnexion en cours...', 'error');
      render();
      WifiIndicator.refresh();
    });

    socket.on('gameState', (state) => {
      AppState.publicState = state;
      render();
    });

    socket.on('privateState', (state) => {
      AppState.privateState = state;
      render();
    });

    socket.on('errorMessage', (payload) => {
      toast(payload && payload.message ? payload.message : 'Erreur.', 'error');
    });

    socket.on('reaction', (payload) => {
      FloatingReactions.spawn(payload.emoji);
    });

    socket.on('chatMessage', (message) => {
      AppState.chatMessages.push(message);
      if (AppState.chatMessages.length > 200) AppState.chatMessages.shift();
      if (message.isSystem) {
        toast(message.text, 'info');
        render();
        return;
      }
      const isOwn = message.fromId === AppState.playerId;
      const relevantTab = message.scope === 'general' ? 'general' : (message.fromId === AppState.playerId ? message.toId : message.fromId);
      if (!isOwn && (!AppState.chatOpen || AppState.chatTab !== relevantTab)) {
        AppState.chatUnread += 1;
        SoundFX.click();
      }
      render();
    });

    socket.on('kicked', (payload) => {
      Storage.clear();
      AppState.gameCode = null;
      AppState.token = null;
      AppState.playerId = null;
      AppState.publicState = null;
      AppState.privateState = null;
      AppState.localFlow = 'HOME';
      toast(payload && payload.message ? payload.message : 'Tu as ete expulse.', 'error');
      render();
    });

    return socket;
  }

  function emit(event, payload) {
    return new Promise((resolve) => {
      if (!AppState.socket) return resolve({ ok: false, error: 'Non connecte.' });
      AppState.socket.emit(event, payload || {}, (res) => resolve(res || { ok: false }));
    });
  }

  return { connect, emit };
})();

// Indicateur wifi : mesure la latence reelle aller-retour vers le serveur
// (pas une simulation), affiche un score /20 + mini graphique d'historique.
// Tout est au clic/tap (pas au survol) pour que les telephones y aient acces.
const WifiIndicator = (() => {
  const el = document.getElementById('wifi-indicator');
  const scoreEl = document.getElementById('wifi-score');
  const panel = document.getElementById('wifi-detail-panel');
  const panelLabel = document.getElementById('wifi-detail-label');
  const panelScore = document.getElementById('wifi-detail-score');
  const panelMs = document.getElementById('wifi-detail-ms');
  const graphLine = document.getElementById('wifi-graph-line');
  let intervalHandle = null;
  let everMeasured = false; // distingue "pas encore mesure" de "vraiment hors ligne"
  const history = []; // derniers RTT en ms, null = hors ligne, pour le mini graphique
  const HISTORY_MAX = 15;

  const LABELS = {
    'wifi-good': 'Bonne connexion',
    'wifi-medium': 'Connexion moyenne',
    'wifi-bad': 'Connexion faible',
    'wifi-offline': 'Hors ligne',
    'wifi-pending': 'Calcul en cours',
  };

  // Tant qu'aucune mesure reelle n'est encore arrivee (juste apres le
  // chargement de la page, avant que le socket ait fini de se connecter),
  // afficher "Calcul en cours" plutot qu'un faux "Hors ligne / 0/20" qui
  // donnait l'impression que la connexion etait mauvaise ou lente.
  function setPending() {
    el.classList.remove('wifi-good', 'wifi-medium', 'wifi-bad', 'wifi-offline');
    el.classList.add('wifi-pending');
    scoreEl.textContent = 'Calcul en cours';
    el.setAttribute('aria-label', 'Calcul en cours');
    el.setAttribute('title', 'Calcul en cours');
  }

  // RTT 0ms -> 20/20, RTT >= 500ms (ou hors ligne) -> 0/20.
  function scoreFromRtt(rttMs) {
    if (typeof rttMs !== 'number') return 0;
    return Math.max(0, Math.min(20, Math.round(20 - (rttMs / 500) * 20)));
  }

  function drawGraph() {
    const samples = history.filter((v) => typeof v === 'number');
    if (samples.length < 2) { graphLine.setAttribute('points', ''); return; }
    const max = Math.max(500, ...samples);
    const w = 160;
    const h = 40;
    const step = w / (HISTORY_MAX - 1);
    const points = history.map((v, i) => {
      const x = i * step;
      if (typeof v !== 'number') return null;
      const y = h - (v / max) * h;
      return `${x.toFixed(1)},${Math.max(2, Math.min(h - 2, y)).toFixed(1)}`;
    }).filter(Boolean);
    graphLine.setAttribute('points', points.join(' '));
  }

  function setLevel(level, rttMs) {
    everMeasured = true;
    el.classList.remove('wifi-good', 'wifi-medium', 'wifi-bad', 'wifi-offline', 'wifi-pending');
    el.classList.add(level);
    const base = LABELS[level] || 'Qualité de connexion';
    const score = scoreFromRtt(rttMs);
    const withMs = typeof rttMs === 'number' ? `${base} — ${rttMs} ms — ${score}/20` : `${base} — ${score}/20`;
    el.setAttribute('aria-label', withMs);
    el.setAttribute('title', withMs);
    scoreEl.textContent = `${score}/20`;

    history.push(typeof rttMs === 'number' ? rttMs : null);
    if (history.length > HISTORY_MAX) history.shift();

    if (!panel.hidden) {
      panelLabel.textContent = base;
      panelScore.textContent = `${score}/20`;
      panelMs.textContent = typeof rttMs === 'number' ? `${rttMs} ms` : '— ms';
      drawGraph();
    }
  }

  function togglePanel(forceOpen) {
    const open = forceOpen !== undefined ? forceOpen : panel.hidden;
    panel.hidden = !open;
    el.setAttribute('aria-expanded', String(open));
    if (open) drawGraph();
  }

  el.addEventListener('click', () => togglePanel());
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (e.target === el || el.contains(e.target) || panel.contains(e.target)) return;
    togglePanel(false);
  });

  function measure() {
    if (!AppState.socket || !AppState.connected) {
      // Pas encore connecte du tout (juste apres le chargement de la page) :
      // "Calcul en cours", pas "Hors ligne" — le socket est probablement en
      // train de se connecter, pas coupe.
      if (!everMeasured) setPending();
      else setLevel('wifi-offline');
      return;
    }
    const sentAt = Date.now();
    let answered = false;
    AppState.socket.emit('ping', { t: sentAt }, () => {
      answered = true;
      const rtt = Date.now() - sentAt;
      if (rtt < 120) setLevel('wifi-good', rtt);
      else if (rtt < 320) setLevel('wifi-medium', rtt);
      else setLevel('wifi-bad', rtt);
    });
    setTimeout(() => { if (!answered) setLevel('wifi-bad'); }, 1800);
  }

  function start() {
    setPending();
    if (intervalHandle) return;
    measure();
    // Intervalle plus court : le score se met a jour plus vite, moins
    // l'impression que l'indicateur est fige/lent a reagir.
    intervalHandle = setInterval(measure, 2500);
  }

  return { start, refresh: measure };
})();
