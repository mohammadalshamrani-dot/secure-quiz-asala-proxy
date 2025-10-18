// Secure Quiz Asala – server.mjs (Render Postgres storage)
// Drop-in replacement preserving existing endpoints and frontend behaviour.

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- Config -----
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('[WARN] Missing DATABASE_URL. Set it in Render → Environment.');
}
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Render Postgres requires SSL
}) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ----- Health -----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ----- Bootstrap tables (optional safe) -----
async function ensureTables() {
  if (!pool) return;
  await pool.query(`
    create table if not exists public.quizzes (
      id text primary key,
      payload jsonb not null,
      created_at timestamptz default now()
    );
    create table if not exists public.results (
      id bigserial primary key,
      quiz_id text not null references public.quizzes(id) on delete cascade,
      student_id text,
      score numeric,
      payload jsonb,
      created_at timestamptz default now()
    );
    create index if not exists idx_results_quiz on public.results(quiz_id);
  `);
}
ensureTables().catch(e => console.error('ensureTables', e));

// ----- Quizzes -----
app.post('/api/quizzes', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'Storage not configured' });
    const { id, ...rest } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing quiz id' });
    const sql = `insert into public.quizzes (id, payload)
                 values ($1, $2::jsonb)
                 on conflict (id) do update set payload = excluded.payload`;
    await pool.query(sql, [id, JSON.stringify(rest)]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/quizzes', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

app.get('/api/quiz/:id', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'Storage not configured' });
    const id = req.params.id;
    const { rows } = await pool.query(
      'select id, payload from public.quizzes where id = $1 limit 1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Quiz not found' });
    const row = rows[0];
    return res.json({ id: row.id, ...(row.payload || {}) });
  } catch (e) {
    console.error('GET /api/quiz/:id', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

// ----- Results -----
app.post('/api/results', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'Storage not configured' });
    const { quizId, studentId, score, ...rest } = req.body || {};
    if (!quizId) return res.status(400).json({ error: 'Missing quizId' });
    const sql = `insert into public.results (quiz_id, student_id, score, payload)
                 values ($1, $2, $3, $4::jsonb)`;
    await pool.query(sql, [quizId, studentId || null, (typeof score === 'number' ? score : null), JSON.stringify(rest || {})]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/results', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on :' + PORT));
