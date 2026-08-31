'use strict';

// Etat global cote client. Ne contient jamais de logique de jeu :
// la source de verite reste le serveur (publicState / privateState).
const AppState = {
  socket: null,
  connected: false,

  // Identite de session persistee pour la reconnexion.
  gameCode: null,
  token: null,
  playerId: null,

  // Choix locaux durant le flux de creation/jonction (avant confirmation serveur).
  localFlow: 'HOME', // HOME, CREATE_NICKNAME, CREATE_AVATAR, CREATE_SETTINGS, JOIN_CODE, JOIN_NICKNAME, JOIN_AVATAR, PUBLIC_GAMES
  draft: {
    nickname: '',
    avatar: null,
    joinCode: '',
    settings: { packs: ['normal'], visibility: 'private', winningScore: 5, answerTime: 30, cardChangesMax: 2 },
    practiceMode: null, // 'tutorial' | 'demo' | null
    practiceRole: null, // 'judge' | 'player' | null, choisi dans le lobby pratique
  },

  // Popup bloquante de briefing de role (tutoriel uniquement), affichee une
  // seule fois au tout debut de chaque partie de pratique.
  practiceBriefingShown: false,

  // Derniers etats recus du serveur.
  publicState: null,
  privateState: null,

  // Etat UI ephemere (navigation carte du juge, etc.)
  judgingIndex: 0,
  judgingReactions: {}, // index -> 'like' | 'dislike', purement local (aide visuelle du juge)
  soundOn: true,

  // Packs de cartes disponibles (recharges depuis /api/packs au demarrage).
  packMeta: [],
  serverVersionLabel: '', // horodatage de demarrage serveur, affiche en petit (diagnostic cache)
  publicGamesList: [],

  // Chat en partie.
  chatMessages: [], // {id, scope, fromId, fromNickname, fromAvatar, text, sentAt, toId?}
  chatOpen: false,
  chatTab: 'general', // 'general' ou l'id d'un joueur (prive)
  chatUnread: 0,

  // Notifications push (Web Push API).
  pushSubscribed: false,

  editingAnswer: false, // rouvre le formulaire de reponse apres envoi
  lastJudgeId: null, // pour detecter la transition "tu deviens juge" (vibration)

  // Compte joueur persistant (optionnel : le jeu reste jouable en invite).
  accountToken: null,
  account: null, // profil {id, username, xp, level, wins, judgeCount, answerCount, achievements}
  friendsData: null, // {friends, incomingRequests, outgoingRequests}

  theme: 'dark', // 'dark' | 'light'
  colorblindMode: false,
  fontScale: 'normal', // 'normal' | 'large' | 'xlarge'
};

const AccountStorage = {
  KEY: 'blancManger.accountToken',
  save(token) {
    try { localStorage.setItem(AccountStorage.KEY, token); } catch (e) { /* ignore */ }
  },
  load() {
    try { return localStorage.getItem(AccountStorage.KEY); } catch (e) { return null; }
  },
  clear() {
    try { localStorage.removeItem(AccountStorage.KEY); } catch (e) { /* ignore */ }
  },
};

const Storage = {
  KEY: 'blancManger.session',
  save() {
    if (!AppState.gameCode || !AppState.token) return;
    try {
      localStorage.setItem(
        Storage.KEY,
        JSON.stringify({ code: AppState.gameCode, token: AppState.token, playerId: AppState.playerId })
      );
    } catch (e) { /* stockage indisponible, tant pis */ }
  },
  load() {
    try {
      const raw = localStorage.getItem(Storage.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  clear() {
    try { localStorage.removeItem(Storage.KEY); } catch (e) { /* ignore */ }
  },
};

const AVATARS = [
  '😀', '😎', '🤓', '🤠', '😈', '👻',
  '🤡', '🥶', '🤩', '🤑', '🐸', '🦊',
  '🐼', '🐵', '🐯', '🦁', '🐙', '🦄',
  '👽', '🤖', '👹', '👺', '💀', '🎃',
  '🤪', '😵', '🫠', '🗿', '🧠', '🐶',
];

const TIME_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120];
const CARD_CHANGE_OPTIONS = [0, 1, 2, 3, 4, 5];
