'use strict';

// Deuxieme ligne de defense contre une version perimee : lit la version
// directement dans le HTML deja parse (balise <meta>, voir server.js
// injectCacheBust), sans attendre un fetch separe qui pourrait lui aussi
// etre servi depuis un cache. Tourne en tout premier, avant meme le reste du
// script, pour recharger le plus tot possible si ce document est perime.
(function earlyVersionCheck() {
  try {
    const meta = document.querySelector('meta[name="app-version"]');
    if (!meta) return;
    const current = meta.content;
    const seen = localStorage.getItem('blancManger.appVersion');
    if (seen && seen !== current) {
      localStorage.setItem('blancManger.appVersion', current);
      location.reload();
    }
  } catch (e) { /* localStorage indisponible : tant pis, le check du DOMContentLoaded prendra le relais */ }
})();

// Rappel affiche a la creation ET a la jonction d'une partie (pas juste sur
// l'accueil) : c'est a ces deux moments precis qu'un joueur s'apprete a
// vraiment entrer en jeu avec d'autres, le rappel doit donc y etre visible.
const FUN_REMINDER_TOAST = '🎉 On est là pour rigoler : ce qui se dit dans la partie reste dans la partie !';

// Version de la Charte/CGU actuellement en vigueur. Un utilisateur qui a deja
// accepte une version anterieure (stockee en localStorage) redevra accepter
// si ce numero change (texte modifie) : ne JAMAIS le bumper a la legere.
const LEGAL_VERSION = '2026-08-31';
let legalGateShown = false;
async function requestLegalAcceptance() {
  if (legalGateShown) return;
  let accepted = null;
  try { accepted = localStorage.getItem('blancManger.legalAccepted'); } catch (e) { /* ignore */ }
  if (accepted === LEGAL_VERSION) return;
  legalGateShown = true;
  await legalGateModal();
  try { localStorage.setItem('blancManger.legalAccepted', LEGAL_VERSION); } catch (e) { /* ignore */ }
}

// Ecran de chargement (logo + barre de progression), affiche uniquement au
// tout premier chargement de la page d'accueil. Une fois masque (finish()),
// il ne revient jamais — ni pendant une partie, ni sur un re-render normal.
const LoadingScreen = (() => {
  const el = document.getElementById('loading-screen');
  const fill = document.getElementById('loading-bar-fill');
  let progress = 8;
  let trickleHandle = null;
  let finished = false;

  function apply() {
    if (fill) fill.style.width = Math.min(progress, 100) + '%';
  }

  function setProgress(target) {
    if (target > progress) { progress = target; apply(); }
  }

  function start() {
    apply();
    // Avance seule, doucement, tant que le vrai chargement (fetch + socket)
    // n'est pas termine : jamais bloque a 0%, jamais l'air fige.
    trickleHandle = setInterval(() => {
      if (progress < 85) setProgress(progress + (85 - progress) * 0.15 + 0.4);
    }, 120);
  }

  function finish() {
    if (finished || !el) return;
    finished = true;
    clearInterval(trickleHandle);
    setProgress(100);
    setTimeout(() => {
      el.classList.add('loading-screen-hidden');
      setTimeout(() => { el.hidden = true; }, 450);
    }, 200);
  }

  return { start, setProgress, finish };
})();

let lastRenderedState = null;
let lastCardRevealText = null;
let lastCardRevealEl = null;
let cardRevealTimer = null;

// Ecrit le texte de la carte lettre par lettre par-dessus la video de
// reveal. Rejoue a chaque nouvelle carte (tirage initial ou changement de
// nombre de trous), visible de tous puisque le texte vient de l'etat public.
function typewriterReveal(el, text) {
  clearTimeout(cardRevealTimer);
  el.textContent = '';
  let i = 0;
  const speed = 26;
  function step() {
    el.textContent = text.slice(0, i);
    i++;
    if (i <= text.length) cardRevealTimer = setTimeout(step, speed);
  }
  step();
}

// Evite de detruire le formulaire de reponse (et le texte deja tape) quand un
// AUTRE joueur termine sa reponse : ce simple compteur ne concerne pas ce
// joueur tant qu'il n'a pas lui-meme repondu ou que la phase ne change pas.
function shouldSkipRerender() {
  const s = AppState.publicState;
  const priv = AppState.privateState;
  if (!s || s.state !== 'ANSWERING') return false;
  if (!priv || priv.isJudge) return false;
  if (priv.hasAnswered && !AppState.editingAnswer) return false;
  return !!document.getElementById('answer-form');
}

// Remplace le render() defini dans screens.js par une version qui declenche
// aussi les effets ponctuels (confettis, sons) lors des transitions d'etat.
const CREATE_MUSIC_SCREENS = new Set(['CREATE_NICKNAME', 'CREATE_AVATAR', 'CREATE_SETTINGS', 'CODE_REVEAL']);

// Popup bloquante affichee une seule fois par partie de pratique, au tout
// debut de la manche (des que CARD_SELECTION + le role reel (isJudge) sont
// connus). Uniquement en tutoriel — jamais en demo (voir tutorialtips.js
// pour la meme distinction sur les bulles au fil de la manche).
function maybeShowPracticeBriefing() {
  const s = AppState.publicState;
  const priv = AppState.privateState;
  if (!s || s.mode !== 'tutorial' || s.state !== 'CARD_SELECTION' || s.roundNumber !== 1) return;
  if (AppState.practiceBriefingShown || !priv || typeof priv.isJudge !== 'boolean') return;
  AppState.practiceBriefingShown = true;
  const bodyHtml = priv.isJudge ? `
    <p>Voici ton rôle : <strong>le juge</strong>.</p>
    <p>Les bots vont t'envoyer une réponse à la carte que tu auras choisie. À toi de choisir celle que tu trouves la plus drôle.</p>
    <p class="hint">Astuce : il n'y a pas de bonne ou mauvaise réponse, choisis juste celle qui te fait le plus rire.</p>
  ` : `
    <p>Voici ton rôle : <strong>joueur</strong>.</p>
    <p>Complète la carte noire avec ta réponse la plus drôle. Le juge (un bot, ou toi la prochaine fois) choisira ensuite la meilleure réponse parmi toutes celles reçues.</p>
    <p class="hint">Astuce : personne ne sait qui a écrit quoi avant le résultat — laisse-toi aller !</p>
  `;
  infoModal({ title: priv.isJudge ? '⚖️ Tu es le juge' : '✍️ Tu es joueur', bodyHtml });
}

// Un joueur qui REJOINT une partie (pas celui qui l'a creee) n'a jamais vu le
// certificat d'age que le createur valide en activant un pack -18 (voir
// 'toggle-pack' plus haut) : sans ca il pourrait se retrouver expose a des
// cartes adultes sans jamais avoir confirme sa majorite lui-meme.
async function maybeGateAdultContent(s) {
  if (!s || s.mode || !s.settings || !Array.isArray(s.settings.packs)) return;
  if (s.adminId === AppState.playerId) return; // deja certifie au moment du toggle
  const hasAdult = s.settings.packs.some((id) => {
    const p = (AppState.packMeta || []).find((pp) => pp.id === id);
    return p && p.ageRestricted;
  });
  if (!hasAdult) return;
  if (AppState.ageConfirmedGame === AppState.gameCode) return;
  if (AppState.ageGateShowing) return;
  AppState.ageGateShowing = true;
  const ok = await confirmModal({
    title: '🔞 Cartes réservées aux adultes',
    body: "Cette partie utilise un pack de cartes contenant du contenu vulgaire/explicite pour adultes. L'application décline toute responsabilité quant au contenu généré par les réponses des joueurs. En continuant, tu certifies avoir plus de 18 ans — si cette affirmation est fausse, l'application se dédouane de toute conséquence liée à cette déclaration.",
    confirmLabel: 'JE CONTINUE (18+)',
    cancelLabel: 'QUITTER LA PARTIE',
    requireCheckbox: { label: "Je certifie avoir plus de 18 ans." },
  });
  AppState.ageGateShowing = false;
  if (ok) {
    AppState.ageConfirmedGame = AppState.gameCode;
  } else {
    if (AppState.socket) AppState.socket.emit('leaveGame');
    resetToHome();
  }
}

const baseRender = render;
render = function patchedRender() {
  ChatUI.update();
  ScoreboardUI.update();
  TutorialTipsUI.update();
  maybeShowPracticeBriefing();
  maybeGateAdultContent(AppState.publicState);
  applyEmojiOverridesIn(document.body); // couvre chat/scoreboard/tutorial-tip, rendus juste au-dessus
  if (shouldSkipRerender()) return;
  baseRender();
  applyEmojiOverridesIn(document.getElementById('app'));

  // Musique d'ambiance : menus (accueil + creation) et salon d'attente avant
  // le lancement -- coupee des qu'une manche demarre pour de vrai (pas de
  // nappe pendant qu'on ecrit une reponse ou qu'on juge).
  const s = AppState.publicState;
  const inMusicScreen = (!AppState.gameCode && (AppState.localFlow === 'HOME' || CREATE_MUSIC_SCREENS.has(AppState.localFlow)))
    || (s && s.state === 'LOBBY');
  if (AppState.soundOn && inMusicScreen && !MusicFX.playing) MusicFX.start();
  if ((!AppState.soundOn || !inMusicScreen) && MusicFX.playing) MusicFX.stop();

  const currentState = s ? s.state : (AppState.localFlow === 'CODE_REVEAL' ? 'CODE_REVEAL' : null);

  if (currentState !== lastRenderedState) {
    if (currentState === 'GAME_OVER') {
      Confetti.burst(180);
      SoundFX.victory();
      setTimeout(() => Confetti.burst(140), 500);
      setTimeout(() => Confetti.burst(160), 1100);
    } else if (currentState === 'RESULTS') {
      SoundFX.point();
    } else if (currentState === 'JUDGE_SELECTION') {
      SoundFX.countdown();
      if (AppState.draft) AppState.draft.cardMentionPlayerId = null;
    } else if (currentState === 'JUDGING') {
      AppState.judgingIndex = 0;
      AppState.judgingReactions = {};
    } else if (currentState === 'ANSWERING') {
      AppState.editingAnswer = false;
    }
    lastRenderedState = currentState;
  }

  // Vibration mobile quand le joueur devient juge (nouvelle manche).
  if (s && s.judgeId && s.judgeId !== AppState.lastJudgeId) {
    if (s.judgeId === AppState.playerId && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    AppState.lastJudgeId = s.judgeId;
  }

  if (currentState === 'CARD_SELECTION') {
    const el = document.getElementById('card-reveal-text');
    if (el) {
      const text = el.dataset.cardText;
      // Comparer aussi l'element : gameState et privateState arrivent souvent
      // en rafale et remplacent l'innerHTML entre les deux, ce qui detache le
      // noeud vise par un typewriter deja lance (le texte partirait dans le
      // vide) meme si le texte de la carte, lui, n'a pas change.
      if (el !== lastCardRevealEl || text !== lastCardRevealText) {
        lastCardRevealText = text;
        lastCardRevealEl = el;
        typewriterReveal(el, text);
        const cardEl = document.getElementById('card-reveal-card');
        if (cardEl) {
          cardEl.classList.remove('card-reveal-flip');
          void cardEl.offsetWidth; // force reflow pour rejouer l'animation CSS
          cardEl.classList.add('card-reveal-flip');
        }
      }
    }
  } else {
    lastCardRevealText = null;
    lastCardRevealEl = null;
  }
};

function isValidGameCodeClient(code) {
  return /^[A-Z0-9]{6}$/.test(code);
}

function resetToHome() {
  Storage.clear();
  AppState.gameCode = null;
  AppState.token = null;
  AppState.playerId = null;
  AppState.publicState = null;
  AppState.privateState = null;
  AppState.localFlow = 'HOME';
  AppState.draft = {
    nickname: '', avatar: null, joinCode: '',
    settings: { packs: ['normal'], visibility: 'private', winningScore: 5, answerTime: 30, cardChangesMax: 2 },
    practiceMode: null, practiceRole: null,
  };
  AppState.practiceBriefingShown = false;
  AppState.chatMessages = [];
  AppState.chatOpen = false;
  AppState.chatTab = 'general';
  AppState.chatUnread = 0;
  render();
}

// Reutilise pour le premier lancement d'une partie de pratique et pour les
// boutons "rejouer" en fin de partie (memes nickname/avatar/mode, pas besoin
// de repasser par l'ecran de saisie du pseudo).
async function createPracticeGameFor(nickname, mode) {
  AppState.draft.practiceMode = mode;
  AppState.practiceBriefingShown = false;
  const res = await Net.emit('createPracticeGame', {
    nickname,
    mode,
    accountToken: AppState.accountToken,
  });
  if (!res.ok) { toast(res.error || 'Impossible de démarrer.', 'error'); return false; }
  AppState.gameCode = res.code;
  AppState.token = res.token;
  AppState.playerId = res.playerId;
  Storage.save();
  AppState.localFlow = null;
  render();
  return true;
}

function currentLobbySettings() {
  return AppState.publicState && AppState.publicState.settings;
}

const Actions = {
  'toggle-password-visibility': (e, target) => {
    const input = document.getElementById(target.dataset.target);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    target.textContent = showing ? '👁' : '🙈';
    target.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  },
  'go-create': () => { AppState.draft.nickname = ''; AppState.draft.avatar = null; AppState.localFlow = 'CHOOSE_CREATE_MODE'; render(); },
  'go-join': () => { AppState.draft.joinCode = ''; AppState.localFlow = 'JOIN_CODE'; render(); },
  'back-to-home': () => { AppState.localFlow = 'HOME'; render(); },
  'back-to-choose-mode': () => { AppState.localFlow = 'CHOOSE_CREATE_MODE'; render(); },
  'view-quick-preview': () => { AppState.quickPreviewIndex = 0; AppState.localFlow = 'QUICK_PREVIEW'; render(); },
  'quick-preview-prev': () => { AppState.quickPreviewIndex = Math.max(0, (AppState.quickPreviewIndex || 0) - 1); render(); },
  'quick-preview-next': () => { AppState.quickPreviewIndex = Math.min(QUICK_PREVIEW_ANSWERS.length - 1, (AppState.quickPreviewIndex || 0) + 1); render(); },
  'quick-preview-choose': () => { toast('Bien joué ! Dans une vraie partie, ça rapporte 1 point 🏆'); },
  'choose-mode-normal': () => { AppState.draft.nickname = ''; AppState.draft.avatar = null; AppState.localFlow = 'CREATE_NICKNAME'; render(); },
  'choose-mode-tutorial': () => { AppState.draft.nickname = ''; AppState.draft.practiceMode = 'tutorial'; AppState.draft.practiceRole = null; AppState.localFlow = 'PRACTICE_NICKNAME'; render(); },
  'choose-mode-demo': () => { AppState.draft.nickname = ''; AppState.draft.practiceMode = 'demo'; AppState.draft.practiceRole = null; AppState.localFlow = 'PRACTICE_NICKNAME'; render(); },
  'practice-nickname-continue': async () => {
    const input = document.getElementById('nickname-input');
    const val = input ? input.value.trim() : '';
    if (!val) return toast('Entre un pseudo.', 'error');
    AppState.draft.nickname = val;
    AppState.draft.practiceRole = null;
    await createPracticeGameFor(val, AppState.draft.practiceMode);
  },
  'choose-practice-role': (e, target) => {
    AppState.draft.practiceRole = target.dataset.role;
    render();
  },
  'start-practice-game': async () => {
    if (!AppState.draft.practiceRole) return;
    const res = await Net.emit('startGame', { role: AppState.draft.practiceRole });
    if (!res.ok) toast(res.error || 'Impossible de lancer.', 'error');
  },
  'practice-replay-same-role': async () => {
    const role = AppState.draft.practiceRole;
    if (AppState.socket) AppState.socket.emit('leaveGame');
    Storage.clear();
    await createPracticeGameFor(AppState.draft.nickname, AppState.draft.practiceMode);
    AppState.draft.practiceRole = role;
  },
  'practice-replay-other-role': async () => {
    const role = AppState.draft.practiceRole === 'judge' ? 'player' : 'judge';
    if (AppState.socket) AppState.socket.emit('leaveGame');
    Storage.clear();
    await createPracticeGameFor(AppState.draft.nickname, AppState.draft.practiceMode);
    AppState.draft.practiceRole = role;
  },
  'practice-go-real-game': () => {
    if (AppState.socket) AppState.socket.emit('leaveGame');
    Storage.clear();
    AppState.gameCode = null;
    AppState.token = null;
    AppState.playerId = null;
    AppState.publicState = null;
    AppState.privateState = null;
    AppState.draft.nickname = '';
    AppState.draft.avatar = null;
    AppState.draft.practiceMode = null;
    AppState.draft.practiceRole = null;
    AppState.localFlow = 'CREATE_NICKNAME';
    render();
  },
  'back-home-hard': () => resetToHome(),

  'create-nickname-continue': () => {
    const input = document.getElementById('nickname-input');
    const val = input ? input.value.trim() : '';
    if (!val) return toast('Entre un pseudo.', 'error');
    AppState.draft.nickname = val;
    SoundFX.reveal();
    AppState.localFlow = 'CREATE_AVATAR';
    render();
  },
  'join-nickname-continue': () => {
    const input = document.getElementById('nickname-input');
    const val = input ? input.value.trim() : '';
    if (!val) return toast('Entre un pseudo.', 'error');
    AppState.draft.nickname = val;
    SoundFX.reveal();
    AppState.localFlow = 'JOIN_AVATAR';
    render();
  },
  'back-to-nickname': (e, target) => {
    AppState.localFlow = target.dataset.mode === 'join' ? 'JOIN_NICKNAME' : 'CREATE_NICKNAME';
    render();
  },
  'select-avatar': (e, target) => {
    AppState.draft.avatar = target.dataset.avatar;
    render();
  },
  'avatar-tab': async (e, target) => {
    AppState.avatarTab = target.dataset.tab;
    render();
    if (AppState.avatarTab === 'gif') {
      // Reload a chaque ouverture de l'onglet : l'operateur ajoute des GIF a
      // la main, sans redemarrage serveur, la liste doit donc refleter le
      // disque a l'instant present et pas un etat fige au chargement de la page.
      try {
        const res = await fetch('/api/gif-avatars');
        const data = await res.json();
        AppState.gifAvatarIds = data.ids || [];
      } catch (e2) { /* liste inchangee, tant pis */ }
      render();
    }
  },
  'back-to-avatar': (e, target) => {
    AppState.localFlow = target.dataset.mode === 'join' ? 'JOIN_AVATAR' : 'CREATE_AVATAR';
    render();
  },
  'create-avatar-continue': () => { AppState.localFlow = 'CREATE_SETTINGS'; render(); },
  'join-avatar-continue': async () => {
    const res = await Net.emit('joinGame', {
      code: AppState.draft.joinCode,
      nickname: AppState.draft.nickname,
      avatar: AppState.draft.avatar,
      accountToken: AppState.accountToken,
    });
    if (!res.ok) {
      toast(res.error || 'Impossible de rejoindre.', 'error');
      AppState.localFlow = 'JOIN_CODE';
      return render();
    }
    AppState.gameCode = AppState.draft.joinCode;
    AppState.token = res.token;
    AppState.playerId = res.playerId;
    Storage.save();
    AppState.localFlow = 'HOME';
    if (res.spectating) toast('La partie est en cours : tu rejoins à la prochaine manche.');
    toast(FUN_REMINDER_TOAST);
    render();
  },

  'toggle-pack': async (e, target) => {
    const packId = target.dataset.pack;
    const pack = (AppState.packMeta || []).find((p) => p.id === packId);
    if (!pack) return;
    const packs = AppState.draft.settings.packs;
    const selected = packs.includes(packId);
    if (selected) {
      const next = packs.filter((id) => id !== packId);
      if (next.length === 0) return toast('Il faut au moins un pack de cartes activé.', 'error');
      AppState.draft.settings.packs = next;
      // Si on retire un pack requis par un autre (ex: spicy retire alors que -18 actif), on retire aussi celui-ci.
      AppState.draft.settings.packs = AppState.draft.settings.packs.filter((id) => {
        const p = (AppState.packMeta || []).find((pp) => pp.id === id);
        return !p || !p.requires || AppState.draft.settings.packs.includes(p.requires);
      });
      return render();
    }
    if (pack.ageRestricted) {
      const ok = await confirmModal({
        title: `${pack.emoji} ${pack.name}`,
        body: "Contenu réservé aux adultes (texte uniquement, aucune image). Aucune vérification d'identité : en cochant, tu certifies avoir 18 ans ou plus. Une fausse déclaration engage ta seule responsabilité.",
        confirmLabel: 'ACTIVER',
        cancelLabel: 'ANNULER',
        requireCheckbox: { label: "Je certifie avoir plus de 18 ans et j'accepte ce contenu." },
      });
      if (!ok) return;
    }
    AppState.draft.settings.packs = [...packs, packId];
    render();
  },
  'set-visibility': (e, target) => { AppState.draft.settings.visibility = target.dataset.visibility; render(); },
  'set-score': (e, target) => { AppState.draft.settings.winningScore = Number(target.value); render(); },
  'set-time': (e, target) => { AppState.draft.settings.answerTime = Number(target.dataset.time); render(); },
  'set-card-changes': (e, target) => { AppState.draft.settings.cardChangesMax = Number(target.dataset.value); render(); },
  'create-settings-continue': async () => {
    const res = await Net.emit('createGame', {
      nickname: AppState.draft.nickname,
      avatar: AppState.draft.avatar,
      settings: AppState.draft.settings,
      accountToken: AppState.accountToken,
    });
    if (!res.ok) return toast(res.error || 'Impossible de creer la partie.', 'error');
    AppState.gameCode = res.code;
    AppState.token = res.token;
    AppState.playerId = res.playerId;
    Storage.save();
    AppState.localFlow = 'CODE_REVEAL';
    toast(FUN_REMINDER_TOAST);
    render();
  },
  'copy-code': async () => { await copyToClipboard(AppState.gameCode); toast('Code copié !'); },
  'copy-link': async () => {
    const url = `${location.origin}${location.pathname}?code=${AppState.gameCode}`;
    await copyToClipboard(url);
    toast('Lien d\'invitation copié !');
  },
  'code-continue': () => { AppState.localFlow = null; render(); },

  'view-account': async () => {
    if (!AppState.account) { AppState.localFlow = 'ACCOUNT_LOGIN'; return render(); }
    AppState.localFlow = 'ACCOUNT_PROFILE';
    render();
    refreshFriends();
  },
  'go-account-login': () => { AppState.localFlow = 'ACCOUNT_LOGIN'; render(); },
  'go-account-register': () => { AppState.localFlow = 'ACCOUNT_REGISTER'; render(); },
  'account-login': async () => {
    const username = document.getElementById('account-username').value.trim();
    const password = document.getElementById('account-password').value;

    // Un pseudo joueur ne contient jamais "@" (valide sur [a-zA-Z0-9_]) donc
    // seule une saisie avec "@" peut potentiellement etre un email admin. On
    // tente l'auth admin en silence : redirection UNIQUEMENT si email +
    // mot de passe correspondent reellement a un admin (adminLogin les
    // verifie ensemble cote serveur, jamais l'email seul). En cas d'echec on
    // ne dit rien de special sur l'admin : on retombe sur le flux compte
    // joueur normal, qui affichera son erreur habituelle (pseudo invalide).
    // Ainsi rien ne distingue de l'exterieur "email inconnu des admins" de
    // "mauvais mot de passe admin" ni ne revele quels emails sont admins.
    if (username.includes('@')) {
      const res = await Net.emit('adminLogin', { email: username, password });
      if (res.ok) {
        try { localStorage.setItem('blancManger.adminToken', res.token); } catch (e) { /* ignore */ }
        location.href = '/admin.html?welcome=1';
        return;
      }
    }

    const res = await Net.emit('accountLogin', { username, password });
    if (!res.ok) return toast(res.error || 'Erreur.', 'error');
    AppState.accountToken = res.token;
    AppState.account = res.profile;
    AccountStorage.save(res.token);
    AppState.localFlow = 'ACCOUNT_PROFILE';
    render();
    refreshFriends();
  },
  'account-register': async () => {
    const username = document.getElementById('account-username').value.trim();
    const password = document.getElementById('account-password').value;
    const age15Confirmed = document.getElementById('account-age-confirm').checked;
    if (!age15Confirmed) return toast('Tu dois confirmer avoir au moins 15 ans.', 'error');
    const res = await Net.emit('accountRegister', { username, password, age15Confirmed });
    if (!res.ok) return toast(res.error || 'Erreur.', 'error');
    AppState.accountToken = res.token;
    AppState.account = res.profile;
    AccountStorage.save(res.token);
    toast('Compte créé !');
    AppState.localFlow = 'ACCOUNT_PROFILE';
    render();
    refreshFriends();
  },
  'account-logout': async () => {
    await Net.emit('accountLogout', { token: AppState.accountToken });
    AppState.accountToken = null;
    AppState.account = null;
    AppState.friendsData = null;
    AccountStorage.clear();
    AppState.localFlow = 'HOME';
    render();
  },
  'account-delete': async () => {
    const ok = await confirmModal({
      title: 'Supprimer définitivement ton compte ?',
      body: "Cette action est irréversible : ton compte, tes statistiques, tes succès et ta liste d'amis seront définitivement supprimés. Tu ne pourras pas les récupérer.",
      confirmLabel: 'SUPPRIMER DÉFINITIVEMENT',
      cancelLabel: 'ANNULER',
      danger: true,
      requireCheckbox: { label: 'Je comprends que cette suppression est définitive et irréversible.' },
    });
    if (!ok) return;
    const res = await Net.emit('accountDeleteAccount', { token: AppState.accountToken });
    if (!res.ok) return toast(res.error || 'Erreur.', 'error');
    AppState.accountToken = null;
    AppState.account = null;
    AppState.friendsData = null;
    AccountStorage.clear();
    AppState.localFlow = 'HOME';
    toast('Compte supprimé.');
    render();
  },
  'add-friend': async () => {
    const input = document.getElementById('friend-username-input');
    const username = input.value.trim();
    if (!username) return;
    const res = await Net.emit('accountSendFriendRequest', { token: AppState.accountToken, username });
    if (!res.ok) return toast(res.error || 'Erreur.', 'error');
    input.value = '';
    toast('Demande envoyée.');
    refreshFriends();
  },
  'accept-friend': async (e, target) => {
    await Net.emit('accountRespondFriendRequest', { token: AppState.accountToken, requesterId: target.dataset.id, accept: true });
    refreshFriends();
  },
  'reject-friend': async (e, target) => {
    await Net.emit('accountRespondFriendRequest', { token: AppState.accountToken, requesterId: target.dataset.id, accept: false });
    refreshFriends();
  },
  'remove-friend': async (e, target) => {
    await Net.emit('accountRemoveFriend', { token: AppState.accountToken, accountId: target.dataset.id });
    refreshFriends();
  },
  'view-public-games': async () => {
    AppState.localFlow = 'PUBLIC_GAMES';
    render();
    const res = await Net.emit('listPublicGames', {});
    if (res.ok) { AppState.publicGamesList = res.games; render(); }
  },
  'refresh-public-games': async () => {
    const res = await Net.emit('listPublicGames', {});
    if (res.ok) { AppState.publicGamesList = res.games; render(); }
  },
  'join-public-game': (e, target) => {
    AppState.draft.joinCode = target.dataset.code;
    AppState.localFlow = 'JOIN_NICKNAME';
    render();
  },
  'join-code-continue': () => {
    const input = document.getElementById('join-code-input');
    const code = (input ? input.value : '').trim().toUpperCase();
    if (!isValidGameCodeClient(code)) return toast('Code invalide (6 caractères).', 'error');
    AppState.draft.joinCode = code;
    AppState.localFlow = 'JOIN_NICKNAME';
    render();
  },

  'kick-player': async (e, target) => {
    const playerId = target.dataset.playerId;
    const s = AppState.publicState;
    const p = s.players.find((pl) => pl.id === playerId);
    const ok = await confirmModal({
      title: `Expulser ${p ? p.nickname : ''} ?`,
      body: 'Cette action est immédiate et irréversible.',
      confirmLabel: 'EXPULSER',
      cancelLabel: 'ANNULER',
      danger: true,
    });
    if (!ok) return;
    const res = await Net.emit('kickPlayer', { playerId });
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
  'start-game': async () => {
    const res = await Net.emit('startGame');
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
  'stop-game': async () => {
    const ok = await confirmModal({
      title: 'Arrêter la partie ?',
      body: 'Tous les joueurs seront déconnectés de cette partie.',
      confirmLabel: 'ARRÊTER',
      cancelLabel: 'ANNULER',
      danger: true,
    });
    if (!ok) return;
    const res = await Net.emit('stopGame');
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
  'enable-push': async () => { await PushNotifications.subscribe(); render(); },
  'leave-game': async () => {
    const ok = await confirmModal({
      title: 'Voulez-vous réellement quitter cette partie ?',
      body: 'La partie continue sans toi pour les autres joueurs.',
      confirmLabel: 'QUITTER',
      cancelLabel: 'ANNULER',
      danger: true,
    });
    if (!ok) return;
    if (AppState.socket) AppState.socket.emit('leaveGame');
    resetToHome();
  },
  'back-to-menu': async () => {
    if (!AppState.gameCode) { resetToHome(); return; }
    const ok = await confirmModal({
      title: 'Voulez-vous réellement quitter cette partie ?',
      body: 'Retourner au menu te fera quitter la partie en cours.',
      confirmLabel: 'QUITTER',
      cancelLabel: 'ANNULER',
      danger: true,
    });
    if (!ok) return;
    if (AppState.socket) AppState.socket.emit('leaveGame');
    resetToHome();
  },

  'live-toggle-pack': async (e, target) => {
    const st = currentLobbySettings();
    if (!st) return;
    const packId = target.dataset.pack;
    const pack = (AppState.packMeta || []).find((p) => p.id === packId);
    if (!pack) return;
    const selected = st.packs.includes(packId);
    let nextPacks;
    if (selected) {
      nextPacks = st.packs.filter((id) => id !== packId);
      if (nextPacks.length === 0) return toast('Il faut au moins un pack de cartes activé.', 'error');
      nextPacks = nextPacks.filter((id) => {
        const p = (AppState.packMeta || []).find((pp) => pp.id === id);
        return !p || !p.requires || nextPacks.includes(p.requires);
      });
    } else {
      if (pack.ageRestricted) {
        const ok = await confirmModal({
          title: `${pack.emoji} ${pack.name}`,
          body: "Contenu réservé aux adultes (texte uniquement, aucune image). Aucune vérification d'identité : en cochant, tu certifies avoir 18 ans ou plus. Une fausse déclaration engage ta seule responsabilité.",
          confirmLabel: 'ACTIVER',
          cancelLabel: 'ANNULER',
          requireCheckbox: { label: "Je certifie avoir plus de 18 ans et j'accepte ce contenu." },
        });
        if (!ok) return;
      }
      nextPacks = [...st.packs, packId];
    }
    const res = await Net.emit('updateSettings', { settings: { packs: nextPacks } });
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
  'live-set-visibility': async (e, target) => {
    const res = await Net.emit('updateSettings', { settings: { visibility: target.dataset.visibility } });
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
  'live-set-score': async (e, target) => {
    await Net.emit('updateSettings', { settings: { winningScore: Number(target.value) } });
  },
  'live-set-time': async (e, target) => {
    await Net.emit('updateSettings', { settings: { answerTime: Number(target.dataset.time) } });
  },
  'live-set-card-changes': async (e, target) => {
    await Net.emit('updateSettings', { settings: { cardChangesMax: Number(target.dataset.value) } });
  },

  'reroll-card': async (e, target) => {
    const blanksTotal = Number(target.dataset.blanks);
    AppState.draft.cardMentionPlayerId = null;
    const res = await Net.emit('rerollCard', { blanksTotal });
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
  'select-card-mention': (e, target) => {
    AppState.draft.cardMentionPlayerId = target.dataset.playerId;
    render();
  },
  'confirm-card': async () => {
    // Pas de double confirmation en pratique : carte deja fixee par le
    // scenario, une manche unique et sans enjeu, la friction supplementaire
    // ne fait que ralentir/perturber la decouverte.
    if (!AppState.publicState || !AppState.publicState.mode) {
      const ok = await confirmModal({
        title: 'Valider cette carte ?',
        body: 'Ce choix est définitif, les autres joueurs vont devoir la compléter.',
        confirmLabel: 'VALIDER',
        cancelLabel: 'ANNULER',
      });
      if (!ok) return;
    }
    const res = await Net.emit('confirmCard', { mentionPlayerId: AppState.draft.cardMentionPlayerId || null });
    if (!res.ok) return toast(res.error || 'Erreur.', 'error');
    AppState.draft.cardMentionPlayerId = null;
  },

  'submit-answer': async () => {
    const inputs = document.querySelectorAll('.answer-input');
    const answers = Array.from(inputs).map((i) => i.value.trim());
    if (answers.some((a) => a.length === 0)) return toast('Complète tous les champs.', 'error');
    const res = await Net.emit('submitAnswer', { answers });
    if (!res.ok) return toast(res.error || 'Erreur.', 'error');
    AppState.editingAnswer = false;
  },
  'edit-answer': () => { AppState.editingAnswer = true; render(); },
  'send-reaction': async (e, target) => {
    const res = await Net.emit('sendReaction', { emoji: target.dataset.emoji });
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },

  'judging-react': (e, target) => {
    const idx = Number(target.dataset.index);
    const reaction = target.dataset.reaction;
    AppState.judgingReactions[idx] = AppState.judgingReactions[idx] === reaction ? null : reaction;
    render();
  },
  'judging-prev': () => { AppState.judgingIndex = Math.max(0, AppState.judgingIndex - 1); render(); },
  'judging-next': () => {
    const cards = (AppState.privateState && AppState.privateState.cards) || [];
    AppState.judgingIndex = Math.min(cards.length - 1, AppState.judgingIndex + 1);
    render();
  },
  'judging-choose': async (e, target) => {
    const index = Number(target.dataset.index);
    if (!AppState.publicState || !AppState.publicState.mode) {
      const ok = await confirmModal({
        title: 'Tu choisis cette réponse ?',
        body: 'Ce choix est définitif.',
        confirmLabel: 'CONFIRMER',
        cancelLabel: 'ANNULER',
      });
      if (!ok) return;
    }
    const res = await Net.emit('submitVote', { answerIndex: index });
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },

  'download-card-image': () => {
    const r = AppState.publicState && AppState.publicState.result;
    if (!r) return;
    downloadWinningCardImage({
      text: r.filledText,
      winnerNickname: r.winnerNickname,
      winnerAvatar: r.winnerAvatar,
      gameCode: AppState.gameCode,
    });
  },
  'play-again': async () => {
    const res = await Net.emit('playAgain');
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
  'skip-results-wait': async () => {
    const res = await Net.emit('skipResultsWait');
    if (!res.ok) toast(res.error || 'Erreur.', 'error');
  },
};

function onAppClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target || target.disabled) return;
  SoundFX.click();
  const handler = Actions[target.dataset.action];
  if (handler) handler(e, target);
}

function onAppKeydown(e) {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'nickname-input') {
    e.preventDefault();
    const action = AppState.localFlow === 'JOIN_NICKNAME' ? 'join-nickname-continue'
      : AppState.localFlow === 'PRACTICE_NICKNAME' ? 'practice-nickname-continue'
      : 'create-nickname-continue';
    Actions[action]();
  } else if (e.target.id === 'join-code-input') {
    e.preventDefault();
    Actions['join-code-continue']();
  } else if (e.target.id === 'account-username' || e.target.id === 'account-password') {
    e.preventDefault();
    Actions[AppState.localFlow === 'ACCOUNT_REGISTER' ? 'account-register' : 'account-login']();
  } else if (e.target.classList && e.target.classList.contains('answer-input')) {
    e.preventDefault();
    Actions['submit-answer']();
  }
}

function onAppInput(e) {
  if (e.target.id === 'nickname-input' && AppState.localFlow === 'JOIN_NICKNAME') {
    const val = e.target.value.trim();
    const statusEl = document.getElementById('nickname-status');
    if (!statusEl) return;
    if (!val) { statusEl.textContent = ''; return; }
    clearTimeout(onAppInput._t);
    onAppInput._t = setTimeout(async () => {
      const res = await Net.emit('checkNickname', { code: AppState.draft.joinCode, nickname: val });
      statusEl.textContent = res.available ? '✓ Disponible' : '❌ Ce pseudo est déjà utilisé.';
      statusEl.className = 'field-status ' + (res.available ? 'field-ok' : 'field-error');
    }, 300);
  }

  if (e.target.classList && e.target.classList.contains('answer-input')) {
    const idx = e.target.dataset.answerIndex;
    const counter = document.querySelector(`[data-counter-for="${idx}"]`);
    if (counter) counter.textContent = `${e.target.value.length} / ${e.target.maxLength}`;
  }
}

// Detecte une version serveur plus recente que celle vue au dernier
// chargement (le serveur redemarre a chaque deploiement, voir /api/version
// cote serveur) et force une mise a jour complete : service worker mis a
// jour, tout cache navigateur vide, page rechargee. Indispensable pour un
// PWA installe qui peut rester ouvert des jours sans jamais recharger tout
// seul — sans ca, l'utilisateur reste bloque sur un JS perime indefiniment.
// Retourne true si un reload vient d'etre declenche (appelant doit arreter
// toute autre initialisation, la page repart de zero de toute facon).
function formatServerVersionLabel(v) {
  try {
    return new Date(Number(v)).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch (e) {
    return String(v);
  }
}

async function checkForUpdate() {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    const { v } = await res.json();
    const current = String(v);
    const seen = localStorage.getItem('blancManger.appVersion');

    AppState.serverVersionLabel = formatServerVersionLabel(v);

    if (seen && seen !== current) {
      localStorage.setItem('blancManger.appVersion', current);
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      location.reload();
      return true;
    }

    localStorage.setItem('blancManger.appVersion', current);
  } catch (e) {
    // Hors ligne ou serveur inaccessible au chargement : tant pis, on
    // demarre quand meme avec ce qui est deja charge plutot que de bloquer.
  }
  return false;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (await checkForUpdate()) return; // reload en cours, inutile de continuer

  // Re-verifie periodiquement pendant que la page reste ouverte (PWA
  // installe laisse ouvert des heures/jours sans jamais recharger seul).
  setInterval(checkForUpdate, 3 * 60 * 1000);

  // Reglages son : bouton ouvre un panneau (comme l'indicateur wifi) plutot
  // que de couper directement — un clic accidentel ne coupe plus tout le
  // son, et les 2 curseurs (bips / musique) sont regles separement.
  (() => {
    const btn = document.getElementById('sound-toggle');
    const panel = document.getElementById('sound-detail-panel');
    const muteCb = document.getElementById('sound-mute-checkbox');
    const sfxSlider = document.getElementById('sfx-volume-slider');
    const musicSlider = document.getElementById('music-volume-slider');
    const sfxValueEl = document.getElementById('sfx-volume-value');
    const musicValueEl = document.getElementById('music-volume-value');

    let sfxVol = 70, musicVol = 35, muted = false;
    try {
      const savedSfx = localStorage.getItem('blancManger.sfxVolume');
      const savedMusic = localStorage.getItem('blancManger.musicVolume');
      const savedMuted = localStorage.getItem('blancManger.soundMuted');
      if (savedSfx !== null) sfxVol = Number(savedSfx);
      if (savedMusic !== null) musicVol = Number(savedMusic);
      if (savedMuted !== null) muted = savedMuted === '1';
    } catch (e) { /* ignore */ }

    function applyState() {
      AppState.soundOn = !muted;
      AppState.sfxVolume = sfxVol / 100;
      AppState.musicVolume = musicVol / 100;
      btn.textContent = muted ? '🔇' : '🔊';
      muteCb.checked = muted;
      sfxSlider.value = sfxVol;
      musicSlider.value = musicVol;
      sfxValueEl.textContent = sfxVol + '%';
      musicValueEl.textContent = musicVol + '%';
      if (muted) MusicFX.stop();
      else {
        MusicFX.setVolume();
        if (!MusicFX.playing && CREATE_MUSIC_SCREENS.has(AppState.localFlow) && !AppState.gameCode) MusicFX.start();
      }
    }
    applyState();

    function persist() {
      try {
        localStorage.setItem('blancManger.sfxVolume', String(sfxVol));
        localStorage.setItem('blancManger.musicVolume', String(musicVol));
        localStorage.setItem('blancManger.soundMuted', muted ? '1' : '0');
      } catch (e) { /* ignore */ }
    }

    function togglePanel(forceOpen) {
      const open = forceOpen !== undefined ? forceOpen : panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    }
    btn.addEventListener('click', () => togglePanel());
    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (e.target === btn || btn.contains(e.target) || panel.contains(e.target)) return;
      togglePanel(false);
    });

    muteCb.addEventListener('change', () => { muted = muteCb.checked; applyState(); persist(); });
    sfxSlider.addEventListener('input', () => { sfxVol = Number(sfxSlider.value); applyState(); persist(); });
    musicSlider.addEventListener('input', () => { musicVol = Number(musicSlider.value); applyState(); persist(); });
  })();

  // Theme clair/sombre, persiste dans localStorage.
  const themeBtn = document.getElementById('theme-toggle');
  const applyTheme = (theme) => {
    AppState.theme = theme;
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
    themeBtn.classList.toggle('active', theme === 'light');
  };
  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('blancManger.theme') || 'dark'; } catch (e) { /* ignore */ }
  applyTheme(savedTheme);
  themeBtn.addEventListener('click', () => {
    const next = AppState.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('blancManger.theme', next); } catch (e) { /* ignore */ }
  });

  // Taille de texte (independante du zoom navigateur : echelle appliquee au
  // font-size racine, tout le reste est en rem donc suit proportionnellement).
  const fontSizeBtn = document.getElementById('font-size-toggle');
  const FONT_SCALES = [
    { key: 'normal', px: 16, label: 'Aa' },
    { key: 'large', px: 18, label: 'Aa+' },
    { key: 'xlarge', px: 21, label: 'Aa++' },
  ];
  const applyFontScale = (key) => {
    const scale = FONT_SCALES.find((s) => s.key === key) || FONT_SCALES[0];
    document.documentElement.style.fontSize = scale.px + 'px';
    fontSizeBtn.textContent = scale.label;
    AppState.fontScale = scale.key;
  };
  let savedFontScale = 'normal';
  try { savedFontScale = localStorage.getItem('blancManger.fontScale') || 'normal'; } catch (e) { /* ignore */ }
  applyFontScale(savedFontScale);
  fontSizeBtn.addEventListener('click', () => {
    const idx = FONT_SCALES.findIndex((s) => s.key === AppState.fontScale);
    const next = FONT_SCALES[(idx + 1) % FONT_SCALES.length].key;
    applyFontScale(next);
    try { localStorage.setItem('blancManger.fontScale', next); } catch (e) { /* ignore */ }
  });

  // Mode daltonien : plus de bouton dedie, on respecte juste une preference
  // deja sauvegardee (reglage retire de l'UI mais pas casse pour qui l'avait active).
  let savedCb = false;
  try { savedCb = localStorage.getItem('blancManger.colorblind') === '1'; } catch (e) { /* ignore */ }
  AppState.colorblindMode = savedCb;
  document.body.classList.toggle('colorblind-mode', savedCb);

  const app = $app();
  app.addEventListener('click', onAppClick);
  app.addEventListener('input', onAppInput);
  app.addEventListener('change', onAppInput);
  app.addEventListener('keydown', onAppKeydown);

  LoadingScreen.start();
  Particles.start();
  TimerDisplay.start();
  Net.connect();
  WifiIndicator.start();

  // L'ecran de chargement disparait des que les deux prerequis du 1er
  // affichage utile sont reunis (liste des packs + connexion socket etablie),
  // avec un plafond de securite pour ne jamais rester bloque dessus.
  let packsReady = false;
  let socketReady = false;
  function maybeFinishLoading() {
    if (packsReady && socketReady) { LoadingScreen.finish(); requestLegalAcceptance(); }
  }
  const socketReadyCheck = setInterval(() => {
    if (AppState.connected) {
      socketReady = true;
      LoadingScreen.setProgress(92);
      clearInterval(socketReadyCheck);
      maybeFinishLoading();
    }
  }, 100);
  setTimeout(() => { clearInterval(socketReadyCheck); LoadingScreen.finish(); requestLegalAcceptance(); }, 6000);

  // Enregistrement precoce du service worker (installabilite PWA), independant
  // de l'abonnement push (qui reste opt-in via PushNotifications.subscribe()).
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // Menu burger de partie (quitter / retour au menu), visible uniquement en
  // jeu. Reutilise Actions/onAppClick puisque ses boutons sont hors de #app.
  const gameMenuToggle = document.getElementById('game-menu-toggle');
  const gameMenuPanel = document.getElementById('game-menu-panel');
  function closeGameMenu() {
    gameMenuPanel.hidden = true;
    gameMenuToggle.setAttribute('aria-expanded', 'false');
  }
  gameMenuToggle.addEventListener('click', () => {
    const willOpen = gameMenuPanel.hidden;
    gameMenuPanel.hidden = !willOpen;
    gameMenuToggle.setAttribute('aria-expanded', String(willOpen));
  });
  gameMenuPanel.addEventListener('click', (e) => {
    onAppClick(e);
    closeGameMenu();
  });
  document.addEventListener('click', (e) => {
    if (gameMenuPanel.hidden) return;
    if (e.target === gameMenuToggle || gameMenuPanel.contains(e.target)) return;
    closeGameMenu();
  });

  document.getElementById('tutorial-tip-root').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="dismiss-tutorial-tip"]')) TutorialTipsUI.dismiss();
  });

  document.getElementById('top-bar-code-block').addEventListener('click', onAppClick);

  fetch('/api/packs').then((r) => r.json()).then((packs) => {
    AppState.packMeta = packs;
    render();
  }).catch(() => { /* pas grave, l'ecran de parametres affichera "chargement" */ })
    .finally(() => { packsReady = true; LoadingScreen.setProgress(60); maybeFinishLoading(); });

  // Rechargee a chaque ouverture de l'ecran d'avatar (voir 'avatar-tab'),
  // ici seulement pour un premier affichage rapide si l'onglet GIF est
  // ouvert tot (ex. retour PWA sur un flux deja en cours).
  fetch('/api/gif-avatars').then((r) => r.json()).then((data) => {
    AppState.gifAvatarIds = data.ids || [];
  }).catch(() => { /* pas grave, l'onglet GIF affichera "aucun avatar" */ });

  // Lien de partage : ?code=XXXXXX ouvre direct l'ecran "rejoindre" pre-rempli.
  const sharedCode = new URLSearchParams(location.search).get('code');
  if (sharedCode && !AppState.gameCode) {
    AppState.draft.joinCode = sharedCode.toUpperCase();
    AppState.localFlow = 'JOIN_NICKNAME';
    history.replaceState(null, '', location.pathname);
  }
});
