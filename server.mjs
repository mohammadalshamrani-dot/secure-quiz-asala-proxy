import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import crypto from 'crypto';

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

// Health endpoint — لا يلمس قاعدة البيانات إطلاقًا
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// تهيئة الجداول عند الطلب فقط
async function ensureSchema() {
  if (!pool) throw new Error('No database configured');
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
}

// إنشاء اختبار + توليد الرابط
app.post('/api/quiz', async (req, res) => {
  try {
    if (!pool) throw new Error('Database not ready');
    await ensureSchema();
    const { title, per_question_seconds, only_one_attempt, questions } = req.body || {};
    if (!title || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ ok: false, error: 'INVALID_BODY' });
    }
    const link_id = crypto.randomBytes(4).toString('hex');
    const qjson = {
      id: link_id,
      title,
      per_question_seconds: Number(per_question_seconds) || 30,
      only_one_attempt: !!only_one_attempt,
      questions
    };
    await pool.query(
      "INSERT INTO quizzes(link_id,title,per_question_seconds,only_one_attempt,qjson) VALUES ($1,$2,$3,$4,$5)",
      [link_id, title, Number(per_question_seconds) || 30, !!only_one_attempt, JSON.stringify(qjson)]
    );
    res.json({ ok: true, link_id });
  } catch (e) {
    console.error('quiz-create-error', e);
    res.status(500).json({ ok: false, error: 'CREATE_FAILED' });
  }
});

// جلب بيانات اختبار للطالب
app.get('/api/quiz/:id', async (req, res) => {
  try {
    if (!pool) throw new Error('Database not ready');
    await ensureSchema();
    const { rows } = await pool.query("SELECT qjson FROM quizzes WHERE link_id = $1 LIMIT 1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false });
    res.json(rows[0].qjson);
  } catch (e) {
    console.error('quiz-get-error', e);
    res.status(500).json({ ok: false });
  }
});

// تسجيل النتيجة
app.post('/api/result', async (req, res) => {
  try {
    if (!pool) throw new Error('Database not ready');
    await ensureSchema();
    const { quiz_id, student_name, score, total, left_page, meta } = req.body || {};
    await pool.query(
      "INSERT INTO results(quiz_id,student_name,score,total,left_page,meta) VALUES ($1,$2,$3,$4,$5,$6)",
      [quiz_id, student_name, Number(score)||0, Number(total)||0, !!left_page, JSON.stringify(meta||{})]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('result-insert-error', e);
    res.status(500).json({ ok: false });
  }
});

// ملفات الواجهة
app.use(express.static('public'));

// جذر الخدمة → يسلم index.html
app.get('/', (req,res) => {
  res.sendFile(new URL('./public/index.html', import.meta.url).pathname);
});

app.listen(PORT, () => {
  console.log('Asala v5.1.5 listening on', PORT);
});
