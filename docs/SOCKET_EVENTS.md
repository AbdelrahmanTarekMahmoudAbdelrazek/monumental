# Socket.io event contract

Namespace: default (`/`). Transports: websocket, polling. Types live in `packages/shared/src/events.ts`.

## Client → server

| event | payload | ack | notes |
| --- | --- | --- | --- |
| `join_room` | `{ roomId?, levelId?, nickname, guestId?, userToken?, inviteCode? }` | `{ ok, state?: RoomState, playerId?, error? }` | One of `roomId` / `levelId`. `guestId` = client-generated id (`[A-Za-z0-9_-]{8,64}`); `userToken` = HS256 JWT from `GET /api/socket-token` (signed-in users). Joining a second room leaves the first. |
| `leave_room` | – | – | |
| `submit_guess` | `{ roundId, guessPct, lock }` | `{ ok, error? }` | Send with `lock:false` while dragging (client throttles to ~8/s; server keeps the last value as the fallback) and once with `lock:true` to lock in. Rejected when: stale `roundId`, round over (+750 ms grace), already locked, joined mid-round, rate-limited (40 burst / 20 per s). |
| `ping_time` | `{ t0 }` | `{ t0, t1 }` | Clock sync. |

## Server → client

| event | payload | when |
| --- | --- | --- |
| `room_state` | `RoomState` | on join and every phase change (full snapshot; `result` only during reveal, `sessionResult` only when finished) |
| `player_joined` | `PlayerPublic` | |
| `player_left` | `{ playerId }` | |
| `player_locked` | `{ playerId, locked }` | lock status only — never the guess |
| `round_start` | `{ roundId, roundIndex, baseId, targetId, timerSec, endsAt, serverNow, levelId }` | |
| `round_result` | `RoundResult` `{ roundIndex, baseId, targetId, realPct, entries[{playerId,nickname,guessPct,errorPct,points,rank}], leaderboard[] }` | round end (server-scored) |
| `session_end` | `SessionResult` `{ sessionId, levelId, leaderboard[{playerId,nickname,totalPoints,avgError}], winnerId }` | after the last reveal |
| `tournament_update` | `{ tournamentId, status, stage, message, roomId? }` | sent to `player:<playerKey>` channel when a stage starts/ends |
| `error_msg` | `{ code, message }` | |

## RoomState

```ts
{
  roomId, levelId, phase: "lobby"|"round"|"reveal"|"finished",
  phaseEndsAt,      // server epoch ms
  serverNow,        // server epoch ms at snapshot
  roundIndex, roundsPerSession, sessionId,
  players: [{ id, nickname, locked, totalPoints, isGuest, connected }],
  round?: { baseId, targetId, timerSec, roundId },   // never contains the answer
  result?: RoundResult, sessionResult?: SessionResult,
  tournament?: { id, name, stage, stageName }
}
```

## REST (socket server)

`GET /health` · `GET /rooms` (live player counts per level) · `GET /rooms/:id` · `GET /levels` · `GET /monuments` (merged catalogue incl. silhouettes) · `GET /time`

## REST (web app)

`GET /api/socket-token` · `GET /api/leaderboard?period=daily|weekly|alltime` · `GET|PATCH /api/profile` · `GET|POST /api/tournaments` · `GET /api/tournaments/:id` · `POST|DELETE /api/tournaments/:id/register` · `GET|POST|PUT|DELETE /api/admin/monuments` (ADMIN) · `GET /api/monuments` · `GET /api/rooms` (proxy) · `/api/auth/*` (Auth.js)

## Host-run custom rooms

| event | payload | ack | notes |
| --- | --- | --- | --- |
| `create_room` | `{ settings, nickname, guestId?, userToken? }` | `{ ok, roomId?: "c:ABC123", error? }` | Creator becomes host. Settings: `name, kind ("size"\|"duel"), baseLevelId, helpers, duelCats[], timerSec (5–90), rounds (1–30), revealSec (3–20)` — normalised server-side. Invite link: `/r/ABC123`. |
| `host_start` | – | `{ ok, error? }` | Host only; starts a 5 s countdown. Works again after a game ends ("Play again"). |
| `host_update` | `{ settings }` | `{ ok, error? }` | Host only, while waiting / between games. |

`RoomState.custom = { hostId, settings, level, waiting }`. Custom rooms never auto-start or auto-restart. If the host leaves for 15 s, hosting passes to the next connected player. Empty rooms close after 15 min.
