// server.mjs  —  Cloud storage via PostgreSQL (Render)
// ----------------------------------------------------
// يعمل مع متغيرات البيئة على Render:
//  - DATABASE_URL  (قيمة الاتصال بقاعدة Alasala Quiz)
//  - PORT=3000
//
// لا تغييرات على الواجهات الأمامية — نفس مسارات /api/*
// ----------------------------------------------------

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Express ----------
const app = express();
app.use(cors()); // يسمح بالوصول من أي دومين
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- PostgreSQL ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // ضروري لـ Render
});

// إنشاء الجداول إن لم تكن موجودة
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        username TEXT PRIMARY KEY,
        pass TEXT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pass TEXT NOT NULL,
        approved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pending (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pass TEXT NOT NULL,
        ts BIGINT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inbox (
        id BIGSERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        msg TEXT,
        ts BIGINT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        title TEXT,
        course TEXT,
        teacher TEXT,
        jsondata JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS results (
        id BIGSERIAL PRIMARY KEY,
        quiz_id TEXT REFERENCES quizzes(id) ON DELETE CASCADE,
        name TEXT,
        sid TEXT,
        score INT,
        total INT,
        "left" BOOLEAN,
        duration_sec INT,
        ts BIGINT NOT NULL,
        meta JSONB
      );
    `);

    // تأمين حساب الأدمن الافتراضي إذا لم يوجد
    await client.query(`
      INSERT INTO admins (username, pass)
      VALUES ('admin', 'AaBbCc123')
      ON CONFLICT (username) DO NOTHING;
    `);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('DB init error:', e);
    throw e;
  } finally {
    client.release();
  }
}
await createTables();

// ---------- Helpers ----------
const ok = (res, data = { ok: true }) => res.json(data);
const mapRows = (rows, key = 'id') =>
  rows.reduce((acc, r) => ((acc[r[key]] = r), acc), {});

// ---------- APIs ----------

// --- Admin (اسم المستخدم/كلمة المرور) ---
app.get('/api/admin', async (_req, res) => {
  const { rows } = await pool.query('SELECT username AS "user", pass FROM admins LIMIT 1;');
  if (!rows.length) return res.json({ user: 'admin', pass: 'AaBbCc123' });
  res.json(rows[0]);
});

app.post('/api/admin', async (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: 'Bad admin payload' });
  await pool.query(
    `INSERT INTO admins (username, pass)
     VALUES ($1,$2)
     ON CONFLICT (username) DO UPDATE SET pass = EXCLUDED.pass;`,
    [user, pass]
  );
  ok(res);
});

// --- Users (الأعضاء) ---
app.get('/api/users', async (_req, res) => {
  const { rows } = await pool.query('SELECT name, email, pass, approved, created_at FROM users ORDER BY created_at;');
  res.json(rows);
});

app.post('/api/users', async (req, res) => {
  const { name, email, pass, approved } = req.body || {};
  if (!email || !name || !pass) return res.status(400).json({ error: 'Bad user payload' });
  await pool.query(
    `INSERT INTO users (email, name, pass, approved)
     VALUES ($1,$2,$3,COALESCE($4,false))
     ON CONFLICT (email)
     DO UPDATE SET name=EXCLUDED.name, pass=EXCLUDED.pass, approved=EXCLUDED.approved;`,
    [email.toLowerCase(), name, pass, !!approved]
  );
  ok(res);
});

// --- Pending (طلبات التسجيل) ---
app.get('/api/pending', async (_req, res) => {
  const { rows } = await pool.query('SELECT name, email, pass, ts FROM pending ORDER BY ts;');
  res.json(rows);
});

app.post('/api/pending', async (req, res) => {
  const { name, email, pass, ts } = req.body || {};
  if (!email || !name || !pass || !ts) return res.status(400).json({ error: 'Bad pending payload' });
  await pool.query(
    `INSERT INTO pending (email, name, pass, ts)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, pass=EXCLUDED.pass, ts=EXCLUDED.ts;`,
    [email.toLowerCase(), name, pass, ts]
  );
  ok(res);
});

app.delete('/api/pending/:email', async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  await pool.query('DELETE FROM pending WHERE email=$1;', [email]);
  ok(res);
});

// --- Inbox (الوارد/التواصل) ---
app.get('/api/inbox', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, msg, ts FROM inbox ORDER BY id DESC;');
  res.json(rows);
});

app.post('/api/inbox', async (req, res) => {
  const { name, email, msg, ts } = req.body || {};
  if (!msg || !ts) return res.status(400).json({ error: 'Bad inbox payload' });
  await pool.query(
    `INSERT INTO inbox (name, email, msg, ts) VALUES ($1,$2,$3,$4);`,
    [name || '', (email || '').toLowerCase(), msg, ts]
  );
  ok(res);
});

// --- Quizzes (الاختبارات) ---
app.get('/api/quizzes', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, title, course, teacher, jsondata FROM quizzes ORDER BY created_at DESC;');
  const out = {};
  for (const r of rows) out[r.id] = r.jsondata;
  res.json(out);
});

app.post('/api/quizzes', async (req, res) => {
  const q = req.body || {};
  if (!q.quizId || !q.title || !q.qs) return res.status(400).json({ error: 'Bad quiz payload' });
  await pool.query(
    `INSERT INTO quizzes (id, title, course, teacher, jsondata)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id)
     DO UPDATE SET title=EXCLUDED.title, course=EXCLUDED.course, teacher=EXCLUDED.teacher, jsondata=EXCLUDED.jsondata;`,
    [q.quizId, q.title || '', q.course || '', q.teacher || '', q]
  );
  ok(res);
});

app.delete('/api/quizzes/:id', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await pool.query('DELETE FROM quizzes WHERE id=$1;', [id]);
  ok(res);
});

// --- Results (النتائج) ---
app.get('/api/results', async (req, res) => {
  const quizId = req.query.quizId;
  if (quizId) {
    const { rows } = await pool.query(
      `SELECT quiz_id AS "quizId", name, sid, score, total, "left", duration_sec AS "durationSec", ts, meta
       FROM results WHERE quiz_id=$1 ORDER BY ts;`,
      [quizId]
    );
    return res.json(rows);
  }
  const { rows } = await pool.query(
    `SELECT quiz_id, name, sid, score, total, "left", duration_sec, ts, meta FROM results ORDER BY ts;`
  );
  const map = {};
  for (const r of rows) {
    (map[r.quiz_id] = map[r.quiz_id] || []).push({
      quizId: r.quiz_id,
      name: r.name,
      sid: r.sid,
      score: r.score,
      total: r.total,
      left: r.left,
      durationSec: r.duration_sec,
      ts: r.ts,
      meta: r.meta,
    });
  }
  res.json(map);
});

app.post('/api/results', async (req, res) => {
  const r = req.body || {};
  if (!r.quizId || typeof r.score === 'undefined' || typeof r.total === 'undefined' || !r.ts) {
    return res.status(400).json({ error: 'Bad result payload' });
  }
  await pool.query(
    `INSERT INTO results (quiz_id, name, sid, score, total, "left", duration_sec, ts, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);`,
    [
      r.quizId,
      r.name || '',
      r.sid || '',
      r.score | 0,
      r.total | 0,
      !!r.left,
      r.durationSec ? Number(r.durationSec) : null,
      Number(r.ts),
      r.meta ? r.meta : null,
    ]
  );
  ok(res);
});

// --- Health ---
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Secure Quiz server listening on :' + PORT);
});
