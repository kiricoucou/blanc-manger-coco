'use strict';

// Remplace n'importe quel emoji decoratif de l'interface par un GIF anime,
// si configure cote serveur (.env, voir server/emojiOverrides.js). Systeme
// ENTIEREMENT SEPARE des avatars GIF -- ces deux fonctionnalites ne doivent
// jamais se marcher dessus, d'ou l'exclusion explicite ci-dessous.
//
// PAS de MutationObserver ici (une premiere version basee dessus gelait
// l'onglet : meme avec disconnect()/observe() autour de nos propres
// ecritures, le navigateur re-livrait des mutations en boucle). A la place :
// un appel explicite et synchrone juste apres chaque point de rendu connu
// (render() principal, toasts, modales, panel admin) -- moins "magique"
// mais garanti sans boucle de retroaction, puisqu'on n'observe jamais ses
// propres ecritures. Voir app.js / ui.js / admin.js pour les points d'appel.
const EmojiOverrides = {
  map: new Map(), // emoji (string) -> chemin du GIF
};

// Tout ce qui represente un AVATAR (joueur/emoji choisi) est explicitement
// exclu : c'est un systeme different (gif:<id>, voir avatarHtml dans
// cards.js). Un emoji a l'interieur d'un <svg> est aussi exclu (remplacer
// un noeud texte SVG par une balise <img> HTML n'a pas de sens).
const EMOJI_EXCLUDE_SELECTOR = [
  '.avatar-btn', '.player-avatar', '.judge-avatar', '.podium-avatar',
  '.mini-scoreboard-avatar', '.avatar-gif', '.chat-tab', '.chat-msg-author',
  'svg',
].join(', ');

function isExcludedNode(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest && el.closest(EMOJI_EXCLUDE_SELECTOR));
}

function textHasOverride(text) {
  for (const emoji of EmojiOverrides.map.keys()) {
    if (text.includes(emoji)) return true;
  }
  return false;
}

function matchOverrideAt(text, i) {
  for (const [emoji, gifPath] of EmojiOverrides.map) {
    if (text.startsWith(emoji, i)) return { emoji, gifPath };
  }
  return null;
}

function replaceEmojiInTextNode(textNode) {
  const text = textNode.nodeValue;
  const frag = document.createDocumentFragment();
  let i = 0;
  let plainStart = 0;
  while (i < text.length) {
    const match = matchOverrideAt(text, i);
    if (match) {
      if (i > plainStart) frag.appendChild(document.createTextNode(text.slice(plainStart, i)));
      const img = document.createElement('img');
      img.className = 'emoji-gif';
      img.src = match.gifPath;
      img.alt = match.emoji;
      img.loading = 'lazy';
      frag.appendChild(img);
      i += match.emoji.length;
      plainStart = i;
    } else {
      i++;
    }
  }
  if (plainStart < text.length) frag.appendChild(document.createTextNode(text.slice(plainStart)));
  if (textNode.parentNode) textNode.parentNode.replaceChild(frag, textNode);
}

// Appeler une seule fois, juste apres avoir rendu du HTML (voir points
// d'appel dans app.js/ui.js/admin.js). Idempotent : un noeud deja remplace
// ne contient plus l'emoji d'origine, un second appel ne fait rien dessus.
function applyEmojiOverridesIn(root) {
  if (!root || EmojiOverrides.map.size === 0) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && textHasOverride(node.nodeValue) && !isExcludedNode(node)) targets.push(node);
  }
  targets.forEach(replaceEmojiInTextNode);
}

function loadEmojiOverrides() {
  fetch('/api/emoji-overrides', { cache: 'no-store' }).then((r) => r.json()).then((data) => {
    EmojiOverrides.map = new Map(Object.entries(data || {}));
    applyEmojiOverridesIn(document.body);
  }).catch(() => { /* pas grave, emojis par defaut partout */ });
}

document.addEventListener('DOMContentLoaded', loadEmojiOverrides);
