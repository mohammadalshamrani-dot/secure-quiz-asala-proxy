import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Auto-migrations (safe & idempotent) ----
async function migrate() {
  // Create tables if missing
  await pool.query(`
    create table if not exists public.quizzes (
      id text primary key,
      payload jsonb not null default '{}'::jsonb,
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
  `);
  // Add missing columns safely
  await pool.query(`
    alter table public.quizzes
      add column if not exists payload jsonb default '{}'::jsonb,
      add column if not exists created_at timestamptz default now();
    alter table public.results
      add column if not exists student_id text,
      add column if not exists score numeric,
      add column if not exists payload jsonb,
      add column if not exists created_at timestamptz default now();
    create index if not exists idx_results_quiz on public.results(quiz_id);
  `);
  // Ensure jsonb type for quizzes.payload (convert if text)
  await pool.query(`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='quizzes' and column_name='payload' and data_type <> 'jsonb'
      ) then
        alter table public.quizzes
          alter column payload type jsonb using
            case
              when jsonb_typeof(payload::jsonb) is not null then payload::jsonb
              else '{}'::jsonb
            end,
          alter column payload set default '{}'::jsonb;
      end if;
    end
    $$;
  `);
}
migrate().catch(e => console.error('migrate error', e));

// Helpers
function extractQuizId(body, req) {
  if (!body) body = {};
  return (
    body.id ||
    body.quizId ||
    (body.data && (body.data.id || body.data.quizId)) ||
    req.query.id ||
    null
  );
}

// Save/Update quiz
app.post('/api/quizzes', async (req, res) => {
  try {
    const id = extractQuizId(req.body, req);
    if (!id) return res.status(400).json({ error: 'Missing quiz id' });
    const { id: _i1, quizId: _i2, data: _data, ...rest } = req.body || {};
    const payload = (_data && Object.keys(rest).length === 0) ? _data : { ...rest };
    const sql = `insert into public.quizzes (id, payload)
                 values ($1, $2::jsonb)
                 on conflict (id) do update set payload = excluded.payload`;
    await pool.query(sql, [id, JSON.stringify(payload || {})]);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error('POST /api/quizzes error:', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

// Fetch quiz
app.get('/api/quiz/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { rows } = await pool.query('select id, payload from public.quizzes where id = $1 limit 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Quiz not found' });
    const row = rows[0];
    return res.json({ id: row.id, ...(row.payload || {}) });
  } catch (e) {
    console.error('GET /api/quiz/:id error:', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

// Save result
app.post('/api/results', async (req, res) => {
  try {
    const b = req.body || {};
    const quizId = b.quizId || b.id || (b.data && (b.data.quizId || b.data.id));
    if (!quizId) return res.status(400).json({ error: 'Missing quizId' });
    const studentId = b.studentId || b.sid || null;
    const score = (typeof b.score === 'number') ? b.score : (typeof b.result === 'number' ? b.result : null);
    const extra = b.payload || b.data || b;
    const sql = `insert into public.results (quiz_id, student_id, score, payload)
                 values ($1, $2, $3, $4::jsonb)`;
    await pool.query(sql, [quizId, studentId, score, JSON.stringify(extra || {})]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/results error:', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on :' + PORT));
