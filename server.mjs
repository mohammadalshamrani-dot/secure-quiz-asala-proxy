import express from "express";
import cors from "cors";
import { Pool } from "pg";
import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "change-me-please";
const MAIL_USER = process.env.MAIL_USER;
const MAIL_PASS = process.env.MAIL_PASS;
const MAIL_FROM = process.env.MAIL_FROM || MAIL_USER;

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const transporter = (MAIL_USER && MAIL_PASS) ? nodemailer.createTransport({
  service: "gmail",
  auth: { user: MAIL_USER, pass: MAIL_PASS }
}) : null;

async function init(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT false,
      approved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      owner_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
      title TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id BIGSERIAL PRIMARY KEY,
      quiz_id TEXT REFERENCES quizzes(id) ON DELETE CASCADE,
      student_name TEXT,
      left_page BOOLEAN DEFAULT false,
      score INTEGER,
      total INTEGER,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender_name TEXT,
      sender_email TEXT,
      type TEXT,
      subject TEXT,
      body TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM teachers");
  if (rows[0].c === 0){
    const hash = await bcrypt.hash("AaBbCc123", 10);
    await pool.query("INSERT INTO teachers (email, username, pass_hash, is_admin, approved) VALUES ($1,$2,$3,$4,true)",
      ["admin@example.com", "Admin", hash, true]);
    console.log("Bootstrapped admin: admin / AaBbCc123");
  }
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use((req,res,next)=>{ res.setHeader("Cache-Control","no-store"); next(); });

function signToken(t){ return jwt.sign({ id:t.id, email:t.email, username:t.username, is_admin: !!t.is_admin }, JWT_SECRET, { expiresIn:"7d" }); }
async function auth(req,res,next){
  try{
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i,"");
    if (!token) return res.status(401).json({ error:"no token" });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; next();
  }catch(e){ return res.status(401).json({ error:"bad token" }); }
}
function adminOnly(req,res,next){
  if (!req.user?.is_admin) return res.status(403).json({ error:"admin only" });
  next();
}

// Health
app.get("/api/health", async (req,res)=>{
  try{ const { rows } = await pool.query("SELECT NOW() now"); res.json({ ok:true, db:true, now: rows[0].now }); }
  catch(e){ res.json({ ok:true, db:false, error:String(e) }); }
});

// Auth
app.post("/api/auth/login", async (req,res)=>{
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error:"missing" });

app.post("/api/auth/register", async (req,res)=>{
  try{
    const { email, username, password } = req.body || {};
    if (!email || !username || !password) return res.status(400).json({ error:"missing" });
    // basic domain tie if needed in future: alasala.edu.sa
    // if (!/@alasala\.edu\.sa$/i.test(email)) return res.status(400).json({ error:"email domain not allowed" });
    const exists = await pool.query("SELECT 1 FROM teachers WHERE email=$1 OR username=$2",[email, username]);
    if (exists.rows.length) return res.status(409).json({ error:"exists" });
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO teachers (email, username, pass_hash, approved) VALUES ($1,$2,$3,false)",[email, username, hash]);
    res.status(201).json({ ok:true, pending:true });
  }catch(e){
    res.status(500).json({ error:"register failed" });
  }
});

  const q = await pool.query("SELECT * FROM teachers WHERE username=$1 OR email=$1", [username]);
  if (!q.rows.length) return res.status(401).json({ error:"invalid" });
  const t = q.rows[0];
  const ok = await bcrypt.compare(password, t.pass_hash);
  if (!ok) return res.status(401).json({ error:"invalid" });
  if (!t.is_admin && !t.approved) return res.status(403).json({ error:"not approved" });
  const token = signToken(t);
  res.json({ ok:true, token, teacher:{ id:t.id, email:t.email, username:t.username, is_admin: !!t.is_admin } });
});

app.get("/api/auth/me", auth, async (req,res)=>{
  const q = await pool.query("SELECT id, email, username, is_admin, approved FROM teachers WHERE id=$1",[req.user.id]);
  if (!q.rows.length) return res.status(401).json({ error:"no user" });
  res.json({ ok:true, teacher: q.rows[0] });
});

app.post("/api/auth/change_password", auth, async (req,res)=>{
  const { old_password, new_password } = req.body || {};
  const q = await pool.query("SELECT * FROM teachers WHERE id=$1",[req.user.id]);
  if (!q.rows.length) return res.status(401).json({ error:"no user" });
  const ok = await bcrypt.compare(old_password||"", q.rows[0].pass_hash);
  if (!ok) return res.status(401).json({ error:"wrong old" });
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query("UPDATE teachers SET pass_hash=$1 WHERE id=$2",[hash, req.user.id]);
  res.json({ ok:true });
});

app.post("/api/auth/update_profile", auth, async (req,res)=>{
  const { email, username } = req.body || {};
  if (!email && !username) return res.status(400).json({ error:"no changes" });
  try{
    await pool.query("UPDATE teachers SET email=COALESCE($1,email), username=COALESCE($2,username) WHERE id=$3", [email, username, req.user.id]);
    res.json({ ok:true });
  }catch(e){ res.status(400).json({ error:"update failed", detail:String(e) }); }
});

// Password reset via email
app.post("/api/auth/reset", async (req,res)=>{
  const { email, username } = req.body || {};
  if (!email || !username) return res.status(400).json({ error:"missing" });
  const q = await pool.query("SELECT * FROM teachers WHERE email=$1 AND username=$2", [email, username]);
  if (!q.rows.length) return res.status(404).json({ error:"not found" });
  if (!transporter) return res.status(500).json({ error:"mail not configured" });
  const temp = randomBytes(6).toString("base64").replace(/[^a-zA-Z0-9]/g,"").slice(0,10);
  const hash = await bcrypt.hash(temp, 10);
  await pool.query("UPDATE teachers SET pass_hash=$1 WHERE id=$2", [hash, q.rows[0].id]);
  const info = await transporter.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "إعادة تعيين كلمة المرور - منصة الاختبارات القصيرة",
    text: `تم إنشاء كلمة مرور مؤقتة لحسابك (${username}): ${temp}\nيرجى تسجيل الدخول وتغييرها من لوحة المدرس.`
  });
  res.json({ ok:true, sent:true });
});

// Admin: reset teacher password manually
app.post("/api/admin/reset_teacher", auth, adminOnly, async (req,res)=>{
  const { email, username, new_password } = req.body || {};
  if (!email || !username || !new_password) return res.status(400).json({ error:"missing" });
  const q = await pool.query("SELECT * FROM teachers WHERE email=$1 AND username=$2",[email, username]);
  if (!q.rows.length) return res.status(404).json({ error:"not found" });
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query("UPDATE teachers SET pass_hash=$1 WHERE id=$2", [hash, q.rows[0].id]);
  res.json({ ok:true });
});

// Messages
app.post("/api/messages", async (req,res)=>{
  const { sender_name, sender_email, type, subject, body } = req.body || {};
  await pool.query("INSERT INTO messages (sender_name, sender_email, type, subject, body) VALUES ($1,$2,$3,$4,$5)",
    [sender_name||null, sender_email||null, type||null, subject||null, body||null]);
  res.json({ ok:true });
});
app.get("/api/messages", auth, adminOnly, async (req,res)=>{
  const { rows } = await pool.query("SELECT * FROM messages ORDER BY created_at DESC LIMIT 500");
  res.json({ ok:true, items: rows });
});
app.post("/api/messages/reply/:id", auth, adminOnly, async (req,res)=>{
  const { body } = req.body || {};
  const q = await pool.query("SELECT * FROM messages WHERE id=$1", [req.params.id]);
  if (!q.rows.length) return res.status(404).json({ error:"not found" });
  if (!transporter) return res.status(500).json({ error:"mail not configured" });
  await transporter.sendMail({
    from: MAIL_FROM,
    to: q.rows[0].sender_email,
    subject: "رد من إدارة منصة الاختبارات القصيرة",
    text: body || ""
  });
  res.json({ ok:true, sent:true });
});
app.delete("/api/messages/:id", auth, adminOnly, async (req,res)=>{
  await pool.query("DELETE FROM messages WHERE id=$1",[req.params.id]);
  res.json({ ok:true });
});

// Quizzes and Results
app.post("/api/quizzes", auth, async (req,res)=>{
  try{
    const { title, questions } = req.body || {};
    if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ error:"questions required" });
    const id = randomBytes(8).toString("base64").replace(/[^a-zA-Z0-9]/g,"").slice(0,8);
    const data = { questions };
    await pool.query("INSERT INTO quizzes (id, owner_id, title, data) VALUES ($1,$2,$3,$4::jsonb)",
      [id, req.user.id, title||null, JSON.stringify(data)]);
    res.status(201).json({ ok:true, id, link: `/student.html?id=${id}` });
  }catch(e){ res.status(500).json({ error:"create failed" }); }
});
app.get("/api/my_quizzes", auth, async (req,res)=>{
  const { rows } = await pool.query("SELECT id, title, created_at FROM quizzes WHERE owner_id=$1 ORDER BY created_at DESC", [req.user.id]);
  res.json({ ok:true, items: rows });
});
app.get("/api/quiz/:id", async (req,res)=>{
  const q = await pool.query("SELECT id, title, data FROM quizzes WHERE id=$1",[req.params.id]);
  if (!q.rows.length) return res.status(404).json({ error:"not found" });
  res.json({ id:q.rows[0].id, title:q.rows[0].title, ...q.rows[0].data });
});
app.post("/api/results", async (req,res)=>{
  try{
    const { quiz_id, student_name, score, total, left_page, meta } = req.body || {};
    if (!quiz_id || typeof score!=="number" || typeof total!=="number") return res.status(400).json({ error:"bad request" });
    await pool.query("INSERT INTO results (quiz_id, student_name, score, total, left_page, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
      [quiz_id, student_name||null, score, total, !!left_page, JSON.stringify(meta||{})]);
    res.status(201).json({ ok:true });
  }catch(e){ res.status(500).json({ error:"save failed" }); }
});
app.get("/api/quiz_results/:id", auth, async (req,res)=>{
  const { rows } = await pool.query("SELECT * FROM results WHERE quiz_id=$1 ORDER BY created_at DESC", [req.params.id]);
  res.json({ ok:true, items: rows });
});

// Static

// Admin: list pending teachers
app.get("/api/admin/pending_teachers", auth, adminOnly, async (req,res)=>{
  const { rows } = await pool.query("SELECT id, email, username, created_at FROM teachers WHERE approved=false AND is_admin=false ORDER BY created_at ASC");
  res.json({ ok:true, items: rows });
});
// Admin: approve
app.post("/api/admin/approve_teacher", auth, adminOnly, async (req,res)=>{
  const { id } = req.body || {};
  if(!id) return res.status(400).json({ error:"missing" });
  await pool.query("UPDATE teachers SET approved=true WHERE id=$1", [id]);
  res.json({ ok:true });
});
// Admin: reject (delete)
app.post("/api/admin/reject_teacher", auth, adminOnly, async (req,res)=>{
  const { id } = req.body || {};
  if(!id) return res.status(400).json({ error:"missing" });
  await pool.query("DELETE FROM teachers WHERE id=$1 AND is_admin=false", [id]);
  res.json({ ok:true });
});


app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req,res)=> res.sendFile(path.join(__dirname, "public", "index.html")));

init().then(()=> app.listen(PORT, ()=>console.log("Asala single server v2 on :"+PORT))).catch(err=>{ console.error(err); process.exit(1); });
