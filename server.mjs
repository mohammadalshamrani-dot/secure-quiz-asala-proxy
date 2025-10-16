import express from "express";
import cors from "cors";

// Environment
const PORT = process.env.PORT || 10000;
const STORAGE_BASE_URL = process.env.STORAGE_BASE_URL; // e.g., https://secure-quiz-asala-1.onrender.com
if (!STORAGE_BASE_URL) {
  console.error("Missing STORAGE_BASE_URL env var");
}

const app = express();

// Middleware
app.use(cors({ origin: "*"}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/api/health", async (req, res) => {
  try {
    const upstream = new URL("/api/health", STORAGE_BASE_URL);
    const r = await fetch(upstream, { method: "GET" });
    const text = await r.text();
    return res.status(200).json({ ok: true, upstream: STORAGE_BASE_URL, upstream_status: r.status, upstream_text: text.slice(0, 200) });
  } catch (err) {
    return res.status(200).json({ ok: true, upstream: STORAGE_BASE_URL, upstream_error: String(err) });
  }
});

// Generic proxy for all /api/* endpoints to the STORAGE_BASE_URL
app.use("/api", async (req, res) => {
  try {
    if (!STORAGE_BASE_URL) {
      return res.status(500).json({ error: "STORAGE_BASE_URL not configured" });
    }
    const targetUrl = new URL(req.originalUrl, STORAGE_BASE_URL);
    const headers = new Headers();

    // Forward content-type if present
    if (req.headers["content-type"]) headers.set("content-type", req.headers["content-type"]);
    if (req.headers["authorization"]) headers.set("authorization", req.headers["authorization"]);

    const init = {
      method: req.method,
      headers
    };

    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      init.body = req.rawBody || JSON.stringify(req.body ?? {});
      // If express.json parsed the body, reconstruct it:
      if (!init.body && typeof req.body === "object") {
        init.body = JSON.stringify(req.body);
        headers.set("content-type", "application/json");
      }
    }

    const r = await fetch(targetUrl, init);
    const type = r.headers.get("content-type") || "";
    const status = r.status;

    if (type.includes("application/json")) {
      const data = await r.json();
      return res.status(status).json(data);
    } else {
      const text = await r.text();
      return res.status(status).send(text);
    }
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(502).json({ error: "Upstream error", detail: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Secure Quiz Asala proxy server listening on :${PORT}`);
});
