import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import pkg from 'pg';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'SecureQuizAsala2025';

let pool = null;
if (DATABASE_URL) {
  const { Pool } = pkg;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
}

// ===== Utilities: minimal JWT (no external deps) =====
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function sign(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const data = encHeader + '.' + encPayload;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return data + '.' + sig;
}
function verify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const [h,p,s] = parts;
  const data = h + '.' + p;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  if (expected !== s) throw new Error('bad sign');
  return JSON.parse(Buffer.from(p.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
}
function authFrom(req) {
  const h = req.headers['authorization']||'';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try { return verify(m[1], JWT_SECRET); } catch(e){ return null; }
}

// ===== Health: لا يعتمد على قاعدة البيانات =====
app.get('/api/health', (req,res)=> res.json({ok:true, ts:new Date().toISOString()}));

// ===== Schema bootstrap (idempotent) =====
async function ensureSchema() {
  if (!pool) throw new Error('No database configured');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password TEXT,
      is_admin BOOLEAN DEFAULT false,
      is_approved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      link_id TEXT UNIQUE,
      title TEXT,
      per_question_seconds INT,
      only_one_attempt BOOLEAN DEFAULT false,
      qjson JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      quiz_id TEXT,
      student_name TEXT,
      score INT,
      total INT,
      left_page BOOLEAN DEFAULT false,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query("ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS link_id TEXT");
  // Bootstrap admin if missing
  const adminUser = 'Admin';
  const adminPass = 'AaBbCc123';
  const r = await pool.query("SELECT id FROM teachers WHERE username=$1 LIMIT 1", [adminUser]);
  if (!r.rows.length) {
    await pool.query("INSERT INTO teachers(username,email,password,is_admin,is_approved) VALUES ($1,$2,$3,$4,$5)",
      [adminUser, 'admin@alasala.edu.sa', adminPass, true, true]);
  }
}

// ===== Auth endpoints =====
app.post('/api/auth/login', async (req,res)=>{
  try{
    if(!pool) throw new Error('Database not ready');
    await ensureSchema();
    const {username, password} = req.body||{};
    if(!username || !password) return res.status(400).json({ok:false});
    const r = await pool.query("SELECT id, username, email, password, is_admin, is_approved FROM teachers WHERE lower(username)=lower($1) LIMIT 1",[username]);
    if(!r.rows.length) return res.status(401).json({ok:false, error:'NO_USER'});
    const u = r.rows[0];
    if(!u.is_approved) return res.status(403).json({ok:false, error:'NOT_APPROVED'});
    // Plain password match (لتوافق الإصدارات السابقة)
    if((u.password||'') !== password) return res.status(401).json({ok:false, error:'BAD_PASS'});
    const token = sign({uid:u.id, username:u.username, is_admin:u.is_admin}, JWT_SECRET);
    res.json({ok:true, token, me:{id:u.id, username:u.username, is_admin:u.is_admin}});
  }catch(e){ console.error('login-error', e); res.status(500).json({ok:false}); }
});

app.get('/api/auth/me', async (req,res)=>{
  try{
    const a = authFrom(req);
    if(!a) return res.json({me:null});
    // optional refresh from DB
    if(pool){
      await ensureSchema();
      const r = await pool.query("SELECT id, username, is_admin FROM teachers WHERE id=$1 LIMIT 1",[a.uid]);
      if(r.rows.length){
        const u=r.rows[0];
        return res.json({me:{id:u.id, username:u.username, is_admin:u.is_admin}});
      }
    }
    res.json({me:{id:a.uid, username:a.username, is_admin:!!a.is_admin}});
  }catch(e){ res.json({me:null}); }
});

// ===== Quiz creation / fetch / result =====
app.post('/api/quiz', async (req,res)=>{
  try{
    if(!pool) throw new Error('Database not ready');
    await ensureSchema();
    const auth = authFrom(req);
    if(!auth) return res.status(401).json({ok:false});
    const { title, per_question_seconds, only_one_attempt, questions } = req.body||{};
    if(!title || !Array.isArray(questions) || !questions.length) return res.status(400).json({ok:false});
    const link_id = crypto.randomBytes(4).toString('hex');
    const qjson = { id: link_id, title, per_question_seconds:Number(per_question_seconds)||30, only_one_attempt:!!only_one_attempt, questions };
    await pool.query("INSERT INTO quizzes(link_id,title,per_question_seconds,only_one_attempt,qjson) VALUES ($1,$2,$3,$4,$5)",
      [link_id, title, Number(per_question_seconds)||30, !!only_one_attempt, JSON.stringify(qjson)]);
    res.json({ok:true, link_id});
  }catch(e){ console.error('quiz-create-error', e); res.status(500).json({ok:false}); }
});

app.get('/api/quiz/:id', async (req,res)=>{
  try{
    if(!pool) throw new Error('Database not ready');
    await ensureSchema();
    const r = await pool.query("SELECT qjson FROM quizzes WHERE link_id=$1 LIMIT 1",[req.params.id]);
    if(!r.rows.length) return res.status(404).json({ok:false});
    res.json(r.rows[0].qjson);
  }catch(e){ console.error('quiz-get-error', e); res.status(500).json({ok:false}); }
});

app.post('/api/result', async (req,res)=>{
  try{
    if(!pool) throw new Error('Database not ready');
    await ensureSchema();
    const { quiz_id, student_name, score, total, left_page, meta } = req.body||{};
    await pool.query("INSERT INTO results(quiz_id,student_name,score,total,left_page,meta) VALUES ($1,$2,$3,$4,$5,$6)",
      [quiz_id, student_name, Number(score)||0, Number(total)||0, !!left_page, JSON.stringify(meta||{})]);
    res.json({ok:true});
  }catch(e){ console.error('result-insert-error', e); res.status(500).json({ok:false}); }
});

// ===== Static + root =====
app.use(express.static('public'));
app.get('/', (req,res)=> res.sendFile(new URL('./public/index.html', import.meta.url).pathname));

app.listen(PORT, ()=> console.log('Asala v5.1.6 listening on', PORT));
