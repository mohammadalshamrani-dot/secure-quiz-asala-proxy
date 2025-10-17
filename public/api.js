/* api.js — cloud-first (Render PostgreSQL), single-file drop‑in.
   No UI changes required. Uses same-origin /api/* endpoints.
*/

window.API = window.API || {};

// ---------- Helpers ----------
const BASE = '';
async function jget(url){
  const r = await fetch(BASE + url, { credentials: 'include' });
  if(!r.ok) throw new Error('GET ' + url + ' -> ' + r.status);
  return await r.json();
}
async function jpost(url, body){
  const r = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body||{})
  });
  if(!r.ok) throw new Error('POST ' + url + ' -> ' + r.status);
  return await r.json();
}
async function jdel(url){
  const r = await fetch(BASE + url, { method: 'DELETE', credentials: 'include' });
  if(!r.ok) throw new Error('DELETE ' + url + ' -> ' + r.status);
  return await r.json();
}

// ---------- Admin ----------
API.getAdmin  = () => jget('/api/admin');
API.saveAdmin = (adm) => jpost('/api/admin', adm);

// ---------- Users / Pending ----------
API.getUsers  = () => jget('/api/users');
API.saveUser  = (u)   => jpost('/api/users', u);

API.getPending = () => jget('/api/pending');
API.addPending = (p)  => jpost('/api/pending', p);
API.delPending = (email) => jdel('/api/pending/' + encodeURIComponent(email));

// ---------- Inbox ----------
API.getInbox = () => jget('/api/inbox');
API.addInbox = (msg) => jpost('/api/inbox', msg);

// ---------- Quizzes ----------
API.getQuizzes = () => jget('/api/quizzes');
API.saveQuiz   = (quiz) => jpost('/api/quizzes', quiz);
API.deleteQuiz = (id) => jdel('/api/quizzes/' + encodeURIComponent(id));

// ---------- Results ----------
API.getResults = (quizId) => jget('/api/results' + (quizId ? ('?quizId=' + encodeURIComponent(quizId)) : ''));
API.saveResult = (rec)    => jpost('/api/results', rec);

// ---------- Health ----------
API.health = () => jget('/api/health');
