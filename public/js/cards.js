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
