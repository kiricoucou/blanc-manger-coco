'use strict';

// Bulle d'aide contextuelle du mode tutoriel : un texte different par phase
// de manche, expliquant a l'humain ce qui se passe et ce qu'il peut faire.
// N'apparait jamais en partie demo/normale (mode !== 'tutorial').
const TutorialTipsUI = (() => {
  let dismissedForState = null;

  function tipFor(state, isJudge) {
    switch (state) {
      case 'JUDGE_SELECTION': return "Chaque manche, un joueur devient juge au hasard. Cette fois, c'est peut-être toi !";
      case 'CARD_SELECTION': return isJudge
        ? "C'est ton tour de juger : cette carte noire sera complétée par les autres. Tu peux changer le nombre de trous, puis valider en bas."
        : 'Le juge choisit sa carte noire. Regarde-la se dévoiler, tu vas devoir la compléter juste après.';
      case 'ANSWERING': return isJudge
        ? 'Les autres joueurs répondent en ce moment, patiente un peu.'
        : "À toi d'écrire une réponse drôle pour compléter le(s) trou(s) de la carte, puis envoie-la !";
      case 'JUDGING': return isJudge
        ? 'Lis les réponses mélangées et anonymes (fais défiler avec Suivant/Précédent), puis choisis la meilleure.'
        : 'Le juge lit toutes les réponses en secret et va choisir la meilleure.';
      case 'RESULTS': return "La carte gagnante est révélée avec son auteur. +1 point pour lui !";
      case 'NEXT_ROUND': return 'Le gagnant de cette manche devient le juge suivant. Nouvelle manche dans un instant.';
      case 'GAME_OVER': return "Premier à atteindre l'objectif de points : victoire ! Tu connais maintenant toutes les phases d'une manche.";
      default: return null;
    }
  }

  function update() {
    const root = document.getElementById('tutorial-tip-root');
    const s = AppState.publicState;
    const priv = AppState.privateState;

    if (!s || s.mode !== 'tutorial' || dismissedForState === s.state) {
      root.innerHTML = '';
      document.body.classList.remove('tutorial-tip-active');
      return;
    }

    const text = tipFor(s.state, !!(priv && priv.isJudge));
    if (!text) { root.innerHTML = ''; document.body.classList.remove('tutorial-tip-active'); return; }

    root.innerHTML = `
      <div class="tutorial-tip">
        <span class="tutorial-tip-icon">🎓</span>
        <span class="tutorial-tip-text">${escapeHtmlClient(text)}</span>
        <button class="tutorial-tip-close" data-action="dismiss-tutorial-tip" aria-label="Fermer">✕</button>
      </div>`;
    document.body.classList.add('tutorial-tip-active');
  }

  function dismiss() {
    const s = AppState.publicState;
    dismissedForState = s ? s.state : null;
    update();
  }

  return { update, dismiss };
})();
