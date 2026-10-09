// ───────── ECHO HALLS — co-op horror (Phase 1: walk, torch, proximity voice) ─────────

export const ECHO = {
  /** One map tile is 3 × 3 m; walls are 3 m tall. */
  TILE: 3,
  WALL_H: 3,
  MAX_PLAYERS: 4,
  /** Server → client snapshot interval. */
  SNAP_MS: 50,
  /** Client → server state interval. */
  SEND_MS: 50,
  /** Movement, metres per second. */
  WALK: 2.6,
  SPRINT: 4.6,
  CROUCH: 1.4,
  RADIUS: 0.35,
  EYE: 1.62,
  CROUCH_EYE: 1.05,
  /** Voices fade to silence at this distance (metres). */
  VOICE_RANGE: 15,
  /** Voices are full volume inside this distance. */
  VOICE_NEAR: 2,
} as const;

/**
 * The Phase 1 test ward.
 * `#` wall · `.` floor · `S` spawn · `D` doorway (floor with a lintel above)
 * `L` ceiling light · `B` broken, flickering light · `b` hospital bed (solid, waist high)
 */
export const ECHO_MAP: readonly string[] = [
  "########################",
  "#SS.....#......#.......#",
  "#.L.....D...B..#...L...#",
  "#.......#..b...D.......#",
  "####D####......#....b..#",
  "#.......####D###########",
  "#..B....#..............#",
  "#.......D.....L........#",
  "#.b.....#..............#",
  "######D##########D######",
  "#......#.......#.......#",
  "#..L...#...B...#...L...#",
  "#......D.......D.......#",
  "#..b...#.......#....b..#",
  "########################",
];

export const ECHO_W = ECHO_MAP[0].length;
export const ECHO_H = ECHO_MAP.length;

export function echoTile(tx: number, tz: number): string {
  if (tx < 0 || tz < 0 || tx >= ECHO_W || tz >= ECHO_H) return "#";
  return ECHO_MAP[tz].charAt(tx);
}

/** Blocks sound and sight (full-height walls only). */
export function echoWall(tx: number, tz: number): boolean {
  return echoTile(tx, tz) === "#";
}

/** World position (metres) → tile. */
export const echoTileOf = (v: number) => Math.floor(v / ECHO.TILE);

/** Can a player stand at world position (x, z)? (Walls only; beds are small props handled by client physics.) */
export function echoFree(x: number, z: number): boolean {
  return !echoWall(echoTileOf(x), echoTileOf(z));
}

/** Spawn points (tile centres, metres). */
export function echoSpawns(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  ECHO_MAP.forEach((row, tz) => [...row].forEach((c, tx) => { if (c === "S") out.push({ x: (tx + 0.5) * ECHO.TILE, z: (tz + 0.5) * ECHO.TILE }); }));
  return out;
}

/** How many separate walls a straight line crosses (used to muffle voices). */
export function echoWallsBetween(ax: number, az: number, bx: number, bz: number): number {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / 0.25));
  let walls = 0;
  let inside = false;
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const w = echoWall(echoTileOf(ax + (bx - ax) * f), echoTileOf(az + (bz - az) * f));
    if (w && !inside) walls++;
    inside = w;
  }
  return walls;
}

export const ECHO_COLORS = ["#E9C46A", "#7FB89A", "#8AB8FF", "#E0675C"] as const;

export interface EchoPlayer {
  id: string;
  /** Small number used on the wire. */
  n: number;
  name: string;
  color: string;
}

export interface EchoMeta {
  code: string;
  hostId: string;
  players: EchoPlayer[];
  serverNow: number;
}

/** What a client sends about itself (positions in metres, angles in radians). */
export interface EchoState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  torch: boolean;
  crouch: boolean;
  seq: number;
}

/** Snapshot on the wire: rows [n, x×100, y×100, z×100, yaw×1000, pitch×1000, flags (1 torch, 2 crouch)]. */
export interface EchoSnap {
  t: number;
  p: number[][];
}

export interface EchoPeerState {
  n: number;
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  torch: boolean;
  crouch: boolean;
}

export function decodeEchoSnap(s: EchoSnap): EchoPeerState[] {
  return s.p.map((r) => ({ n: r[0], t: s.t, x: r[1] / 100, y: r[2] / 100, z: r[3] / 100, yaw: r[4] / 1000, pitch: r[5] / 1000, torch: (r[6] & 1) === 1, crouch: (r[6] & 2) === 2 }));
}
