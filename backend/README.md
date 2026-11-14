# CRUD backend (Lesson 4B)

Express 4 API with PostgreSQL (Supabase), cookie sessions, and reader/admin roles.

## Configuration

Copy `.env.example` to `.env` and set:

- `DATABASE_URL` — PostgreSQL connection URL. Only this variable is used (no alternate names). The password must be percent-encoded inside the URL when it contains `#`, `@`, `%`, or other reserved characters (for example `#` → `%23`, `@` → `%40`, `%` → `%25`).
- `DATABASE_SSL` — optional. TLS is enabled for the `pg` pool by default (`ssl: { rejectUnauthorized: false }`). Set `DATABASE_SSL=false` only for local Postgres without SSL.
- `PORT`, `FRONTEND_ORIGIN`, `NODE_ENV`, `LOGIN_RATE_LIMIT_MAX` — see `.env.example`.

The server starts without a Vue build. When `frontend/dist/index.html` is missing, `GET /` returns a short JSON message and all `/api` routes work as usual.

## Product images

Each product may have **one** image stored in Postgres (`product_images`).

| Rule | Value |
|------|--------|
| Dimensions | Exactly **200 × 200** pixels |
| File size | At most **200 KB** (204800 bytes) |
| Formats | `image/jpeg`, `image/png`, `image/webp` |

### Endpoints (session required)

- `PUT /api/products/:pid/image` — **admin only**. Raw request body; `Content-Type` must match the bytes. Success: `200` with `{ pid, mime, bytes, updated_at }` (no image bytes).
- `GET /api/products/:pid/image` — any logged-in account. Returns image bytes with caching headers and an `ETag` derived from `pid` and `updated_at`. Supports `304` via `If-None-Match`. Cache-bust in the UI with `/api/products/:pid/image?v=<image_updated_at>`.
- `DELETE /api/products/:pid/image` — **admin only**. `204` when removed; `404` when none.

`GET /api/get_products` and `GET /api/get_product/:id` include `image_updated_at` (ISO string or `null`) from a join that does not load image bytes.

Deleting a product removes its image row (`ON DELETE CASCADE`).

## Scripts

```bash
npm start          # run API (+ serves ../frontend/dist when built)
npm run dev        # watch mode
npm run build      # install & build Vue into ../frontend/dist (for Render / production)
npm run seed       # apply schema.sql and seed data
npm test           # node --test (image-utils unit tests)
```

## Deploy on Render

Use **one Web Service** so the UI and API share one origin (session cookies use `SameSite=Strict`).

1. Push the repo to GitHub and connect it in Render, **or** apply `render.yaml` from the repo root.
2. **Root directory:** `backend`
3. **Build command:** `npm install && npm run build`
4. **Start command:** `npm start`
5. **Health check path:** `/api/health`
6. **Environment variables** (dashboard):
   - `DATABASE_URL` — production Supabase URL (password percent-encoded)
   - `NODE_ENV` — `production`
   - `FRONTEND_ORIGIN` — `https://YOUR-SERVICE.onrender.com` (exact public URL, no trailing slash)
   - Do **not** set `DATABASE_SSL=false` for Supabase.

On first deploy to a new database: run `npm run seed` and `node src/create-admin.js` locally against that `DATABASE_URL` (or use Render Shell if available).

### Local production smoke test

```bash
cd frontend && npm run build
cd ../backend
# stop any server on the same PORT first
NODE_ENV=production FRONTEND_ORIGIN=http://localhost:3001 npm start
```

Open `http://localhost:3001` (not the Vite dev port), log in, and check Products / Users / Orders.

Regression API checks (needs running server and `ADMIN_EMAIL` / `ADMIN_PASSWORD`):

```bash
./scripts/regression-test.sh
```

Create PNG fixtures for tests:

```bash
node scripts/make-test-images.js
```

Create the first administrator (interactive):

```bash
node src/create-admin.js
```
