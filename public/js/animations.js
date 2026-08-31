'use strict';

// Fond de particules flottantes, ambiant et continu, en canvas natif.
const Particles = (() => {
  const canvas = document.getElementById('particles-canvas');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Deux palettes : neons satures sur fond sombre, pastels doux et sans halo
  // sur fond clair (un halo neon sur blanc rendrait juste sale).
  // Memes teintes que les tokens CSS (--pink/--cyan/--violet/--gold), mais en
  // rgba() code en dur : le canvas ne peut pas lire les custom properties.
  const PALETTES = {
    dark: ['rgba(194,67,74,0.85)', 'rgba(92,86,176,0.8)', 'rgba(110,84,173,0.8)', 'rgba(204,154,74,0.8)'],
    light: ['rgba(176,58,64,0.35)', 'rgba(77,71,143,0.3)', 'rgba(92,70,150,0.3)', 'rgba(166,122,53,0.35)'],
  };
  let particles = [];
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let pointerX = 0.5;
  let pointerY = 0.5;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  window.addEventListener('pointermove', (e) => {
    pointerX = e.clientX / window.innerWidth;
    pointerY = e.clientY / window.innerHeight;
  });

  function currentPalette() {
    return AppState.theme === 'light' ? PALETTES.light : PALETTES.dark;
  }

  function seed() {
    const count = Math.min(90, Math.floor((window.innerWidth * window.innerHeight) / 11000));
    particles = Array.from({ length: count }, () => spawn());
  }

  function spawn() {
    const palette = currentPalette();
    // depth in [0,1] : les particules "loin" (petites) bougent moins avec le
    // pointeur et sont plus floues -> impression de profondeur 3D en parallaxe.
    const depth = Math.random();
    return {
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: 1.5 + depth * 5,
      depth,
      vx: (Math.random() - 0.5) * 0.22,
      vy: -0.15 - Math.random() * 0.32,
      color: palette[Math.floor(Math.random() * palette.length)],
      drift: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.008 + Math.random() * 0.02,
      twinklePhase: Math.random() * Math.PI * 2,
    };
  }

  function tick() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const parallaxX = (pointerX - 0.5) * 16;
    const parallaxY = (pointerY - 0.5) * 16;
    const isLight = AppState.theme === 'light';
    particles.forEach((p) => {
      p.drift += 0.006;
      p.twinklePhase += p.twinkleSpeed;
      p.x += p.vx + Math.sin(p.drift) * 0.12;
      p.y += p.vy;
      if (p.y < -10) { p.y = window.innerHeight + 10; p.x = Math.random() * window.innerWidth; }
      if (p.x < -10) p.x = window.innerWidth + 10;
      if (p.x > window.innerWidth + 10) p.x = -10;
      const twinkle = 0.5 + 0.5 * Math.sin(p.twinklePhase);
      const radius = p.r * (0.8 + twinkle * 0.5);
      const drawX = p.x + parallaxX * p.depth;
      const drawY = p.y + parallaxY * p.depth;
      ctx.beginPath();
      ctx.globalAlpha = (isLight ? 0.35 : 0.55) + twinkle * (isLight ? 0.3 : 0.45);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = isLight ? 3 : 10;
      ctx.filter = isLight ? `blur(${(1 - p.depth) * 1.2}px)` : 'none';
      ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.filter = 'none';
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });
    requestAnimationFrame(tick);
  }

  function start() {
    seed();
    if (!reduceMotion) requestAnimationFrame(tick);
  }

  return { start };
})();

// Inclinaison 3D au survol : un seul moment signature (la carte gagnante
// revelee) plus les deux CTA d'accueil. Volontairement pas applique partout
// (badges, stats, lignes de liste...) : un effet 3D sur chaque petit element
// est justement ce qui donne un rendu "generique IA". Vanilla-Tilt.js gere
// l'easing et le reset proprement, sans reinventer la roue.
const TILT_SELECTOR = '.btn-primary.btn-lg, .btn-secondary.btn-lg, .card-face.card-winner';

function initSignatureTilt(root) {
  if (typeof VanillaTilt === 'undefined') return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;
  const targets = (root || document).querySelectorAll(TILT_SELECTOR);
  targets.forEach((el) => {
    if (el.vanillaTilt) return; // deja initialise (evite les doublons au re-rendu)
    VanillaTilt.init(el, {
      max: 6,
      speed: 500,
      scale: 1.015,
      glare: false,
      perspective: 1200,
      easing: 'cubic-bezier(.03,.98,.52,.99)',
    });
  });
}

// Reactions rapides flottantes (emoji qui montent puis disparaissent).
const FloatingReactions = (() => {
  function spawn(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (20 + Math.random() * 60) + 'vw';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
  return { spawn };
})();

// Systeme de confettis en canvas, sans dependance externe. Le canvas
// n'existe que sur la page joueur (victoire de partie) : sur admin.html,
// qui charge ce meme fichier pour Particles (fond anime), ce module doit
// pouvoir se charger sans planter juste parce que son propre canvas manque.
const Confetti = (() => {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return { burst() {} };
  const ctx = canvas.getContext('2d');
  let particles = [];
  let running = false;
  const colors = ['#c2434a', '#cc9a4a', '#5c56b0', '#6e54ad', '#5cae7c', '#d98a4a'];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function burst(count) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const n = count || 140;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.3,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        vr: (Math.random() - 0.5) * 12,
        life: 0,
        maxLife: 200 + Math.random() * 120,
      });
    }
    if (!running) loop();
  }

  function loop() {
    running = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.rotation += p.vr;
      p.life++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    particles = particles.filter((p) => p.life < p.maxLife && p.y < canvas.height + 40);
    if (particles.length > 0) {
      requestAnimationFrame(loop);
    } else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  return { burst };
})();

// Nappe musicale d'ambiance synthetisee (aucun fichier audio requis).
// Jouee pendant l'ecran de creation de partie tant que le son est active.
const MusicFX = (() => {
  let ctx = null;
  let nodes = null;
  let playing = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function start() {
    if (playing || !AppState.soundOn) return;
    try {
      const c = getCtx();
      const master = c.createGain();
      master.gain.value = 0;
      master.connect(c.destination);
      master.gain.linearRampToValueAtTime(0.05, c.currentTime + 1.2);

      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      filter.connect(master);

      const notes = [130.81, 164.81, 196.0, 246.94]; // Do-Mi-Sol-Si, nappe douce
      const oscillators = notes.map((freq, i) => {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = (i - 1.5) * 4;
        const gain = c.createGain();
        gain.gain.value = 0.6 / notes.length;
        osc.connect(gain).connect(filter);
        osc.start();
        return osc;
      });

      const lfo = c.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();

      nodes = { master, filter, oscillators, lfo };
      playing = true;
    } catch (e) { /* audio indisponible, on ignore silencieusement */ }
  }

  function stop() {
    if (!playing || !nodes) { playing = false; return; }
    const c = getCtx();
    nodes.master.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
    const toStop = nodes;
    setTimeout(() => {
      toStop.oscillators.forEach((o) => { try { o.stop(); } catch (e) {} });
      try { toStop.lfo.stop(); } catch (e) {}
    }, 700);
    nodes = null;
    playing = false;
  }

  return { start, stop, get playing() { return playing; } };
})();

// Petit lecteur de sons synthetises (pas de fichiers requis, marche toujours).
const SoundFX = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function beep(freq, duration, type) {
    if (!AppState.soundOn) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + duration);
    } catch (e) { /* audio indisponible, on ignore silencieusement */ }
  }
  return {
    click: () => beep(440, 0.08, 'square'),
    countdown: () => beep(300, 0.12, 'triangle'),
    reveal: () => beep(600, 0.2, 'sine'),
    point: () => beep(880, 0.25, 'sine'),
    victory: () => { beep(523, 0.15); setTimeout(() => beep(659, 0.15), 130); setTimeout(() => beep(784, 0.3), 260); },
  };
})();
