/**
 * Server-authoritative scoring.
 *
 * error  = |guess% − real%|
 * closest player → 3 pts, 2nd & 3rd closest → 1 pt, everyone else → 0.
 * Ties (equal error, to 1e-6) share the same rank and the same points.
 *
 * Players with no guess (null) get 0 points and no rank.
 */

export interface GuessInput {
  playerId: string;
  guessPct: number | null;
}

export interface ScoredGuess {
  playerId: string;
  guessPct: number | null;
  errorPct: number | null;
  rank: number | null;
  points: number;
}

export const POINTS_FOR_RANK: Record<number, number> = { 1: 3, 2: 1, 3: 1 };

export function realPercent(baseHeightM: number, targetHeightM: number): number {
  return (targetHeightM / baseHeightM) * 100;
}

export function roundTo(n: number, dp = 1): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

export function clampGuess(guess: unknown): number | null {
  if (typeof guess !== "number" || !Number.isFinite(guess)) return null;
  // Allow 0.1% .. 100000% (Moai vs Burj Khalifa is ~20700%).
  return Math.min(100000, Math.max(0.1, guess));
}

export function scoreRound(real: number, guesses: GuessInput[]): ScoredGuess[] {
  const EPS = 1e-6;
  const scored: ScoredGuess[] = guesses.map((g) => {
    const guess = clampGuess(g.guessPct);
    return {
      playerId: g.playerId,
      guessPct: guess,
      errorPct: guess == null ? null : Math.abs(guess - real),
      rank: null,
      points: 0,
    };
  });

  const ranked = scored
    .filter((s) => s.errorPct != null)
    .sort((a, b) => (a.errorPct as number) - (b.errorPct as number));

  // Competition ranking ("1224"): equal error → equal rank & points.
  let rank = 0;
  for (let i = 0; i < ranked.length; i++) {
    const cur = ranked[i];
    const prev = ranked[i - 1];
    if (i === 0 || Math.abs((cur.errorPct as number) - (prev.errorPct as number)) > EPS) {
      rank = i + 1;
    }
    cur.rank = rank;
    cur.points = POINTS_FOR_RANK[rank] ?? 0;
  }
  return scored;
}
