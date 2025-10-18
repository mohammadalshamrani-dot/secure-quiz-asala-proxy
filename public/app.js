/* app.js – Student Page Compatibility (Supabase + Render) */
(function () {
  const notFoundEl = document.querySelector('#not-found, .not-found') || document.querySelector('.no-quiz');
  const startBtn   = document.querySelector('#startBtn, .start-btn, button[type="submit"]');
  const formEl     = document.querySelector('form');

  function normId(v){
    if(!v) return v;
    let s = String(v).trim();
    if (s.includes('&')) s = s.split('&')[0];
    if (s.includes('?')) s = s.split('?')[0];
    if (s.includes('exp=')) s = s.split('exp=')[0];
    return s.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function getId() {
    const sp = new URLSearchParams(location.search);
    let id = sp.get('id');
    if (!id) {
      const m = /id=([^&]+)/.exec(location.search);
      if (m) id = m[1];
    }
    return normId(id);
  }

  async function fetchQuiz(id) {
    const tries = [
      `/api/quiz?id=${encodeURIComponent(id)}`,
      `/api/quiz/${encodeURIComponent(id)}`
    ];
    for (const url of tries) {
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (r.ok) return await r.json();
      } catch (_) {}
    }
    return null;
  }

  async function init() {
    const id = getId();
    if (!id) {
      notFoundEl && (notFoundEl.style.display = 'block');
      startBtn && (startBtn.disabled = true);
      return;
    }

    const quiz = await fetchQuiz(id);
    if (!quiz || !quiz.qs || !quiz.qs.length) {
      notFoundEl && (notFoundEl.style.display = 'block');
      startBtn && (startBtn.disabled = true);
      return;
    }

    try { localStorage.setItem('quiz', JSON.stringify(quiz)); } catch(_) {}
    notFoundEl && (notFoundEl.style.display = 'none');
    startBtn && (startBtn.disabled = false);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
