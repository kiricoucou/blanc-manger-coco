'use strict';

// Avatars GIF : deposes a la main par l'operateur dans public/assets/avatars/gif/
// (voir le README.txt de ce dossier), pas geres via l'admin ni la DB. Liste
// relue a chaque appel (pas de cache) : un GIF ajoute est visible sans
// redemarrer le serveur, cout negligeable (juste un listing de dossier).
const fs = require('fs');
const path = require('path');

const GIF_DIR = path.join(__dirname, '..', 'public', 'assets', 'avatars', 'gif');

function listGifAvatarIds() {
  let files;
  try {
    files = fs.readdirSync(GIF_DIR);
  } catch (e) {
    return [];
  }
  return files
    .filter((f) => f.toLowerCase().endsWith('.gif'))
    .map((f) => f.slice(0, -4))
    .sort((a, b) => a.localeCompare(b));
}

function isValidGifAvatarId(id) {
  return typeof id === 'string' && id.length > 0 && listGifAvatarIds().includes(id);
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 Mo, large pour un mascotte gif
// Signatures reelles d'un fichier GIF (magic bytes) : on ne fait jamais
// confiance a l'extension ni au nom fourni par le client. Un fichier
// renomme en .gif mais contenant tout autre chose (script, executable...)
// est rejete ici, avant meme d'etre ecrit sur le disque.
const GIF_MAGIC = ['GIF87a', 'GIF89a'];

function looksLikeGif(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return false;
  const header = buffer.slice(0, 6).toString('ascii');
  return GIF_MAGIC.includes(header);
}

// N'accepte que des identifiants "propres" pour le nom de fichier final :
// jamais le nom fourni par le client tel quel (traversee de repertoire,
// caracteres speciaux, extension usurpee...). Tout le reste du nom est
// simplement rejete plutot que "corrige" en silence (moins surprenant pour
// l'admin qui uploade).
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,60}$/;

function isSafeGifAvatarId(id) {
  return typeof id === 'string' && SAFE_ID_RE.test(id);
}

// Ecrit un nouvel avatar GIF sur le disque a partir d'un Buffer deja decode
// (le decodage base64 se fait cote appelant). Renvoie {ok, error?, id?}.
function saveGifAvatar(id, buffer) {
  if (!isSafeGifAvatarId(id)) {
    return { ok: false, error: 'Nom invalide (lettres, chiffres, _ et - uniquement, 60 caracteres max).' };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, error: 'Fichier vide ou invalide.' };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `Fichier trop volumineux (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo).` };
  }
  if (!looksLikeGif(buffer)) {
    return { ok: false, error: "Ce fichier n'est pas un GIF valide (signature binaire incorrecte)." };
  }
  if (listGifAvatarIds().includes(id)) {
    return { ok: false, error: 'Un avatar avec ce nom existe deja.' };
  }
  try {
    fs.mkdirSync(GIF_DIR, { recursive: true });
    // flag "wx" : creation exclusive, echoue si le fichier existe deja entre
    // temps (protection contre une course entre deux uploads simultanes du
    // meme nom, en plus du check ci-dessus).
    fs.writeFileSync(path.join(GIF_DIR, id + '.gif'), buffer, { flag: 'wx' });
  } catch (e) {
    return { ok: false, error: "Echec de l'ecriture du fichier." };
  }
  return { ok: true, id };
}

function deleteGifAvatar(id) {
  if (!isSafeGifAvatarId(id) || !listGifAvatarIds().includes(id)) {
    return { ok: false, error: 'Avatar introuvable.' };
  }
  try {
    fs.unlinkSync(path.join(GIF_DIR, id + '.gif'));
  } catch (e) {
    return { ok: false, error: 'Echec de la suppression.' };
  }
  return { ok: true };
}

module.exports = {
  listGifAvatarIds,
  isValidGifAvatarId,
  saveGifAvatar,
  deleteGifAvatar,
  MAX_UPLOAD_BYTES,
};
