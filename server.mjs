import express from 'express';
import cors from 'cors';
import pg from 'pg';
const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT false,
      is_approved BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      title TEXT,
      per_question_seconds INT,
      only_one_attempt BOOLEAN DEFAULT false,
      created_by INT REFERENCES teachers(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}
ensureSchema();

app.post('/api/auth/register', async (req,res)=>{
  const { email, username, password } = req.body;
  if(!email || !username || !password) return res.status(400).json({ok:false});
  const dup = await pool.query('SELECT 1 FROM teachers WHERE lower(username)=lower($1) OR lower(email)=lower($2)', [username, email]);
  if(dup.rows.length) return res.status(409).json({ok:false, error:'ALREADY_EXISTS'});
  await pool.query('INSERT INTO teachers (username,email,password,is_admin,is_approved) VALUES ($1,$2,$3,false,false)', [username,email,password]);
  res.json({ok:true,message:'PENDING_APPROVAL'});
});

app.post('/api/auth/login', async (req,res)=>{
  const { username,password }=req.body;
  const r=await pool.query('SELECT * FROM teachers WHERE lower(username)=lower($1)', [username]);
  if(!r.rows.length) return res.status(401).json({ok:false});
  const t=r.rows[0];
  if(!t.is_approved) return res.status(403).json({ok:false,error:'NOT_APPROVED'});
  if(t.password!==password) return res.status(401).json({ok:false});
  res.json({ok:true,token:'dummy-token',is_admin:t.is_admin});
});

app.get('/api/admin/quizzes', async (req,res)=>{
  const r=await pool.query('SELECT q.id,q.title,q.per_question_seconds,q.only_one_attempt,t.username,q.created_at FROM quizzes q JOIN teachers t ON q.created_by=t.id ORDER BY q.created_at DESC');
  res.json(r.rows);
});

app.get('/api/admin/pending', async (req,res)=>{
  const r=await pool.query('SELECT id,username,email FROM teachers WHERE is_approved=false');
  res.json(r.rows);
});

app.post('/api/admin/teachers/:id/approve', async (req,res)=>{
  const { approve }=req.body;
  await pool.query('UPDATE teachers SET is_approved=$1 WHERE id=$2',[approve,req.params.id]);
  res.json({ok:true});
});

app.post('/api/admin/reset_password', async (req,res)=>{
  const { username,new_password }=req.body;
  await pool.query('UPDATE teachers SET password=$1 WHERE username=$2',[new_password,username]);
  res.json({ok:true});
});

app.listen(port,()=>console.log('Server running on port',port));
