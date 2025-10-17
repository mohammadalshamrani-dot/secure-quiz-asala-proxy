
// Optional minimal express server (if you deploy to Render/Node).
// Serves static 'public' and provides best-effort stubs for /api endpoints.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* CLOUD STORE START */
// In-memory cloud store (replace with DB in production)
const store = {
  users: [], // {name,email,pass,approved}
  pending: [], // {name,email,pass,ts}
  admin: {user:'admin', pass:'AaBbCc123'},
  inbox: [], // {name,email,msg,ts}
  quizzes: {}, // quizId -> quiz
  results: {} // quizId -> [result]
};
/* CLOUD STORE END */

// Health
app.get('/api/health', (req,res)=>res.json({ok:true}));

// Stubs – replace with real DB hooks if needed
app.post('/api/quizzes', (req,res)=>{ console.log('quiz received', req.body?.quizId); return res.json({ok:true}); });
app.post('/api/results', (req,res)=>{ console.log('result received', req.body?.sid); return res.json({ok:true}); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Server running on :' + PORT));

// ---- Cloud APIs ----
// Users & Pending
app.get('/api/users', (req,res)=>res.json(store.users));
app.post('/api/users', (req,res)=>{ const u=req.body; const i=store.users.findIndex(x=>x.email===u.email);
  if(i>=0) store.users[i]=u; else store.users.push(u); return res.json({ok:true}); });

app.get('/api/pending', (req,res)=>res.json(store.pending));
app.post('/api/pending', (req,res)=>{ store.pending.push(req.body); return res.json({ok:true}); });
app.delete('/api/pending/:email', (req,res)=>{ const e=req.params.email.toLowerCase(); store.pending=store.pending.filter(p=>p.email.toLowerCase()!=e); return res.json({ok:true}); });

app.get('/api/admin', (req,res)=>res.json(store.admin));
app.post('/api/admin', (req,res)=>{ store.admin = req.body; return res.json({ok:true}); });

app.get('/api/inbox', (req,res)=>res.json(store.inbox));
app.post('/api/inbox', (req,res)=>{ store.inbox.push(req.body); return res.json({ok:true}); });

// Quizzes & Results
app.get('/api/quizzes', (req,res)=>res.json(store.quizzes));
app.post('/api/quizzes', (req,res)=>{ const q=req.body; store.quizzes[q.quizId]=q; return res.json({ok:true}); });
app.delete('/api/quizzes/:id', (req,res)=>{ const id=req.params.id; delete store.quizzes[id]; delete store.results[id]; return res.json({ok:true}); });

app.get('/api/results', (req,res)=>{ const q=req.query.quizId; return res.json(q? (store.results[q]||[]) : store.results); });
app.post('/api/results', (req,res)=>{ const r=req.body; const id=r.quizId; store.results[id]=store.results[id]||[]; store.results[id].push(r); return res.json({ok:true}); });
