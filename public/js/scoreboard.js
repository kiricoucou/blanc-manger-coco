'use strict';

// Mini-classement persistant + barre d'objectif, affiche pendant les phases
// de jeu actives (masque en lobby / fin de partie qui ont deja leur propre
// classement complet).
const ScoreboardUI = (() => {
  const VISIBLE_STATES = new Set(['CARD_SELECTION', 'ANSWERING', 'JUDGING', 'RESULTS', 'NEXT_ROUND']);

  function update() {
    const root = document.getElementById('scoreboard-root');
    const s = AppState.publicState;

    if (!s || !VISIBLE_STATES.has(s.state) || !s.players || s.players.length === 0) {
      root.innerHTML = '';
      document.body.classList.remove('scoreboard-active');
      return;
    }
    document.body.classList.add('scoreboard-active');

    const target = s.settings.winningScore;
    const top = [...s.players].sort((a, b) => b.score - a.score).slice(0, 3);
    const leaderScore = top[0] ? top[0].score : 0;
    const pct = target > 0 ? Math.min(100, (leaderScore / target) * 100) : 0;

    root.innerHTML = `
      <div class="mini-scoreboard">
        <div class="mini-scoreboard-goal">
          <span>🏆 Objectif : ${target} pts</span>
          <div class="mini-scoreboard-bar"><div class="mini-scoreboard-fill" style="width:${pct}%"></div></div>
        </div>
        <ul class="mini-scoreboard-list">
          ${top.map((p, i) => `<li><span>${['🥇', '🥈', '🥉'][i]}</span><span class="mini-scoreboard-avatar">${p.avatar}</span><span class="mini-scoreboard-name">${p.nickname}</span><span class="mini-scoreboard-score">${p.score}</span></li>`).join('')}
        </ul>
      </div>`;
  }

  return { update };
})();
