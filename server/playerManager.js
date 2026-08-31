'use strict';

const { generateId } = require('./utils');

// Represente un joueur au sein d'une partie. L'identite persiste via `token`
// pour permettre la reconnexion meme si le socket change.
class Player {
  constructor({ nickname, avatar, isAdmin }) {
    this.id = generateId();
    this.token = generateId();
    this.socketId = null;
    this.nickname = nickname;
    this.avatar = avatar;
    this.score = 0;
    this.isAdmin = !!isAdmin;
    this.connected = true;
    this.kicked = false;
    this.joinedAt = Date.now();
    // Un joueur qui rejoint en cours de partie observe sans participer
    // jusqu'au debut de la prochaine manche (voir gameManager.beginCardSelection).
    this.spectating = false;
    this.pushSubscription = null; // abonnement Web Push (notif "c'est ton tour")
    this.accountId = null; // lie a un compte persistant si connecte, sinon invite
    this.isBot = false; // joueur simule par le serveur (mode tutoriel/demo)
    this.isPlatformAdmin = false; // admin global (panel admin) ayant rejoint cette partie -> couronne
  }

  toPublic() {
    return {
      id: this.id,
      nickname: this.nickname,
      avatar: this.avatar,
      score: this.score,
      isAdmin: this.isAdmin,
      connected: this.connected,
      spectating: this.spectating,
      isBot: this.isBot,
      isPlatformAdmin: this.isPlatformAdmin,
    };
  }
}

module.exports = { Player };
