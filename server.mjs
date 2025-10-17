
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

// Health
app.get('/api/health', (req,res)=>res.json({ok:true}));

// Stubs – replace with real DB hooks if needed
app.post('/api/quizzes', (req,res)=>{ console.log('quiz received', req.body?.quizId); return res.json({ok:true}); });
app.post('/api/results', (req,res)=>{ console.log('result received', req.body?.sid); return res.json({ok:true}); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Server running on :' + PORT));
