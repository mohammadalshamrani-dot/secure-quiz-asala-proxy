import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ENV
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "SecureQuizAsala2025";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS teachers(
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    approved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quizzes(
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    qjson JSONB NOT NULL,
    link_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS results(
    id SERIAL PRIMARY KEY,
    quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
    student_name TEXT,
    score INTEGER,
    total INTEGER,
    left_page BOOLEAN DEFAULT false,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS inbox(
    id SERIAL PRIMARY KEY,
    name TEXT, email TEXT, subject TEXT, message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);

  // bootstrap admin if not exists
  const admin = await pool.query("SELECT id FROM teachers WHERE username=$1",["Admin"]);
  if(admin.rowCount===0){
    const hash = await bcrypt.hash("AaBbCc123", 10);
    await pool.query("INSERT INTO teachers(email,username,pass_hash,is_admin,approved) VALUES ($1,$2,$3,true,true)",
      ["admin@example.com","Admin",hash]);
  }
}
init().catch(e=>console.error("DB init error", e));

// utils
const signToken = (t)=> jwt.sign({ id: t.id, is_admin: !!t.is_admin }, JWT_SECRET, { expiresIn: "7d" });
const auth = async (req,res,next)=>{
  const hdr = req.headers.authorization||"";
  const tok = hdr.startsWith("Bearer ")? hdr.slice(7): null;
  if(!tok) return res.status(401).json({error:"no token"});
  try{ req.user = jwt.verify(tok, JWT_SECRET); next(); }
  catch(e){ res.status(401).json({error:"bad token"}); }
};
const adminOnly = (req,res,next)=> req.user?.is_admin ? next() : res.status(403).json({error:"forbidden"});

// health
app.get("/api/health", async (req,res)=>{
  try{ await pool.query("SELECT 1"); res.json({ ok:true, db:true, ts:new Date().toISOString() }); }
  catch(e){ res.json({ ok:true, db:false }); }
});

// Auth
app.post("/api/auth/login", async (req,res)=>{
  const { username, password } = req.body||{};
  if(!username||!password) return res.status(400).json({error:"missing"});
  const q = await pool.query("SELECT * FROM teachers WHERE username=$1",[username]);
  const t = q.rows[0];
  if(!t) return res.json({ ok:false });
  const ok = await bcrypt.compare(password, t.pass_hash);
  if(!ok) return res.json({ ok:false });
  if(!t.is_admin && !t.approved) return res.status(403).json({ ok:false, error:"not approved" });
  const token = signToken(t);
  res.json({ ok:true, token, teacher:{ id:t.id, email:t.email, username:t.username, is_admin:!!t.is_admin, approved: !!t.approved } });
});

app.get("/api/auth/me", auth, async (req,res)=>{
  const q = await pool.query("SELECT id,email,username,is_admin,approved FROM teachers WHERE id=$1",[req.user.id]);
  res.json({ ok:true, me:q.rows[0] });
});

app.post("/api/auth/register", async (req,res)=>{
  const { email, username, password } = req.body||{};
  if(!email||!username||!password) return res.status(400).json({error:"missing"});
  const ex = await pool.query("SELECT 1 FROM teachers WHERE email=$1 OR username=$2",[email, username]);
  if(ex.rowCount) return res.status(409).json({error:"exists"});
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO teachers(email,username,pass_hash,approved) VALUES ($1,$2,$3,false)",[email, username, hash]);
  res.status(201).json({ ok:true, pending:true });
});

// Admin pending approvals
app.get("/api/admin/pending_teachers", auth, adminOnly, async (req,res)=>{
  const { rows } = await pool.query("SELECT id,email,username,created_at FROM teachers WHERE approved=false AND is_admin=false ORDER BY created_at ASC");
  res.json({ ok:true, items: rows });
});
app.post("/api/admin/approve_teacher", auth, adminOnly, async (req,res)=>{
  const { id } = req.body||{};
  if(!id) return res.status(400).json({error:"missing"});
  await pool.query("UPDATE teachers SET approved=true WHERE id=$1",[id]);
  res.json({ ok:true });
});
app.post("/api/admin/reject_teacher", auth, adminOnly, async (req,res)=>{
  const { id } = req.body||{};
  if(!id) return res.status(400).json({error:"missing"});
  await pool.query("DELETE FROM teachers WHERE id=$1 AND is_admin=false",[id]);
  res.json({ ok:true });
});
app.post("/api/admin/reset_teacher", auth, adminOnly, async (req,res)=>{
  const { email, username, new_password } = req.body||{};
  if(!email||!username||!new_password) return res.status(400).json({error:"missing"});
  const hash = await bcrypt.hash(new_password, 10);
  const q = await pool.query("UPDATE teachers SET pass_hash=$1 WHERE email=$2 AND username=$3 RETURNING id",[hash,email,username]);
  res.json({ ok: q.rowCount>0 });
});

// Contact/inbox
app.post("/api/contact", async (req,res)=>{
  const { name, email, subject, message } = req.body||{};
  await pool.query("INSERT INTO inbox(name,email,subject,message) VALUES ($1,$2,$3,$4)",[name,email,subject,message]);
  res.json({ ok:true });
});
app.get("/api/admin/inbox", auth, adminOnly, async (req,res)=>{
  const { rows } = await pool.query("SELECT * FROM inbox ORDER BY created_at DESC");
  res.json({ ok:true, items: rows });
});
app.post("/api/admin/inbox_delete", auth, adminOnly, async (req,res)=>{
  const { id } = req.body||{};
  await pool.query("DELETE FROM inbox WHERE id=$1",[id]);
  res.json({ ok:true });
});

// Quizzes
function rid(){ return crypto.randomBytes(6).toString('hex'); }

app.post("/api/quiz", auth, async (req,res)=>{
  const { title, per_question_seconds, only_one_attempt, questions } = req.body||{};
  if(!title || !Array.isArray(questions) || !questions.length) return res.status(400).json({error:"bad"});
  const link_id = rid();
  const qjson = { id: link_id, title, per_question_seconds: +per_question_seconds || 30, only_one_attempt: !!only_one_attempt, questions };
  await pool.query("INSERT INTO quizzes(owner_id,qjson,link_id) VALUES ($1,$2,$3)",[req.user.id, qjson, link_id]);
  res.status(201).json({ ok:true, link_id });
});

app.get("/api/quiz/:id", async (req,res)=>{
  const { rows } = await pool.query("SELECT qjson FROM quizzes WHERE link_id=$1",[req.params.id]);
  if(!rows.length) return res.status(404).json({error:"not found"});
  res.json(rows[0].qjson);
});

// Submit result
app.post("/api/result", async (req,res)=>{
  const { quiz_id, student_name, score, total, left_page, meta } = req.body||{};
  const q = await pool.query("SELECT id FROM quizzes WHERE link_id=$1",[quiz_id]);
  if(!q.rowCount) return res.status(404).json({error:"quiz not found"});
  await pool.query("INSERT INTO results(quiz_id,student_name,score,total,left_page,meta) VALUES ($1,$2,$3,$4,$5,$6)",
    [q.rows[0].id, student_name||null, score||0, total||0, !!left_page, meta||{}]);
  res.json({ ok:true });
});

// Results list per owner
app.get("/api/my_results", auth, async (req,res)=>{
  const { rows } = await pool.query(`
    SELECT r.*, q.link_id FROM results r
    JOIN quizzes q ON q.id=r.quiz_id
    WHERE q.owner_id=$1
    ORDER BY r.created_at DESC
  `,[req.user.id]);
  res.json({ ok:true, items: rows });
});

// Static site
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req,res)=>res.sendFile(path.join(__dirname, "public", "index.html")));
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log("Asala v5.1 on", PORT));