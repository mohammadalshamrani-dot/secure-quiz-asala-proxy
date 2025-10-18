/* app.js v4 – robust enable for "بدء الاختبار" button and quiz fetch */
(function () {
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

  function findStartButton() {
    // Try common ids/classes
    let btn = document.querySelector('#startBtn, .start-btn, button[type="submit"], input[type="submit"]');
    if (btn) return btn;

    // Fallback: look for any button with Arabic text like "بدء الاختبار" / "ابدأ الاختبار"
    const candidates = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
    const re = /(بدء|ابدا|ابدأ)\s*الاختبار/;
    btn = candidates.find(el => {
      const txt = (el.innerText || el.value || '').trim();
      return re.test(txt);
    });
    return btn || null;
  }

  function enableButton(btn){
    if (!btn) return;
    try {
      btn.disabled = false;
      btn.removeAttribute('disabled');
      btn.classList.remove('disabled');
      btn.style.pointerEvents = 'auto';
      btn.type = btn.tagName.toLowerCase() === 'input' ? 'submit' : (btn.type || 'submit');
    } catch(_) {}
  }

  function showNotFound(show=true){
    const el = document.querySelector('#not-found, .not-found, .no-quiz');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  async function init() {
    const id = getId();
    const startBtn = findStartButton();

    if (!id) {
      showNotFound(true);
      enableButton(startBtn); // allow manual continue if desired
      return;
    }

    const quiz = await fetchQuiz(id);
    if (!quiz || !quiz.qs || !quiz.qs.length) {
      showNotFound(true);
      return;
    }

    // stash quiz for later pages if needed
    try { localStorage.setItem('quiz', JSON.stringify(quiz)); } catch(_){}

    // ready to start
    showNotFound(false);
    enableButton(startBtn);

    // ensure the form exists and will submit
    const form = startBtn ? startBtn.closest('form') : document.querySelector('form');
    if (form) {
      // inject hidden quizId for backend if useful
      if (!form.querySelector('input[name="quizId"]')) {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'quizId';
        hidden.value = quiz.id || id;
        form.appendChild(hidden);
      }
    } else if (startBtn) {
      // fallback: navigate to questions page if your flow uses a page like questions.html
      startBtn.addEventListener('click', function(e){
        // If the app expects navigation, place it here. For now just no-op to allow default.
      });
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
