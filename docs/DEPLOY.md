# Deployment

Topology: **Vercel** (Next.js web) + **Railway or Fly.io** (Socket.io server) + **Postgres** (Supabase/Neon/Railway) + **Redis** (Upstash/Railway, optional but recommended).

## 1. Database

Create a Postgres database. With Supabase use the *Session pooler* URL as `DATABASE_URL` (Prisma 7 uses the `pg` driver; a direct URL works too).

```bash
cd packages/db
DATABASE_URL=postgresql://… pnpm migrate      # prisma migrate deploy — applies prisma/migrations
DATABASE_URL=postgresql://… ADMIN_EMAIL=you@example.com pnpm seed
```

## 2. Socket server → Railway

1. New project → *Deploy from GitHub repo* → root directory `/` (monorepo).
2. Settings → Build: `corepack enable && pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @monumental/server build`
   Start: `node apps/server/dist/index.js`
   (Alternatively use `apps/server/Dockerfile`.)
3. Variables (see `apps/server/.env.example`):
   `PORT` (Railway injects), `CORS_ORIGINS=https://your-app.vercel.app`, `SOCKET_JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `TOURNAMENTS_ENABLED=true`, `HOURLY_TOURNAMENT_LEVEL=3`.
4. Generate a domain; note `https://xxx.up.railway.app`. Health check: `/health`.

### … or Fly.io

```bash
fly launch --no-deploy --dockerfile apps/server/Dockerfile --name monumental-socket
fly secrets set SOCKET_JWT_SECRET=… DATABASE_URL=… REDIS_URL=… CORS_ORIGINS=https://your-app.vercel.app
fly deploy
```
`apps/server/fly.toml` is included (internal port 4000, websockets, 1 machine minimum — the game loop must not scale to zero mid-round).

Run **one** server instance per room set. With `REDIS_URL` the Socket.io Redis adapter is enabled so several instances can broadcast to each other, but room engines are process-local; to scale horizontally, shard levels/tournaments across instances or keep one instance (a single Node process comfortably handles thousands of concurrent players — rounds are cheap).

## 3. Web app → Vercel

1. Import the repo. Framework: Next.js. **Root directory: `apps/web`**. Vercel detects pnpm workspaces.
2. Build command: `cd ../.. && pnpm db:generate && pnpm --filter @monumental/web build` · Install command: `cd ../.. && pnpm install --frozen-lockfile` · Output: default.
3. Environment variables (see `apps/web/.env.example`):
   - `NEXT_PUBLIC_SOCKET_URL=https://xxx.up.railway.app`
   - `SOCKET_JWT_SECRET` (same as server)
   - `DATABASE_URL`, `DIRECT_URL`
   - `AUTH_SECRET` (`openssl rand -base64 32`), `AUTH_URL=https://your-app.vercel.app`
   - optional `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (Google Cloud → OAuth client, redirect URI `https://your-app.vercel.app/api/auth/callback/google`)
   - optional `EMAIL_SERVER` (`smtp://resend:re_xxx@smtp.resend.com:465`) / `EMAIL_FROM`
   - `ADMIN_EMAILS=you@example.com`
4. Deploy. Then update the server's `CORS_ORIGINS` with the final Vercel URL.

## 4. Smoke test

- `https://xxx.up.railway.app/health` → `{ ok: true, db: true, store: "redis" }`
- Open the site in two browsers, join Level 1, confirm both see the same round/timer.
- `/tournaments` shows the next hourly open (created by the scheduler within 15 s of boot).
- Sign in with an `ADMIN_EMAILS` account → `/admin/monuments` → add a monument → it appears in rounds within 3 minutes.

## Notes

- Timers: all phases use server epoch ms; client clock offset is measured with `ping_time`. Keep server time NTP-synced (cloud hosts are).
- Prisma: the generated client lives in `packages/db/src/generated` (git-ignored) — always run `pnpm db:generate` in CI before building either app.
- Prisma `migrate`/`db push` need the Prisma schema engine binary (downloaded on first run from binaries.prisma.sh); the client itself is engine-free.
