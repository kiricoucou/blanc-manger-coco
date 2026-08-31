'use strict';

// Genere une image JPEG de la carte gagnante, entierement cote client
// (canvas), et declenche son telechargement. Aucun serveur implique.
function wrapCanvasText(ctx, text, maxWidth) {
  const paragraphs = text.split('\n');
  const lines = [];
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(' ');
    let current = '';
    words.forEach((word) => {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    lines.push(current);
  });
  return lines;
}

// filledText arrive deja HTML-echappe (&#39; etc) depuis le serveur, pour un
// affichage innerHTML sur. Le canvas dessine du texte brut : il faut donc
// decoder les entites avant de les tracer, sinon "&#39;" s'affiche litteralement.
function decodeHtmlEntities(str) {
  const div = document.createElement('div');
  div.innerHTML = str;
  return div.textContent;
}

function downloadWinningCardImage({ text, winnerNickname, winnerAvatar, gameCode }) {
  text = decodeHtmlEntities(text);
  winnerNickname = decodeHtmlEntities(winnerNickname || '');
  const W = 900;
  const H = 1125;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Fond degrade sombre, coherent avec l'identite visuelle du jeu.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#140a0a');
  bg.addColorStop(1, '#1e1113');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Bordure accent rouge.
  ctx.strokeStyle = '#c2434a';
  ctx.lineWidth = 6;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  // Logo textuel en haut.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#cc9a4a';
  ctx.font = '700 34px "Fredoka", sans-serif';
  ctx.fillText('ÇA VA MAL FINIR', W / 2, 100);

  // Texte de la carte, auto-ajuste et centre verticalement.
  const maxTextWidth = W - 160;
  let fontSize = 56;
  let lines = [];
  do {
    ctx.font = `700 ${fontSize}px "Fredoka", sans-serif`;
    lines = wrapCanvasText(ctx, text, maxTextWidth);
    fontSize -= 2;
  } while (lines.length * (fontSize + 14) > H - 420 && fontSize > 26);

  ctx.fillStyle = '#f7f0ee';
  const lineHeight = fontSize + 16;
  const totalHeight = lines.length * lineHeight;
  let y = (H - totalHeight) / 2 + fontSize;
  lines.forEach((line) => {
    ctx.fillText(line, W / 2, y);
    y += lineHeight;
  });

  // Trophee + gagnant en bas.
  ctx.font = '64px "Fredoka", sans-serif';
  ctx.fillText('🏆', W / 2, H - 210);

  ctx.font = '48px sans-serif';
  ctx.fillText(winnerAvatar || '', W / 2 - 90, H - 130);

  ctx.font = '700 40px "Fredoka", sans-serif';
  ctx.fillStyle = '#cc9a4a';
  ctx.fillText((winnerNickname || '').toUpperCase(), W / 2 + 20, H - 122);

  ctx.font = '400 22px sans-serif';
  ctx.fillStyle = '#a3898a';
  ctx.fillText(`Partie ${gameCode || ''}`, W / 2, H - 60);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ca-va-mal-finir-${(gameCode || 'carte').toLowerCase()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/jpeg', 0.92);
}
