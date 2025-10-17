
// Shared utilities + splash
(function(){
  const splash = document.getElementById('splash');
  const onHome = location.pathname.endsWith('index.html') || location.pathname.endsWith('/') || location.hash==='#home';
  const navHome = document.querySelector('.nav-home');
  function showSplashThen(fn){
    if(!splash) { fn && fn(); return; }
    splash.classList.remove('hidden');
    setTimeout(()=>{ splash.classList.add('hidden'); fn && fn(); }, 3000);
  }
  if(onHome && splash){ showSplashThen(); }
  if(navHome){
    navHome.addEventListener('click', (e)=>{
      // allow default, but show splash overlay
      showSplashThen(()=>{});
    });
  }
})();

// Storage helpers (localStorage keys)
const DB = {
  users: 'sq_users',
  pending: 'sq_pending',
  admin: 'sq_admin',
  inbox: 'sq_inbox',
  quizzes: 'sq_quizzes',
  results: 'sq_results' // map quizId -> array of results
};

function read(key, fallback){
  try{ return JSON.parse(localStorage.getItem(key)) ?? fallback; }catch{return fallback;}
}
function write(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

// Seed admin account if missing
(function seedAdmin(){
  const adm = read(DB.admin, { user: 'admin', pass: 'AaBbCc123' });
  write(DB.admin, adm);
})();

// LOGIN (teachers)
(function teacherLogin(){
  const form = document.getElementById('loginForm');
  if(!form) return;
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const pass = document.getElementById('loginPass').value;
    const users = read(DB.users, []);
    const ok = users.find(u=>u.email===email && u.pass===pass && u.approved);
    if(ok){ sessionStorage.setItem('sq_session', email); location.href='dashboard.html'; }
    else alert('تعذر الدخول: تأكد من صحة البيانات واعتماد الحساب.');
  });
})();

// SIGNUP
(function signup(){
  const form = document.getElementById('signupForm');
  if(!form) return;
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const name = document.getElementById('suName').value.trim();
    const email = document.getElementById('suEmail').value.trim().toLowerCase();
    const pass = document.getElementById('suPass').value;
    const pending = read(DB.pending, []);
    if(pending.find(p=>p.email===email)){ alert('تم إرسال طلب مسبقاً.'); return; }
    pending.push({name,email,pass,ts:Date.now()});
    write(DB.pending, pending);
    alert('تم إرسال طلب التسجيل للإدارة. سيتم إشعارك بعد الاعتماد.');
    location.href='login.html';
  });
})();

// CONTACT (inbox to admin)
(function contact(){
  const f = document.getElementById('contactForm');
  if(!f) return;
  f.addEventListener('submit', (e)=>{
    e.preventDefault();
    const inbox = read(DB.inbox, []);
    inbox.push({
      name: document.getElementById('cName').value.trim(),
      email: document.getElementById('cEmail').value.trim(),
      msg: document.getElementById('cMsg').value.trim(),
      ts: Date.now()
    });
    write(DB.inbox, inbox);
    alert('تم الإرسال، شكراً لك.');
    location.href='index.html';
  });
})();

// DASHBOARD greeting
(function dash(){
  const el = document.getElementById('welcomeUser');
  if(!el) return;
  const email = sessionStorage.getItem('sq_session');
  el.textContent = email ? ('مرحباً، ' + email) : 'غير مسجل دخول';
})();

// QUIZ BUILDER
(function builder(){
  const form = document.getElementById('quizForm');
  if(!form) return;
  const questionsDiv = document.getElementById('questions');
  const addBtn = document.getElementById('addQ');
  function addQuestion(){
    const idx = questionsDiv.children.length + 1;
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML = `
      <label>سؤال ${idx}
        <input type="text" class="q-text" required>
      </label>
      <div class="grid-3">
        <input type="text" class="opt" placeholder="اختيار 1" required>
        <input type="text" class="opt" placeholder="اختيار 2" required>
        <input type="text" class="opt" placeholder="اختيار 3" required>
        <input type="text" class="opt" placeholder="اختيار 4" required>
      </div>
      <label>رقم الإجابة الصحيحة (1-4)
        <input type="number" class="ans" min="1" max="4" required>
      </label>
    `;
    questionsDiv.appendChild(wrap);
  }
  addBtn.addEventListener('click', addQuestion);
  addQuestion();

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const quizId = 'q' + Math.random().toString(36).slice(2,10);
    const perQ = parseInt(document.getElementById('perQuestion').value,10);
    const title = document.getElementById('title').value.trim();
    const course = document.getElementById('course').value.trim();
    const qs = [];
    [...questionsDiv.children].forEach(card=>{
      const text = card.querySelector('.q-text').value.trim();
      const opts = [...card.querySelectorAll('.opt')].map(o=>o.value.trim());
      const ans = parseInt(card.querySelector('.ans').value,10)-1;
      qs.push({text,opts,ans});
    });
    const quizzes = read(DB.quizzes, {});
    quizzes[quizId] = {quizId, title, course, perQ, qs, ts: Date.now()};
    write(DB.quizzes, quizzes);
    // try send to server (best-effort)
    try{ await API.saveQuiz(quizzes[quizId]); }catch{}
    alert('تم حفظ الاختبار: ' + title);
    // refresh selector
    populateQuizSelect();
  });

  const qsSel = document.getElementById('quizSelect');
  function populateQuizSelect(){
    const quizzes = read(DB.quizzes, {});
    qsSel.innerHTML = '';
    Object.values(quizzes).forEach(q=>{
      const o = document.createElement('option');
      o.value = q.quizId; o.textContent = q.title + ' – ' + q.course;
      qsSel.appendChild(o);
    });
  }
  populateQuizSelect();

  document.getElementById('makeLink').addEventListener('click', ()=>{
    const id = qsSel.value;
    const name = encodeURIComponent(document.getElementById('stName').value.trim());
    const sid = encodeURIComponent(document.getElementById('stId').value.trim());
    if(!id || !name || !sid){ alert('يرجى تعبئة الطالب والرقم الجامعي.'); return; }
    const url = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '/') }student.html?id=${id}&name=${name}&sid=${sid}`;
    document.getElementById('genLink').value = url;
  });
  document.getElementById('copyLink').addEventListener('click', async ()=>{
    const v = document.getElementById('genLink').value;
    if(!v) return;
    await navigator.clipboard.writeText(v);
    alert('تم نسخ الرابط.');
  });
})();

// RESULTS (teacher)
(function teacherResults(){
  const sel = document.getElementById('resQuizSelect');
  if(!sel) return;
  function populate(){
    const quizzes = read(DB.quizzes, {});
    sel.innerHTML = '';
    Object.values(quizzes).forEach(q=>{
      const o = document.createElement('option'); o.value=q.quizId; o.textContent = q.title + ' – ' + q.course;
      sel.appendChild(o);
    });
    render();
  }
  function render(){
    const qid = sel.value;
    const all = read(DB.results, {});
    const rows = (all[qid]||[]).sort((a,b)=>a.ts-b.ts);
    const box = document.getElementById('resultsTable');
    if(!rows.length){ box.innerHTML = '<p class="muted">لا توجد نتائج بعد.</p>'; return; }
    let html = '<table><thead><tr><th>الاسم</th><th>الرقم الجامعي</th><th>الدرجة</th><th>الوقت</th><th>ملاحظة</th><th>طباعة</th></tr></thead><tbody>';
    rows.forEach((r,i)=>{
      const date = new Date(r.ts).toLocaleString('ar-SA');
      html += `<tr><td>${r.name}</td><td>${r.sid}</td><td>${r.score}/${r.total}</td><td>${date}</td><td>${r.note||''}</td>
      <td><button data-i="${i}" class="btn print-one">طباعة</button></td></tr>`;
    });
    html += '</tbody></table>';
    box.innerHTML = html;
    box.querySelectorAll('.print-one').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const i = +btn.getAttribute('data-i');
        const r = rows[i];
        const w = window.open('','printwin');
        w.document.write(`<pre style="font-family:ui-monospace">${JSON.stringify(r,null,2)}</pre>`);
        w.print(); w.close();
      });
    });
  }
  sel.addEventListener('change', render);
  populate();
})();

// ADMIN
(function admin(){
  const form = document.getElementById('adminLoginForm');
  if(form){
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const u = document.getElementById('adminUser').value.trim();
      const p = document.getElementById('adminPass').value;
      const adm = read(DB.admin, {user:'admin',pass:'AaBbCc123'});
      if(u===adm.user && p===adm.pass){ sessionStorage.setItem('sq_admin','1'); location.href='admin-dashboard.html'; }
      else alert('بيانات غير صحيحة.');
    });
    return;
  }
  // dashboard
  if(!document.getElementById('inboxList')) return;
  if(sessionStorage.getItem('sq_admin')!=='1'){ alert('الدخول من صفحة الإدارة فقط.'); location.href='admin-login.html'; return; }

  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t=>t.addEventListener('click', ()=>{
    tabs.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
    document.getElementById('tab-'+t.dataset.tab).classList.remove('hidden');
  }));

  function renderInbox(){
    const list = read(DB.inbox, []);
    const box = document.getElementById('inboxList');
    if(!list.length){ box.innerHTML = '<p class="muted">لا رسائل بعد.</p>'; return; }
    box.innerHTML = list.map(m=>`<div class="card"><div><strong>${m.name}</strong> – ${m.email}</div><div class="muted">${new Date(m.ts).toLocaleString('ar-SA')}</div><p>${m.msg}</p></div>`).join('');
  }
  function renderPending(){
    const pend = read(DB.pending, []);
    const box = document.getElementById('pendingList');
    if(!pend.length){ box.innerHTML = '<p class="muted">لا طلبات حالياً.</p>'; return; }
    box.innerHTML = pend.map((p,i)=>`
      <div class="card">
        <div><strong>${p.name}</strong> – ${p.email}</div>
        <button class="btn" data-i="${i}" data-act="approve">اعتماد</button>
        <button class="btn" data-i="${i}" data-act="reject">رفض</button>
      </div>`).join('');
    box.querySelectorAll('button').forEach(btn=>btn.addEventListener('click', ()=>{
      const i = +btn.getAttribute('data-i');
      const act = btn.getAttribute('data-act');
      const pend2 = read(DB.pending, []);
      const rec = pend2[i];
      pend2.splice(i,1);
      write(DB.pending, pend2);
      if(act==='approve'){
        const users = read(DB.users, []);
        users.push({name:rec.name,email:rec.email,pass:rec.pass,approved:true});
        write(DB.users, users);
      }
      renderPending();
    }));
  }
  function wirePw(){
    document.getElementById('pwMemberForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const email = document.getElementById('pwMemberEmail').value.trim().toLowerCase();
      const newp = document.getElementById('pwMemberNew').value;
      const users = read(DB.users, []);
      const u = users.find(x=>x.email===email);
      if(!u){ alert('لا يوجد عضو بهذا البريد'); return; }
      u.pass = newp; write(DB.users, users); alert('تم التحديث');
    });
    document.getElementById('pwAdminForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const user = document.getElementById('pwAdminUser').value.trim();
      const newp = document.getElementById('pwAdminNew').value;
      const adm = read(DB.admin, {user:'admin',pass:'AaBbCc123'});
      adm.user = user; adm.pass = newp; write(DB.admin, adm);
      alert('تم تحديث كلمة مرور الأدمن');
    });
  }
  renderInbox(); renderPending(); wirePw();
})();

// STUDENT PAGE
(function student(){
  const box = document.getElementById('quizBox');
  if(!box) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('id'); const name = params.get('name'); const sid = params.get('sid');
  const info = document.getElementById('studentInfo');
  if(!id || !name || !sid){
    info.textContent = 'لا يمكن بدء الاختبار بدون الاسم والرقم الجامعي.';
    return;
  }
  info.textContent = 'الطالب: ' + decodeURIComponent(name) + ' – الرقم: ' + decodeURIComponent(sid);

  const quizzes = read(DB.quizzes, {});
  const quiz = quizzes[id];
  if(!quiz){ box.classList.add('hidden'); info.textContent += ' | لم يتم العثور على الاختبار.'; return; }

  // randomize choices per student
  const qs = quiz.qs.map(q=>{
    const indices = [0,1,2,3].sort(()=>Math.random()-0.5);
    const opts = indices.map(i=>q.opts[i]);
    const ans = indices.indexOf(q.ans);
    return {text:q.text, opts, ans};
  });

  let i=0, correct=0, note='';
  let left=false;
  function markLeft(){ left=true; note = 'خرج من المنصة'; }
  window.addEventListener('blur', markLeft);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) markLeft(); });

  const qText = document.getElementById('qText');
  const choices = document.getElementById('choices');
  const timer = document.getElementById('timer');
  const nextBtn = document.getElementById('nextBtn');

  let picked=-1, timeLeft=quiz.perQ, tick=null;
  function renderQ(){
    const q = qs[i]; if(!q){ return finish(); }
    qText.textContent = (i+1)+') '+q.text;
    choices.innerHTML = '';
    q.opts.forEach((opt,idx)=>{
      const b = document.createElement('button'); b.className='btn'; b.textContent = opt;
      b.addEventListener('click', ()=>{ picked = idx; [...choices.children].forEach(x=>x.classList.remove('primary')); b.classList.add('primary'); });
      choices.appendChild(b);
    });
    timeLeft = quiz.perQ;
    timer.textContent = timeLeft+'s';
    clearInterval(tick);
    tick = setInterval(()=>{
      timeLeft--; timer.textContent = timeLeft+'s';
      if(timeLeft<=0){ clearInterval(tick); next(); }
    }, 1000);
    box.classList.remove('hidden');
  }
  function next(){
    if(picked===qs[i].ans) correct++;
    i++; picked=-1; renderQ();
  }
  nextBtn.addEventListener('click', next);

  function finish(){
    clearInterval(tick);
    box.classList.add('hidden');
    document.getElementById('resultBox').classList.remove('hidden');
    const total = qs.length;
    document.getElementById('score').textContent = correct + '/' + total;
    const all = read(DB.results, {}); all[quiz.quizId] = all[quiz.quizId]||[];
    const rec = { quizId: quiz.quizId, name: decodeURIComponent(name), sid: decodeURIComponent(sid),
      score: correct, total, ts: Date.now(), note: left? 'خرج من المنصة' : '' };
    all[quiz.quizId].push(rec); write(DB.results, all);
    // best-effort server send
    try{ API.saveResult(rec); }catch{}
  }

  renderQ();
})();
