// Tournament integration sim: 3 bots register, play qualifier + final, print outcome.
import { io } from "socket.io-client";
import pg from "pg";
const db = new pg.Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/monumental" });
await db.connect();
const id = "tsim" + Date.now().toString(36);
const now = new Date(Date.now() + 5000);
await db.query(`INSERT INTO "Tournament"(id,name,"levelId","startsAt",status,"qualifyingRounds","finalRounds","advanceCount","qualifyingRoomSize","isPrivate") VALUES($1,$2,10,($3::timestamptz AT TIME ZONE 'UTC'),'REGISTRATION',3,3,2,20,false)`, [id, "Sim Cup", now]);
const bots = ["Ann", "Ben", "Cat"].map((n, i) => ({ n, guestId: `guest_sim_${n}_${i}_abc`, key: `guest:guest_sim_${n}_${i}_abc` }));
for (const b of bots) await db.query(`INSERT INTO "TournamentEntry"(id,"tournamentId","playerKey",nickname) VALUES($1,$2,$3,$4)`, [id + b.n, id, b.key, b.n]);
console.log("tournament", id, "starts", now.toISOString());

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
for (const b of bots) {
  const s = io("http://localhost:4000", { transports: ["websocket"] });
  s.on("connect", () => s.emit("join_room", { levelId: 1, nickname: b.n, guestId: b.guestId }, (a) => log(b.n, "joined level:1", a.ok)));
  s.on("tournament_update", (t) => {
    log(b.n, "tournament_update", t.status, t.message, t.roomId ?? "");
    if (t.roomId) s.emit("join_room", { roomId: t.roomId, nickname: b.n, guestId: b.guestId }, (a) => log(b.n, "joined", t.roomId, a.ok, a.error ?? ""));
  });
  s.on("round_start", (r) => {
    // skill: Ann accurate, Ben medium, Cat random
    const skill = { Ann: 0.05, Ben: 0.3, Cat: 1.5 }[b.n];
    setTimeout(() => s.emit("submit_guess", { roundId: r.roundId, guessPct: 100 * Math.exp((Math.random() - 0.5) * 2 * skill), lock: true }, () => {}), 500 + Math.random() * 2000);
  });
  s.on("round_result", (r) => { if (b.n === "Ann") log("round", r.roundIndex + 1, "real", r.realPct, r.entries.map((e) => `${e.nickname}:${e.guessPct}→+${e.points}`).join(" ")); });
  s.on("session_end", (r) => log(b.n, "session_end", r.leaderboard.map((l) => `${l.nickname}=${l.totalPoints}`).join(" ")));
}
setInterval(async () => {
  const r = await db.query(`SELECT status,"winnerName" FROM "Tournament" WHERE id=$1`, [id]);
  if (["FINISHED", "CANCELLED"].includes(r.rows[0].status)) {
    const e = await db.query(`SELECT nickname,"qualifyingPoints",advanced,"finalPoints","finalRank" FROM "TournamentEntry" WHERE "tournamentId"=$1 ORDER BY "finalRank" NULLS LAST`, [id]);
    console.table(e.rows);
    log("TOURNAMENT", r.rows[0].status, "winner:", r.rows[0].winnerName);
    process.exit(0);
  }
}, 5000);
setTimeout(() => { log("TIMEOUT"); process.exit(1); }, 420000);
