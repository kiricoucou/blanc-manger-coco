'use strict';

const { timingSafeEqual } = require('crypto');
const { CardDeck, fillCard } = require('./cardManager');

const STATES = Object.freeze({
  LOBBY: 'LOBBY',
  JUDGE_SELECTION: 'JUDGE_SELECTION',
  CARD_SELECTION: 'CARD_SELECTION',
  ANSWERING: 'ANSWERING',
  JUDGING: 'JUDGING',
  RESULTS: 'RESULTS',
  NEXT_ROUND: 'NEXT_ROUND',
  GAME_OVER: 'GAME_OVER',
  STOPPED: 'STOPPED',
  PAUSED: 'PAUSED',
});

const RECONNECT_GRACE_MS = 3 * 60 * 1000;
const JUDGE_SELECTION_MS = 3200;
const NEXT_ROUND_MS = 3200;
const JUDGING_MS = 30 * 1000;
const RESULTS_MS = 15 * 1000;

// Represente une partie complete : joueurs, parametres, manche en cours, timers.
class Game {
  constructor(code, adminPlayer, settings) {
    this.code = code;
    this.state = STATES.LOBBY;
    this.players = new Map(); // id -> Player
    this.players.set(adminPlayer.id, adminPlayer);
    this.adminId = adminPlayer.id;
    this.settings = settings; // { packs: string[], visibility, winningScore, answerTime, cardChangesMax }
    this.mode = null; // null (partie normale) | 'tutorial' | 'demo'
    this.forcedNextCard = null; // carte imposee par l'admin dashboard pour la prochaine manche
    this.deck = null;
    this.round = null; // donnees de la manche en cours
    this.roundNumber = 0;
    this.timers = {}; // nom -> Timeout handle
    this.disconnectTimers = new Map(); // playerId -> Timeout handle
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.paused = false;
    this.pausedFromState = null; // etat a restaurer par adminManager.resumeGame
  }

  touch() {
    this.lastActivity = Date.now();
  }

  clearTimer(name) {
    if (this.timers[name]) {
      clearTimeout(this.timers[name]);
      delete this.timers[name];
    }
  }

  clearAllTimers() {
    Object.keys(this.timers).forEach((name) => this.clearTimer(name));
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected && !p.kicked);
  }

  // Joueurs eligibles a participer a la manche en cours (repondre, juger) :
  // exclut les spectateurs ayant rejoint en cours de partie.
  connectedActivePlayers() {
    return this.connectedPlayers().filter((p) => !p.spectating);
  }

  activePlayers() {
    return [...this.players.values()].filter((p) => !p.kicked);
  }

  getPlayer(id) {
    return this.players.get(id) || null;
  }

  // Comparaison en temps constant : une comparaison de chaine naive (===)
  // laisse fuiter, via de minuscules variations de latence, combien de
  // caracteres du token devine correctement un attaquant.
  findByToken(token) {
    if (typeof token !== 'string' || token.length === 0) return null;
    const tokenBuf = Buffer.from(token);
    for (const p of this.players.values()) {
      const playerBuf = Buffer.from(p.token);
      if (playerBuf.length === tokenBuf.length && timingSafeEqual(playerBuf, tokenBuf)) {
        return p;
      }
    }
    return null;
  }

  // Vue publique de la partie : jamais de reponses secretes ni d'association auteur.
  getPublicState() {
    const base = {
      code: this.code,
      state: this.state,
      settings: this.settings,
      players: this.activePlayers().map((p) => p.toPublic()),
      adminId: this.adminId,
      roundNumber: this.roundNumber,
      minPlayers: 3,
      maxPlayers: 20,
      mode: this.mode,
      paused: this.paused,
    };

    if (!this.round) return base;

    base.judgeId = this.round.judgeId;

    if (this.state === STATES.JUDGE_SELECTION) {
      base.judgeSelectionEndsAt = this.round.judgeSelectionEndsAt;
    }

    if (this.state === STATES.CARD_SELECTION) {
      // La carte et les choix du juge sont visibles de tous en temps reel
      // (pas juste du juge).
      base.card = { text: this.round.card.text, blanksTotal: this.round.card.blanksTotal };
      base.rerollsUsed = this.round.rerollsUsed;
      base.rerollsMax = this.settings.cardChangesMax;
      base.blanksAvailability = this.deck ? this.deck.countByBlanks() : { 1: 0, 2: 0, 3: 0 };
    }

    if (this.state === STATES.ANSWERING) {
      base.card = {
        text: this.round.card.text,
        blanksTotal: this.round.blanksChosen,
      };
      base.answeringEndsAt = this.round.answeringEndsAt;
      base.answeredCount = this.round.answers.size;
      base.expectedCount = this.connectedActivePlayers().filter((p) => p.id !== this.round.judgeId).length;
    }

    if (this.state === STATES.JUDGING) {
      base.judgingEndsAt = this.round.judgingEndsAt;
      base.totalCards = this.round.shuffledOrder.length;
    }

    if (this.state === STATES.RESULTS) {
      base.result = this.round.result;
      base.leaderboard = this.getLeaderboard();
    }

    if (this.state === STATES.NEXT_ROUND) {
      base.nextRoundEndsAt = this.round.nextRoundEndsAt;
      base.nextJudgeId = this.round.judgeId;
    }

    if (this.state === STATES.GAME_OVER) {
      base.winnerId = this.round.result ? this.round.result.winnerId : null;
      base.leaderboard = this.getLeaderboard();
    }

    return base;
  }

  // Vue privee pour un joueur donne : ce que LUI seul doit voir.
  getPrivateState(playerId) {
    const priv = {};
    const self = this.getPlayer(playerId);
    priv.spectating = !!(self && self.spectating);
    if (!this.round) return priv;
    const isJudge = this.round.judgeId === playerId;

    if (this.state === STATES.CARD_SELECTION) {
      priv.isJudge = isJudge;
    }

    if (this.state === STATES.ANSWERING) {
      priv.isJudge = isJudge;
      priv.hasAnswered = this.round.answers.has(playerId);
    }

    if (this.state === STATES.JUDGING) {
      priv.isJudge = isJudge;
      if (isJudge) {
        priv.cards = this.round.shuffledOrder.map((entry, index) => ({
          index,
          filledText: entry.filledText,
        }));
      }
    }

    return priv;
  }

  getLeaderboard() {
    return this.activePlayers()
      .map((p) => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  startNewDeckIfNeeded() {
    if (!this.deck) {
      this.deck = new CardDeck(this.settings);
    }
  }

  fillCurrentCard(answers) {
    return fillCard(this.round.card.text, answers);
  }
}

module.exports = {
  STATES,
  Game,
  RECONNECT_GRACE_MS,
  JUDGE_SELECTION_MS,
  NEXT_ROUND_MS,
  JUDGING_MS,
  RESULTS_MS,
};
