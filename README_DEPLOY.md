# Secure Quiz Asala — Proxy Backend (Render-ready)

This backend keeps your *website unchanged* and simply forwards all `/api/*` calls
to your cloud storage/server at `STORAGE_BASE_URL` (e.g. https://secure-quiz-asala-1.onrender.com).

## What it does
- `/api/health` -> checks upstream health (doesn't modify anything)
- any `/api/*` -> forwards **as-is** (method + body + headers) to `${STORAGE_BASE_URL}/api/*`

## Deploy on Render (new service)
1) Create a new repository with just these files (e.g., folder `backend/` at repo root or as the repo root).
2) On Render:
   - Environment: Node 18+
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Root Directory: choose the folder that contains `package.json` (e.g., `backend` if you nested it).
   - Add Environment Variable: `STORAGE_BASE_URL=https://secure-quiz-asala-1.onrender.com`
3) Deploy. After it's live:
   - Test: open `https://<your-new-service>.onrender.com/api/health`

## Keep the website untouched
You don't need to change your GitHub Pages files or links. If your frontend already calls `/api/...`
on your domain (or you link the "Create Quiz" button to your new Render URL), everything keeps working.

## Notes
- This proxy doesn't store data itself; it trusts and forwards to the upstream storage server.
- If your upstream uses tokens, send them from the frontend as `Authorization` headers; the proxy forwards them.
