import express from "express";
import cors from "cors";
import crypto from "crypto";
import pkg from "pg";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const JWT_SECRET = process.env.JWT_SECRET || "SecureQuizAsala2025";

let pool = null;
if (DATABASE_URL) {
  const { Pool } = pkg;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 7,
  });
}

// ===== Helpers =====
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

function signJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64");
  const encSig = sig.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${encSig}`;
}

function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const exp = crypto.createHmac("sha256", secret).update(data).digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (exp !== s) throw new Error("bad sig");
  return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

function authFrom(req) {
  const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try { return verifyJWT(m[1], JWT_SECRET); } catch { return null; }
}

const sha256 = (txt) => crypto.createHash("sha256").update(String(txt)).digest("hex");

// ===== Health (بدون قاعدة بيانات) =====
app.get("/api/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ===== Schema bootstrap & backfill =====
async function ensureSchema() {
  if (!pool) throw new Error("No database configured");

  // core tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      email TEXT,
      username TEXT UNIQUE NOT NULL,
      password TEXT,
      pass_hash TEXT,
      is_admin BOOLEAN DEFAULT false,
      is_approved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // columns safety
  await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS password TEXT`);
  await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS pass_hash TEXT`);
  await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_teachers_username ON teachers (lower(username))`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      link_id TEXT UNIQUE,
      title TEXT,
      per_question_seconds INT,
      only_one_attempt BOOLEAN DEFAULT false,
      qjson JSONB,
      creator_id INT,
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

  // backfill pass_hash
  const back = await pool.query(`SELECT id, password FROM teachers WHERE pass_hash IS NULL AND password IS NOT NULL`);
  for (const r of back.rows) {
    await pool.query(`UPDATE teachers SET pass_hash=$1 WHERE id=$2`, [sha256(r.password), r.id]);
  }

  // admin bootstrap
  const adminUser = "Admin";
  const adminPass = "AaBbCc123";
  const ex = await pool.query(`SELECT id FROM teachers WHERE lower(username)=lower($1) LIMIT 1`, [adminUser]);
  if (!ex.rows.length) {
    await pool.query(
      `INSERT INTO teachers (email, username, password, pass_hash, is_admin, is_approved)
       VALUES ($1,$2,$3,$4,true,true)`,
      ["admin@alasala.edu.sa", adminUser, adminPass, sha256(adminPass)]
    );
  }
}

// ===== Auth =====
app.post("/api/auth/login", async (req, res) => {
  try {
    if (!pool) throw new Error("DB");
    await ensureSchema();
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false });

    const q = await pool.query(
      `SELECT id, username, email, password, pass_hash, is_admin, is_approved
       FROM teachers WHERE lower(username)=lower($1) LIMIT 1`,
      [username]
    );
    if (!q.rows.length) return res.status(401).json({ ok: false, error: "NO_USER" });
    const u = q.rows[0];

    if (!u.is_approved) return res.status(403).json({ ok: false, error: "NOT_APPROVED" });

    const ok =
      (u.password && String(u.password) === String(password)) ||
      (u.pass_hash && u.pass_hash === sha256(password));

    if (!ok) return res.status(401).json({ ok: false, error: "BAD_PASS" });

    const token = signJWT({ uid: u.id, username: u.username, is_admin: !!u.is_admin }, JWT_SECRET);
    res.json({ ok: true, token, me: { id: u.id, username: u.username, is_admin: !!u.is_admin } });
  } catch (e) {
    console.error("login-error", e);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const a = authFrom(req);
    if (!a) return res.json({ me: null });
    if (pool) {
      await ensureSchema();
      const r = await pool.query(`SELECT id, username, is_admin FROM teachers WHERE id=$1`, [a.uid]);
      if (r.rows.length) return res.json({ me: r.rows[0] });
    }
    res.json({ me: { id: a.uid, username: a.username, is_admin: !!a.is_admin } });
  } catch {
    res.json({ me: null });
  }
});

// Register teacher (pending approval)
app.post("/api/teachers/register", async (req, res) => {
  try {
    if (!pool) throw new Error("DB");
    await ensureSchema();
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ ok: false });

    const exists = await pool.query(`SELECT 1 FROM teachers WHERE lower(username)=lower($1)`, [username]);
    if (exists.rows.length) return res.status(409).json({ ok: false, error: "EXISTS" });

    await pool.query(
      `INSERT INTO teachers (email, username, password, pass_hash, is_admin, is_approved)
       VALUES ($1,$2,$3,$4,false,false)`,
      [email, username, password, sha256(password)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("register-error", e);
    res.status(500).json({ ok: false });
  }
});

// ===== Admin APIs =====
function requireAdmin(req, res, next) {
  const a = authFrom(req);
  if (!a || !a.is_admin) return res.status(401).json({ ok: false });
  req.user = a;
  next();
}

app.get("/api/admin/pending", requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const r = await pool.query(
      `SELECT id, username, email, created_at
       FROM teachers
       WHERE is_approved=false AND is_admin=false
       ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error("pending-error", e);
    res.status(500).json({ ok: false });
  }
});

app.post("/api/admin/teachers/:id/approve", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { approve } = req.body || {};
    await ensureSchema();
    await pool.query(`UPDATE teachers SET is_approved=$1 WHERE id=$2 AND is_admin=false`, [!!approve, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("approve-error", e);
    res.status(500).json({ ok: false });
  }
});

app.post("/api/admin/reset_password", requireAdmin, async (req, res) => {
  try {
    const { username, new_password } = req.body || {};
    if (!username || !new_password) return res.status(400).json({ ok: false });
    await ensureSchema();
    await pool.query(
      `UPDATE teachers SET password=$1, pass_hash=$2 WHERE lower(username)=lower($3) AND is_admin=false`,
      [new_password, sha256(new_password), username]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("resetpass-error", e);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/admin/quizzes", requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const r = await pool.query(
      `SELECT link_id, title, per_question_seconds, only_one_attempt, created_at
       FROM quizzes ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error("q-list-error", e);
    res.status(500).json({ ok: false });
  }
});

// ===== Quiz =====
app.post("/api/quiz", async (req, res) => {
  try {
    if (!pool) throw new Error("DB");
    await ensureSchema();
    const a = authFrom(req);
    if (!a) return res.status(401).json({ ok: false });

    const { title, per_question_seconds, only_one_attempt, questions } = req.body || {};
    if (!title || !Array.isArray(questions) || !questions.length) return res.status(400).json({ ok: false });

    const link_id = crypto.randomBytes(4).toString("hex");
    const qjson = {
      id: link_id,
      title,
      per_question_seconds: Number(per_question_seconds) || 30,
      only_one_attempt: !!only_one_attempt,
      questions,
    };

    await pool.query(
      `INSERT INTO quizzes (link_id,title,per_question_seconds,only_one_attempt,qjson,creator_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [link_id, title, Number(per_question_seconds) || 30, !!only_one_attempt, JSON.stringify(qjson), a.uid || null]
    );

    res.json({ ok: true, link_id });
  } catch (e) {
    console.error("quiz-create-error", e);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/quiz/:id", async (req, res) => {
  try {
    if (!pool) throw new Error("DB");
    await ensureSchema();
    const r = await pool.query(`SELECT qjson FROM quizzes WHERE link_id=$1 LIMIT 1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false });
    res.json(r.rows[0].qjson);
  } catch (e) {
    console.error("quiz-get-error", e);
    res.status(500).json({ ok: false });
  }
});

app.post("/api/result", async (req, res) => {
  try {
    if (!pool) throw new Error("DB");
    await ensureSchema();
    const { quiz_id, student_name, score, total, left_page, meta } = req.body || {};
    await pool.query(
      `INSERT INTO results (quiz_id,student_name,score,total,left_page,meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [quiz_id, student_name, Number(score) || 0, Number(total) || 0, !!left_page, JSON.stringify(meta || {})]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("result-insert-error", e);
    res.status(500).json({ ok: false });
  }
});

// ===== Static & root =====
app.use(express.static("public"));
app.get("/", (req, res) => res.sendFile(new URL("./public/index.html", import.meta.url).pathname));

app.listen(PORT, () => console.log("Asala server listening on", PORT));
