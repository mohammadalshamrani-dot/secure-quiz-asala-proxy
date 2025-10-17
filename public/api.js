
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
