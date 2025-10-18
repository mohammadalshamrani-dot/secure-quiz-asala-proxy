// Secure Quiz Asala – server.mjs (Supabase STORAGE only; no SQL needed)
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[WARN] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
async function ensureBuckets() {
  if (!supabase) return;
  const { data: buckets } = await supabase.storage.listBuckets();
  const names = new Set((buckets || []).map(b => b.name));
  if (!names.has('quizzes')) await supabase.storage.createBucket('quizzes', { public: false });
  if (!names.has('results')) await supabase.storage.createBucket('results', { public: false });
}
ensureBuckets().catch(e => console.error('ensureBuckets', e));

async function uploadJson(bucket, key, obj) {
  const json = Buffer.from(JSON.stringify(obj || {}, null, 0), 'utf-8');
  await supabase.storage.from(bucket).remove([key]).catch(()=>{});
  const { error } = await supabase.storage.from(bucket).upload(key, json, {
    contentType: 'application/json',
    upsert: true,
  });
  if (error) throw error;
}

async function downloadJson(bucket, key) {
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  const text = Buffer.from(arrayBuffer).toString('utf-8');
  return JSON.parse(text || '{}');
}

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Save/Update quiz
app.post('/api/quizzes', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Storage not configured' });
    const b = req.body || {};
    const id = b.id || b.quizId || (b.data && (b.data.id || b.data.quizId));
    if (!id) return res.status(400).json({ error: 'Missing quiz id' });
    const { id: _i1, quizId: _i2, data: _data, ...rest } = b;
    const payload = (_data && Object.keys(rest).length === 0) ? _data : { ...rest };
    await uploadJson('quizzes', `${id}.json`, payload);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error('POST /api/quizzes', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

// Fetch quiz
app.get('/api/quiz/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Storage not configured' });
    const id = req.params.id;
    const data = await downloadJson('quizzes', `${id}.json`);
    return res.json({ id, ...(data || {}) });
  } catch (e) {
    console.error('GET /api/quiz/:id', e);
    return res.status(404).json({ error: 'Quiz not found' });
  }
});

// Save result
app.post('/api/results', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Storage not configured' });
    const b = req.body || {};
    const quizId = b.quizId || b.id || (b.data && (b.data.quizId || b.data.id));
    if (!quizId) return res.status(400).json({ error: 'Missing quizId' });
    const entry = {
      quiz_id: quizId,
      student_id: b.studentId || b.sid || null,
      score: (typeof b.score === 'number') ? b.score : (typeof b.result === 'number') ? b.result : null,
      payload: b.payload || b.data || b,
      created_at: new Date().toISOString()
    };
    const key = `${quizId}/${Date.now()}.json`;
    await uploadJson('results', key, entry);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/results', e);
    return res.status(500).json({ error: 'Unexpected error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on :' + PORT));
