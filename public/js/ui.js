'use strict';

const $app = () => document.getElementById('app');

function toast(message, type) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-info');
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// Ouvre une modale de confirmation generique. Resout true/false selon le choix.
// requireCheckbox (optionnel) : { label } affiche une case a cocher qui doit
// etre cochee pour activer le bouton de confirmation (utilise pour la
// certification d'age, pas une simple confirmation de confort).
function confirmModal({ title, body, confirmLabel, cancelLabel, danger, requireCheckbox }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtmlClient(title)}</h3>
        <p>${escapeHtmlClient(body)}</p>
        ${requireCheckbox ? `
          <label class="modal-checkbox-row">
            <input type="checkbox" id="modal-checkbox" />
            <span>${escapeHtmlClient(requireCheckbox.label)}</span>
          </label>
        ` : ''}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel">${escapeHtmlClient(cancelLabel || 'ANNULER')}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm" ${requireCheckbox ? 'disabled' : ''}>${escapeHtmlClient(confirmLabel || 'CONFIRMER')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('modal-show'));

    const confirmBtn = overlay.querySelector('[data-action="confirm"]');
    const checkbox = overlay.querySelector('#modal-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', () => { confirmBtn.disabled = !checkbox.checked; });
    }

    function close(result) {
      overlay.classList.remove('modal-show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
      const action = e.target.getAttribute && e.target.getAttribute('data-action');
      if (action === 'confirm' && !confirmBtn.disabled) close(true);
      if (action === 'cancel') close(false);
    });
  });
}

// Popup bloquante d'information (un seul bouton de fermeture), sur le meme
// gabarit visuel que confirmModal. bodyHtml est du HTML de confiance ecrit
// par nous (jamais de contenu utilisateur) : pas d'echappement, contrairement
// a confirmModal qui n'affiche que du texte simple.
function infoModal({ title, bodyHtml, confirmLabel }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtmlClient(title)}</h3>
        <div class="modal-info-body">${bodyHtml}</div>
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="confirm">${escapeHtmlClient(confirmLabel || 'COMPRIS')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('modal-show'));

    function close() {
      overlay.classList.remove('modal-show');
      setTimeout(() => overlay.remove(), 200);
      resolve();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
      const action = e.target.getAttribute && e.target.getAttribute('data-action');
      if (action === 'confirm') close();
    });
  });
}

// Porte d'entree legale : bloque toute interaction tant que la Charte
// d'utilisation + CGU ne sont pas acceptees. Pas de bouton "annuler", pas de
// fermeture au clic exterieur : c'est une condition d'acces, pas un simple
// avertissement de confort (voir app.js pour le versioning/localStorage).
function legalGateModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-overlay-blocking';
    overlay.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title">
        <h3 id="legal-gate-title">🎉 Avant de commencer</h3>
        <div class="modal-info-body">
          <p><strong>Ça va mal finir</strong> est un jeu d'ambiance à but humoristique, pensé pour être joué entre adultes consentants lors d'une soirée. Le ton peut être noir ou provocateur au second degré : rien de ce qui est écrit ou dit pendant une partie ne reflète les valeurs de l'application, de son éditeur, ni n'est destiné à sortir du cadre du jeu.</p>
          <p>Certains packs de cartes sont réservés aux personnes majeures et ne s'activent qu'après une certification d'âge explicite. En utilisant l'application, tu confirmes avoir pris connaissance de la <a href="/legal.html#charte" target="_blank" rel="noopener">Charte d'utilisation</a> et des <a href="/legal.html#cgu" target="_blank" rel="noopener">Conditions Générales d'Utilisation</a>, et tu les acceptes intégralement.</p>
        </div>
        <label class="modal-checkbox-row">
          <input type="checkbox" id="legal-gate-checkbox" />
          <span>J'ai lu et j'accepte la Charte d'utilisation et les CGU.</span>
        </label>
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="confirm" disabled>J'ACCEPTE ET JE CONTINUE</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('modal-show'));

    const confirmBtn = overlay.querySelector('[data-action="confirm"]');
    const checkbox = overlay.querySelector('#legal-gate-checkbox');
    checkbox.addEventListener('change', () => { confirmBtn.disabled = !checkbox.checked; });

    overlay.addEventListener('click', (e) => {
      const action = e.target.getAttribute && e.target.getAttribute('data-action');
      if (action === 'confirm' && !confirmBtn.disabled) {
        overlay.classList.remove('modal-show');
        setTimeout(() => overlay.remove(), 200);
        resolve();
      }
    });
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Repli pour navigateurs sans API clipboard.
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    return true;
  }
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
  }
  (children || []).forEach((c) => {
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else if (c) node.appendChild(c);
  });
  return node;
}
