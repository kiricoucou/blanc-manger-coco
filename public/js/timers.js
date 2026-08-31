'use strict';

// Affiche un decompte purement visuel a partir d'un timestamp serveur (endsAt).
// Le client n'arbitre jamais l'expiration : il ne fait qu'afficher le temps
// restant tel que calcule depuis l'horodatage envoye par le serveur.
const TimerDisplay = (() => {
  let intervalHandle = null;
  const lastTickedSecond = new WeakMap(); // node -> dernier entier de seconde ayant sonne

  function tick() {
    document.querySelectorAll('[data-endsat]').forEach((node) => {
      const endsAt = Number(node.getAttribute('data-endsat'));
      const remainingMs = endsAt - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      node.textContent = String(remainingSec);
      const critical = remainingSec <= 5 && remainingSec > 0;
      node.classList.toggle('timer-low', remainingSec <= 5);
      const ring = node.closest('.timer-ring');
      if (ring) ring.classList.toggle('timer-ring-critical', critical);

      // Bip une seule fois par seconde entiere, dans les 5 dernieres secondes.
      if (critical && lastTickedSecond.get(node) !== remainingSec) {
        lastTickedSecond.set(node, remainingSec);
        if (typeof SoundFX !== 'undefined') SoundFX.countdown();
      }
    });

    document.querySelectorAll('[data-endsat-bar]').forEach((node) => {
      const endsAt = Number(node.getAttribute('data-endsat-bar'));
      const total = Number(node.getAttribute('data-total-ms'));
      const remainingMs = Math.max(0, endsAt - Date.now());
      const pct = total > 0 ? Math.max(0, Math.min(100, (remainingMs / total) * 100)) : 0;
      node.style.width = pct + '%';
    });
  }

  function start() {
    if (intervalHandle) return;
    intervalHandle = setInterval(tick, 200);
    tick();
  }

  function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  return { start, stop, tick };
})();
