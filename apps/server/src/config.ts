export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
  socketJwtSecret: process.env.SOCKET_JWT_SECRET ?? "dev-secret-change-me",
  redisUrl: process.env.REDIS_URL || null,
  databaseUrl: process.env.DATABASE_URL || null,
  tournamentsEnabled: (process.env.TOURNAMENTS_ENABLED ?? "true") !== "false",
  hourlyTournamentLevel: Number(process.env.HOURLY_TOURNAMENT_LEVEL ?? 3),
  /** Rooms with no connected players are destroyed after this many ms. */
  idleRoomTtlMs: 2 * 60 * 1000,
  isTest: process.env.NODE_ENV === "test",
};
