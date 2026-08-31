'use strict';

const webpush = require('web-push');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const enabled = !!(PUBLIC_KEY && PRIVATE_KEY);
if (enabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
}

// Envoie une notification push a un joueur abonne. Echoue silencieusement
// (log seulement) si l'abonnement est perime ou si push n'est pas configure :
// la notification est un bonus, jamais un chemin critique du jeu.
async function sendPush(subscription, { title, body }) {
  if (!enabled || !subscription) return;
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
  } catch (err) {
    console.error('Push non envoye (abonnement perime ?):', err.message);
  }
}

module.exports = { enabled, publicKey: PUBLIC_KEY, sendPush };
