'use strict';

// Service worker minimal : uniquement pour recevoir les notifications push
// ("c'est ton tour de juger"). Pas de cache offline, pas d'interception fetch.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through : aucun cache offline (hors perimetre demande), mais un
// gestionnaire fetch est necessaire pour que le navigateur considere
// l'application comme installable (PWA).
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let data = { title: 'Ça va mal finir', body: 'Nouvelle notification.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) { /* payload non-JSON, on garde le defaut */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/brand/logo.png',
      badge: '/assets/brand/logo.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
