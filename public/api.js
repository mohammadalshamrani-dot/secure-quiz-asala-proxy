
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


API.getQuizzes = async function(){
  try{
    const r = await fetch('/api/quizzes');
    if(!r.ok) throw new Error();
    return await r.json();
  }catch(e){ return null; }
};
API.getResults = async function(quizId){
  try{
    const url = '/api/results' + (quizId ? ('?quizId='+encodeURIComponent(quizId)) : '');
    const r = await fetch(url);
    if(!r.ok) throw new Error();
    return await r.json();
  }catch(e){ return null; }
};
