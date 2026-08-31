'use strict';

// Miroir client de la logique de parsing de carte (affichage uniquement,
// jamais utilise pour arbitrer la partie).
const BLANK_TOKEN = '______';
// Carte qui designe un joueur precis ("...pour la mere de {user}.") : le juge
// choisit la cible parmi les autres joueurs au moment de valider la carte
// (voir screenCardSelection / 'select-card-mention'), avant que quiconque
// ne voie le texte resolu.
const MENTION_TOKEN = '{user}';
function cardHasMention(text) {
  return typeof text === 'string' && text.includes(MENTION_TOKEN);
}

function parseCardClient(text) {
  const segments = text.split(BLANK_TOKEN);
  return { segments, blanksTotal: segments.length - 1 };
}

// Construit le HTML d'une carte avec ses trous representes par des chips numerotees.
function cardTextWithBlanks(text, filledValues) {
  const { segments } = parseCardClient(text);
  let html = escapeHtmlClient(segments[0]);
  for (let i = 1; i < segments.length; i++) {
    const value = filledValues && filledValues[i - 1] ? filledValues[i - 1] : null;
    if (value) {
      html += `<span class="blank-filled">${escapeHtmlClient(value)}</span>`;
    } else {
      html += `<span class="blank-slot">______</span>`;
    }
    html += escapeHtmlClient(segments[i]);
  }
  // {user} restant (pas encore resolu par le juge) : affiche comme un slot
  // en attente plutot que le token brut, illisible pour un joueur.
  html = html.split(MENTION_TOKEN).join('<span class="blank-slot">🎯 ???</span>');
  return html.replace(/\n/g, '<br>');
}

// Variante de cardTextWithBlanks pour une carte DEJA remplie par le serveur
// (juge qui compare les reponses, ecran de resultat) : les reponses des
// joueurs doivent visuellement se distinguer du texte fixe de la carte (une
// autre couleur), sur tous les appareils -- jusqu'ici JUDGING/RESULTS
// affichaient un flux de texte plat sans cette distinction.
// IMPORTANT : answers vient du serveur deja echappe HTML (sanitizeText cote
// serveur, meme convention que les pseudos) -> ne JAMAIS le re-echapper ici
// (sinon double-echappement, ex. "&lt;3" affiche au lieu de "<3").
function filledCardWithHighlight(cardText, answers) {
  const { segments } = parseCardClient(cardText || '');
  let html = escapeHtmlClient(segments[0]);
  for (let i = 1; i < segments.length; i++) {
    const value = (answers && answers[i - 1] != null) ? answers[i - 1] : '';
    html += `<span class="blank-filled">${value}</span>`;
    html += escapeHtmlClient(segments[i]);
  }
  return html.replace(/\n/g, '<br>');
}

// Avatar = soit un emoji brut (retro-compatible, valeur historique), soit
// "gif:<id>" pour un des GIF deposes a la main par l'operateur (voir
// server/gifAvatars.js). Un seul point de rendu pour toute l'app : chaque
// endroit qui affichait ${p.avatar} en texte brut doit passer par cette
// fonction, sinon un joueur avec un avatar GIF s'afficherait comme
// "gif:nom-du-fichier" en toutes lettres.
// width/height en "em" : la miniature suit naturellement la taille de police
// du contexte (petite dans une liste de joueurs, grande sur l'ecran de
// victoire...) sans avoir a dupliquer une regle par emplacement.
function avatarHtml(avatar) {
  if (typeof avatar === 'string' && avatar.startsWith('gif:')) {
    const id = avatar.slice(4);
    return `<img class="avatar-gif" src="assets/avatars/gif/${encodeURIComponent(id)}.gif" alt="${escapeHtmlClient(id)}" />`;
  }
  return escapeHtmlClient(avatar || '');
}

function escapeHtmlClient(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Ajuste automatiquement la taille de police d'une carte pour que tout le texte
// reste visible, sans jamais recourir a un overflow cache.
function fitCardText(el) {
  if (!el) return;
  const container = el.closest('.card-face') || el.parentElement;
  if (!container) return;

  let fontSize = 30;
  // 11 plutot que 13 : les reponses peuvent aller jusqu'a 800 caracteres
  // (reglage owner, voir appSettings.js), il faut plus de marge pour rester
  // lisible sans deborder la carte plutot que de s'arreter trop tot.
  const minFontSize = 11;
  el.style.fontSize = fontSize + 'px';

  const maxHeight = container.clientHeight - 24;
  const maxWidth = container.clientWidth - 24;

  let guard = 0;
  while (
    (el.scrollHeight > maxHeight || el.scrollWidth > maxWidth) &&
    fontSize > minFontSize &&
    guard < 60
  ) {
    fontSize -= 1;
    el.style.fontSize = fontSize + 'px';
    guard++;
  }
}

function fitAllCardText(root) {
  const nodes = (root || document).querySelectorAll('.card-text[data-fit]');
  nodes.forEach((n) => fitCardText(n));
}
