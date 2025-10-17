
// Optional server calls (best-effort). If server is unreachable, no errors shown.
const API = {
  async saveQuiz(q){
    try{
      await fetch('/api/quizzes', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(q)});
    }catch(e){ /* silent */ }
  },
  async saveResult(r){
    try{
      await fetch('/api/results', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(r)});
    }catch(e){ /* silent */ }
  }
};


// ---- Cloud helpers (silent fail fallback) ----
API.getAdmin = async ()=>{ try{const r=await fetch('/api/admin'); if(!r.ok) throw 0; return await r.json();}catch(e){return null;}};
API.saveAdmin = async (adm)=>{ try{await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(adm)});}catch(e){} };

API.getUsers = async ()=>{ try{const r=await fetch('/api/users'); if(!r.ok) throw 0; return await r.json();}catch(e){return null;}};
API.saveUser = async (u)=>{ try{await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(u)});}catch(e){} };

API.getPending = async ()=>{ try{const r=await fetch('/api/pending'); if(!r.ok) throw 0; return await r.json();}catch(e){return null;}};
API.addPending = async (p)=>{ try{await fetch('/api/pending',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});}catch(e){} };
API.delPending = async (email)=>{ try{await fetch('/api/pending/'+encodeURIComponent(email),{method:'DELETE'});}catch(e){} };

API.getInbox = async ()=>{ try{const r=await fetch('/api/inbox'); if(!r.ok) throw 0; return await r.json();}catch(e){return null;}};
API.addInbox = async (m)=>{ try{await fetch('/api/inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)});}catch(e){} };

API.getQuizzes = async ()=>{ try{const r=await fetch('/api/quizzes'); if(!r.ok) throw 0; return await r.json();}catch(e){return null;}};
API.deleteQuiz = async (id)=>{ try{await fetch('/api/quizzes/'+encodeURIComponent(id),{method:'DELETE'});}catch(e){} };

API.getResults = async (quizId)=>{ try{const r=await fetch('/api/results'+(quizId?('?quizId='+encodeURIComponent(quizId)) : '')); if(!r.ok) throw 0; return await r.json();}catch(e){return null;}};
