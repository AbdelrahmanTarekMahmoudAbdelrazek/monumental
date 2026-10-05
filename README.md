# How Big?

*(formerly MONUMENTAL — internal package names still use `@monumental/*`)*

Real-time multiplayer size-guessing game: a **base** item is shown at a fixed size, a **target** item next to it — monuments, animals, mountains, vehicles, planets and stars. Drag the target to the height you think is right relative to the base. Everyone in the room plays the same round on the same server clock; the closest guess takes 3 points, 2nd and 3rd take 1.

153 items with original SVG silhouettes (86 monuments + animals, nature, vehicles, space) · 11 classic levels + 4 Mixed-mode levels · public & private rooms · hourly + custom tournaments (qualifiers → final) · daily/weekly/all-time leaderboards · guest play or Google/email accounts · admin page for monuments · light/dark mode · synthesized SFX with mute.

```
monumental/
├─ apps/
│  ├─ web/        Next.js 15 (App Router) + TypeScript + Tailwind — UI, Auth.js, REST API, admin
│  └─ server/     Node + Socket.io — authoritative game loop, scoring, rooms, tournaments
├─ packages/
│  ├─ shared/     Types, monument dataset + silhouettes, levels, scoring, pairing, layout, socket contract
│  └─ db/         Prisma 7 schema, migration, seed, generated client (Postgres via pg adapter)
└─ docs/          Architecture, socket events, deployment
```

## Quick start (local)

Prereqs: Node 22+, pnpm 10 (`corepack enable`), Postgres, Redis (optional).

```bash
pnpm install

# database
cp packages/db/.env.example packages/db/.env          # DATABASE_URL
pnpm db:generate                                      # prisma generate
pnpm db:migrate                                       # prisma migrate deploy  (or: pnpm --filter @monumental/db migrate:dev)
pnpm db:seed                                          # 86 monuments + next hourly tournament

# apps
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
pnpm dev                                              # web :3000 + socket server :4000
```

Open http://localhost:3000, pick a nickname, press **Play now**. Open a second browser/incognito window to see multiplayer. Without `DATABASE_URL` the server still runs (no persistence/tournaments); without `REDIS_URL` it uses an in-memory store.

## Scripts

| command | what |
| --- | --- |
| `pnpm dev` / `pnpm dev:web` / `pnpm dev:server` | run everything / one app |
| `pnpm build` | build all packages (web: `prisma generate && next build`; server: `tsup` → `dist/index.js`) |
| `pnpm test` | unit tests (scoring, pairing, data integrity, room engine) + socket e2e |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Prisma |

## How it works

**Server-authoritative loop** (`apps/server/src/room/RoomEngine.ts`):
`lobby (12s) → [round (level timer) → reveal (8s)] × 10 → finished (15s intermission) → lobby…`
The client only ever sends guesses; the real height ratio stays on the server until `round_result`. Timers are server epoch timestamps (`phaseEndsAt`) and the client syncs its clock with `ping_time` (NTP-style), so countdowns match across players.

**Scoring** (`packages/shared/src/scoring.ts`): `error = |guess% − real%|`; competition ranking ("1224"): closest → 3 pts, 2nd & 3rd → 1 pt; equal error ⇒ equal rank and points; no guess ⇒ 0. The last drag position counts if a player never locks in.

**Levels** (`packages/shared/src/levels.ts`): difficulty rises through monument tier (famous → obscure), height-ratio band (|log₂(target/base)| — wide gaps first, then near-equal, then extreme ≥16× that needs zoom-to-fit), timer (30s → 8s) and helpers (grid + ruler → ruler → none → silhouettes only). Each level draws from hundreds–thousands of eligible (base, target) pairs; a session's pairs are seeded per session and avoid repeats.

**Rooms**: `level:<n>` public rooms (auto-created, loop forever), `p:<CODE>:<level>` private rooms, `t:<id>:q<n>` / `t:<id>:final` tournament rooms. Players joining mid-round are seated and score from the next round.

**Tournaments** (`apps/server/src/tournaments/scheduler.ts`): DB is the source of truth. Every 15s the server opens registration, auto-creates the next two hourly opens, starts due tournaments (splits entries into qualifier rooms of ≤N, `qualifyingRounds` rounds), advances the top `advanceCount` (tie-break avg error) into a final room, writes stage results, ranks finalists and crowns the winner. Players get `tournament_update` pushes with their room link.

**Persistence** (`apps/server/src/persistence.ts`): at session end — `SessionResult` rows, `LeaderboardEntry` ledger (leaderboards are `SUM(points)` over daily/weekly/all windows) and `PlayerStats` aggregates. Guests are keyed `guest:<id>` (localStorage id), users `user:<id>` (signed socket token from `/api/socket-token`).

**Monuments**: built-in dataset in `packages/shared/src/monuments.ts` (heights checked against Wikipedia/official sources, `heightNote` states whether antennas/pedestals are included) with silhouettes in `silhouettes.ts`. The `Monument` table overrides/extends it; the server re-reads it every 3 minutes, so the admin page (`/admin/monuments`, requires `ADMIN_EMAILS`) adds monuments without a deploy.

See `docs/SOCKET_EVENTS.md` for the event contract and `docs/DEPLOY.md` for Vercel + Railway/Fly deployment.
