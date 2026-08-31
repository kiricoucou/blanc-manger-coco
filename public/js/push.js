'use strict';

// Abonnement aux notifications push (API Web Push standard, necessite un
// contexte securise : HTTPS en prod, localhost accepte en dev).
const PushNotifications = (() => {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast("Les notifications ne sont pas supportées par ce navigateur.", 'error');
      return false;
    }
    try {
      const keyRes = await fetch('/api/vapid-public-key').then((r) => r.json());
      if (!keyRes.enabled) {
        toast('Notifications push non configurées sur ce serveur.', 'error');
        return false;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('Notifications refusées.', 'error');
        return false;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
        });
      }

      const res = await new Promise((resolve) => {
        AppState.socket.emit('pushSubscribe', { subscription: subscription.toJSON() }, resolve);
      });
      if (!res || !res.ok) {
        toast((res && res.error) || 'Abonnement refusé.', 'error');
        return false;
      }
      AppState.pushSubscribed = true;
      toast('Notifications activées ! Tu seras prévenu à ton tour de juger.');
      return true;
    } catch (err) {
      console.error('Push subscribe error:', err);
      toast('Impossible d\'activer les notifications.', 'error');
      return false;
    }
  }

  return { subscribe };
})();
