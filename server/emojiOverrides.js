'use strict';

// Permet de remplacer n'importe quel emoji decoratif de l'interface par un
// GIF anime, configure via .env -- SANS toucher aux avatars (systeme
// entierement separe, voir gifAvatars.js/server.js /api/gif-avatars).
//
// Convention : chaque variable d'environnement s'appelle EMOJI_<points de
// code hexadecimaux separes par ->, ex. EMOJI_1f3ae pour 🎮 (U+1F3AE), ou
// EMOJI_23f1-fe0f pour ⏱️ (U+23F1 + variation selector U+FE0F). La liste
// complete des emojis remplacables (un par ligne, en commentaire) est dans
// .env.example et .env : il suffit de decommenter une ligne et d'y mettre le
// chemin (relatif a /public) d'un GIF pour que CET emoji precis, partout
// ou il apparait dans l'appli, s'affiche comme ce GIF anime a la place.
// Variable vide ou absente = emoji par defaut inchange.
const EMOJI_VAR_RE = /^EMOJI_([0-9a-f]{1,8}(?:-[0-9a-f]{1,8})*)$/i;

function hexKeyToEmoji(hexKey) {
  return hexKey.split('-').map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
}

// Reconstruit {emoji: cheminGif} a partir des variables EMOJI_* non vides de
// process.env. Relu a chaque appel (pas de cache) : coherent avec le reste
// de la config, et permet un rechargement sans redemarrage si l'operateur
// utilise un outil qui recharge .env a chaud (sinon un redemarrage suffit).
function getEmojiOverrides(env) {
  const src = env || process.env;
  const overrides = {};
  for (const key of Object.keys(src)) {
    const m = EMOJI_VAR_RE.exec(key);
    if (!m) continue;
    const value = src[key];
    if (!value) continue;
    overrides[hexKeyToEmoji(m[1])] = value;
  }
  return overrides;
}

module.exports = { getEmojiOverrides, hexKeyToEmoji };
