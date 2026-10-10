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
 * Marrowfield Cottage Hospital, ground floor. One character per 3 × 3 m cell; `#` is solid ground.
 * Walls stand on the edges between two different rooms, except where ECHO_DOORS opens them.
 * Rooms: c corridor · r reception · a ward A · b ward B · n nurses' station · o office · p pharmacy · s stairs
 * w washrooms · t operating theatre · m morgue · i isolation (room 7) · k store · x boiler room
 */
export const ECHO_W = 20;
export const ECHO_H = 14;
const PLAN: [string, number, number, number, number][] = [
  ["r", 1, 1, 5, 5], ["a", 6, 1, 8, 5], ["c", 9, 1, 10, 5], ["b", 11, 1, 14, 5], ["n", 15, 1, 16, 5], ["o", 17, 1, 18, 5],
  ["c", 1, 6, 18, 7],
  ["p", 1, 8, 3, 12], ["s", 4, 8, 5, 9], ["w", 4, 10, 5, 12], ["t", 6, 8, 8, 12], ["c", 9, 8, 10, 12],
  ["m", 11, 8, 14, 12], ["i", 15, 8, 16, 10], ["k", 15, 11, 16, 12], ["x", 17, 8, 18, 12],
];
export const ECHO_MAP: readonly string[] = (() => {
  const g = Array.from({ length: ECHO_H }, () => Array<string>(ECHO_W).fill("#"));
  for (const [k, x0, z0, x1, z1] of PLAN) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g[z][x] = k;
  return g.map((r) => r.join(""));
})();
export const ECHO_ROOMS: Record<string, { name: string; sub: string }> = {
  c: { name: "Main Corridor", sub: "" }, r: { name: "Reception", sub: "the front doors are buried" }, a: { name: "Ward A", sub: "eight beds, curtains drawn" },
  b: { name: "Ward B", sub: "children's ward" }, n: { name: "Nurses' Station", sub: "the phone is off the hook" }, o: { name: "Matron's Office", sub: "October 2011" },
  p: { name: "Pharmacy", sub: "behind the grille" }, s: { name: "Stairs & Lift", sub: "the way up is buried" }, w: { name: "Washrooms", sub: "" },
  t: { name: "Operating Theatre", sub: "the emergency light is still on" }, m: { name: "Morgue", sub: "cold, even now" }, i: { name: "Isolation Room", sub: "Room 7" },
  k: { name: "Store Room", sub: "" }, x: { name: "Boiler Room", sub: "something has been sleeping here" },
};
export type EchoDoorKind = "single" | "double" | "open" | "front";
/** [cell x, cell z, edge ("E" = east side of the cell, "S" = south side), kind] */
export const ECHO_DOORS: readonly [number, number, "E" | "S", EchoDoorKind][] = [
  [3, 5, "S", "double"], [7, 5, "S", "single"], [12, 5, "S", "double"], [15, 5, "S", "open"], [16, 5, "S", "open"], [17, 5, "S", "single"],
  [2, 7, "S", "single"], [4, 7, "S", "single"], [4, 9, "S", "single"], [7, 7, "S", "double"], [8, 10, "E", "single"], [10, 10, "E", "double"],
  [15, 7, "S", "single"], [14, 11, "E", "single"], [17, 7, "S", "single"], [5, 3, "E", "single"], [2, 0, "S", "front"],
];
/** Width of each kind of opening, metres. */
export const ECHO_DOOR_W: Record<EchoDoorKind, number> = { single: 1.2, double: 2.2, front: 2.4, open: 2.9 };
const DOOR_SET = new Map(ECHO_DOORS.map((d) => [`${d[0]},${d[1]},${d[2]}`, d[3]]));
export function echoDoor(x: number, z: number, side: "E" | "S"): EchoDoorKind | undefined { return DOOR_SET.get(`${x},${z},${side}`); }
const SPAWN_CELLS: [number, number][] = [[2, 4], [3, 4], [2, 3], [3, 3]];

export function echoTile(tx: number, tz: number): string {
  if (tx < 0 || tz < 0 || tx >= ECHO_W || tz >= ECHO_H) return "#";
  return ECHO_MAP[tz].charAt(tx);
}

/** Solid ground (no room here). */
export function echoWall(tx: number, tz: number): boolean {
  return echoTile(tx, tz) === "#";
}

/** World position (metres) → tile. */
export const echoTileOf = (v: number) => Math.floor(v / ECHO.TILE);

/** Can a player stand at world position (x, z)? (Inside a room; walls and furniture are handled by client physics.) */
export function echoFree(x: number, z: number): boolean {
  return !echoWall(echoTileOf(x), echoTileOf(z));
}

/** The door on the edge between two neighbouring cells, if any. */
function edgeDoor(ax: number, az: number, bx: number, bz: number): EchoDoorKind | undefined {
  if (bx === ax + 1 && bz === az) return echoDoor(ax, az, "E");
  if (bx === ax - 1 && bz === az) return echoDoor(bx, bz, "E");
  if (bz === az + 1 && bx === ax) return echoDoor(ax, az, "S");
  if (bz === az - 1 && bx === ax) return echoDoor(bx, bz, "S");
  return undefined;
}
/** Can you walk from a cell to its neighbour (same room, or a door between)? */
export function echoEdgeOpen(ax: number, az: number, bx: number, bz: number): boolean {
  const a = echoTile(ax, az), b = echoTile(bx, bz);
  if (a === "#" || b === "#") return false;
  return a === b || edgeDoor(ax, az, bx, bz) !== undefined;
}
/** Crossing from one cell to a neighbour at world point (x, z) on their shared edge: open if same room or through the door's gap. */
function crossOpen(px: number, pz: number, tx: number, tz: number, x: number, z: number, exact: boolean): boolean {
  if (Math.abs(tx - px) + Math.abs(tz - pz) !== 1) {
    // diagonal: either way round the corner
    return (crossOpen(px, pz, tx, pz, x, z, exact) && crossOpen(tx, pz, tx, tz, x, z, exact)) || (crossOpen(px, pz, px, tz, x, z, exact) && crossOpen(px, tz, tx, tz, x, z, exact));
  }
  const a = echoTile(px, pz), b = echoTile(tx, tz);
  if (a === "#" || b === "#") return false;
  if (a === b) return true;
  const kind = edgeDoor(px, pz, tx, tz);
  if (!kind) return false;
  if (!exact) return true;
  const along = tx !== px ? z - (pz + 0.5) * ECHO.TILE : x - (px + 0.5) * ECHO.TILE;
  return Math.abs(along) <= ECHO_DOOR_W[kind] / 2 + 0.1;
}

/** Spawn points (metres), in reception. */
export function echoSpawns(): { x: number; z: number }[] {
  return SPAWN_CELLS.map(([tx, tz]) => ({ x: (tx + 0.5) * ECHO.TILE, z: (tz + 0.5) * ECHO.TILE }));
}

/** How many walls a straight line crosses (used to muffle voices and to decide who can see whom). Doors only count as open where the gap is. */
export function echoWallsBetween(ax: number, az: number, bx: number, bz: number): number {
  return crossings(ax, az, bx, bz, true);
}
/** Could someone move in a straight line from a to b without passing through a wall? (Lenient at doors, for the server's sanity check.) */
export function echoPassable(ax: number, az: number, bx: number, bz: number): boolean {
  return crossings(ax, az, bx, bz, false) === 0;
}
function crossings(ax: number, az: number, bx: number, bz: number, exact: boolean): number {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  let walls = 0;
  let px = echoTileOf(ax), pz = echoTileOf(az);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    const tx = echoTileOf(x), tz = echoTileOf(z);
    if (tx === px && tz === pz) continue;
    const g = (i - 0.5) / steps; // the crossing happened between the two samples
    if (!crossOpen(px, pz, tx, tz, ax + (bx - ax) * g, az + (bz - az) * g, exact)) walls++;
    px = tx; pz = tz;
  }
  return walls;
}

export const ECHO_COLORS = ["#E9C46A", "#7FB89A", "#8AB8FF", "#E0675C"] as const;

// ───────── The crew: four teens, each with a starting kit; outfits are free ─────────

export type EchoTeenId = "maya" | "theo" | "sam" | "nora";
export const ECHO_TEENS: readonly { id: EchoTeenId; name: string; role: string; perk: string; item: EchoItem }[] = [
  { id: "maya", name: "Maya", role: "The Navigator", perk: "Her phone points to the nearest fuse, the fuse box, then the lift", item: "phone" },
  { id: "theo", name: "Theo", role: "The Radio", perk: "His walkie spots fake calls on Channel 4", item: "walkie" },
  { id: "sam", name: "Sam", role: "The Breaker", perk: "Cuts himself free once per match when a monster grabs him", item: "cutters" },
  { id: "nora", name: "Nora", role: "The Scout", perk: "Her headlamp reaches further and drives monsters off twice as fast", item: "torch" },
];
export const LOOK_OPTS = {
  hair: ["short", "curly", "curlylong", "pony", "bob", "buzz"],
  hat: ["none", "beanie", "cap", "capback", "hood", "headlamp", "bucket"],
  coat: ["hoodie", "rain", "puffer", "denim", "varsity", "flannel"],
  pants: ["jeans", "cargo", "joggers"],
  shoes: ["sneakers", "boots"],
  pack: ["none", "school", "hiking", "sling"],
  item: ["torch", "walkie", "phone", "cutters", "crowbar", "map"],
  build: ["slim", "mid", "broad"],
} as const;
/** How many swatches each colour slot has (the colours themselves live in the client). */
export const LOOK_COLORS = { skin: 6, hairC: 6, coatC: 8, coatC2: 8, pantsC: 4 } as const;
export type EchoItem = (typeof LOOK_OPTS.item)[number];
export interface EchoLook {
  teen: EchoTeenId;
  skin: number;
  build: (typeof LOOK_OPTS.build)[number];
  hair: (typeof LOOK_OPTS.hair)[number];
  hairC: number;
  hat: (typeof LOOK_OPTS.hat)[number];
  coat: (typeof LOOK_OPTS.coat)[number];
  coatC: number;
  coatC2: number;
  pants: (typeof LOOK_OPTS.pants)[number];
  pantsC: number;
  shoes: (typeof LOOK_OPTS.shoes)[number];
  pack: (typeof LOOK_OPTS.pack)[number];
  /** Set by the teen (their kit), not chosen. */
  item: EchoItem;
  scarf: boolean;
  glasses: boolean;
  gloves: boolean;
}
export const TEEN_LOOKS: Record<EchoTeenId, EchoLook> = {
  maya: { teen: "maya", skin: 3, build: "slim", hair: "curlylong", hairC: 0, hat: "none", coat: "rain", coatC: 0, coatC2: 7, pants: "jeans", pantsC: 0, shoes: "sneakers", pack: "school", item: "phone", scarf: true, glasses: false, gloves: false },
  theo: { teen: "theo", skin: 1, build: "mid", hair: "curly", hairC: 2, hat: "none", coat: "varsity", coatC: 1, coatC2: 7, pants: "cargo", pantsC: 2, shoes: "sneakers", pack: "hiking", item: "walkie", scarf: false, glasses: false, gloves: false },
  sam: { teen: "sam", skin: 2, build: "broad", hair: "buzz", hairC: 0, hat: "hood", coat: "hoodie", coatC: 4, coatC2: 4, pants: "joggers", pantsC: 1, shoes: "boots", pack: "none", item: "cutters", scarf: false, glasses: false, gloves: true },
  nora: { teen: "nora", skin: 0, build: "slim", hair: "pony", hairC: 3, hat: "headlamp", coat: "puffer", coatC: 2, coatC2: 7, pants: "cargo", pantsC: 3, shoes: "boots", pack: "sling", item: "torch", scarf: false, glasses: true, gloves: false },
};
/** What each teen's kit does in the game. */
export const PERK = {
  /** Nora: torch reach (m) on top of EXPOSE_RANGE, and how much faster she exposes. */
  NORA_RANGE: 4,
  NORA_EXPOSE: 2,
  /** Sam: after cutting free, the monster that grabbed him backs off this long (s). */
  SAM_STUN_SEC: 6,
} as const;

export const isTeen = (v: unknown): v is EchoTeenId => ECHO_TEENS.some((t) => t.id === v);

/** Validate a look from the network or storage. Unknown fields fall back to the teen's default; the item always comes from the teen. */
export function cleanLook(raw: unknown): EchoLook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isTeen(r.teen)) return null;
  const base = TEEN_LOOKS[r.teen];
  const out: EchoLook = { ...base };
  const pick = <K extends keyof typeof LOOK_OPTS>(k: K) => ((LOOK_OPTS[k] as readonly string[]).includes(r[k] as string) ? r[k] : base[k as keyof EchoLook]) as never;
  out.hair = pick("hair"); out.hat = pick("hat"); out.coat = pick("coat"); out.pants = pick("pants"); out.shoes = pick("shoes"); out.pack = pick("pack"); out.build = pick("build");
  for (const k of Object.keys(LOOK_COLORS) as (keyof typeof LOOK_COLORS)[]) {
    const v = r[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < LOOK_COLORS[k]) out[k] = v;
  }
  for (const k of ["scarf", "glasses", "gloves"] as const) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  out.item = ECHO_TEENS.find((t) => t.id === out.teen)!.item;
  return out;
}

export interface EchoPlayer {
  id: string;
  /** Small number used on the wire. */
  n: number;
  name: string;
  color: string;
  /** Which teen they play and what they wear. */
  look?: EchoLook;
}

// ───────── The goal: get the lift working ─────────

export const GOAL = {
  FUSES: 3,
  /** A match lasts this long before the lights go out for good. */
  MATCH_SEC: 20 * 60,
  /** How close you must be to pick up a fuse or use the fuse box (metres). */
  REACH: 1.9,
  /** The fuse box in the boiler room, and the lift in the stairwell. */
  BOX: { x: 56.4, z: 31.5 },
  LIFT: { x: 13.6, z: 27.75 },
  LIFT_R: 2.2,
  /** Everyone alive must stand at the lift this long once the power is on. */
  LIFT_HOLD: 4,
  /** Where a fuse can be hidden: [x, y, z] — on a morgue drawer, the theatre trolley, a desk, a bed... */
  SPOTS: [
    [43.9, 1.31, 29.7], [23.9, 1.0, 30.9], [7.5, 0.05, 33.0], [54.3, 0.81, 9.0], [38.4, 0.8, 13.6], [48.6, 0.8, 28.5],
    [17.2, 0.94, 30.9], [48.0, 0.05, 36.0], [48.6, 0.81, 7.4], [22.5, 0.05, 6.5], [30.6, 0.05, 37.0], [3.6, 1.07, 29.5],
  ] as [number, number, number][],
} as const;
export interface EchoFuse { id: number; x: number; y: number; z: number; by: number | null; placed: boolean }
export interface EchoGoal {
  fuses: EchoFuse[];
  placed: number;
  power: boolean;
  /** 0 until the first player goes in. */
  startedAt: number;
  endsAt: number;
  /** Wire numbers of living players standing at the lift. */
  inLift: number[];
  need: number;
  result: null | "win" | "lose";
  endedAt: number;
}
export type EchoAct = { type: "enter" } | { type: "pickup"; fuse: number } | { type: "install" } | { type: "restart" };

export interface EchoMeta {
  code: string;
  hostId: string;
  players: EchoPlayer[];
  serverNow: number;
  goal?: EchoGoal;
  /** Phase 2: are the mimics awake, and how the night is going. */
  night?: { awake: boolean; wakeAt: number; exposed: number; taken: number };
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
  /** Speaking right now (blinks their radio light). */
  talk?: boolean;
  /** Holding the walkie's talk button: everyone hears me on Channel 4. */
  radio?: boolean;
  seq: number;
}

/** Snapshot on the wire: rows [n, x×100, y×100, z×100, yaw×1000, pitch×1000, flags (1 torch, 2 crouch, 4 taken, 8 talking, 16 on the radio)]. */
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
  talk: boolean;
  radio: boolean;
}

export const ECHO_TALK = 8;
export const ECHO_RADIO = 16;
/** The mimic speaks on Channel 4 now and then, with a stolen voice. */
export const RADIO = { FIRST_SEC: 45, GAP_MIN: 50, GAP_MAX: 110 } as const;

export function decodeEchoSnap(s: EchoSnap): EchoPeerState[] {
  return s.p.map((r) => ({ n: r[0], t: s.t, x: r[1] / 100, y: r[2] / 100, z: r[3] / 100, yaw: r[4] / 1000, pitch: r[5] / 1000, torch: (r[6] & 1) === 1, crouch: (r[6] & 2) === 2, talk: (r[6] & 8) === 8, radio: (r[6] & 16) === 16 }));
}

// ───────── Phase 2: the mimic ─────────

export const MIMIC = {
  /** Seconds after a second player arrives before mimics wake. */
  WAKE_SEC: 75,
  /** Voice pieces the room must hold before a mimic starts calling. */
  MIN_CLIPS: 3,
  WANDER: 1.3,
  STALK: 1.9,
  CHASE: 3.9,
  FLEE: 5.5,
  /** A mimic grabs you inside this distance (metres). */
  CATCH: 1.1,
  /** Coming this close to a mimic that lured you starts the chase. */
  NOTICE: 3,
  /** Hold your torch on it this long (seconds) to expose it. */
  EXPOSE_SEC: 1.5,
  EXPOSE_RANGE: 12,
  /** Half-width of the torch beam used for exposing (radians). */
  BEAM: 0.42,
  /** It answers this long after you speak (the "late answer" tell), seconds. */
  REPLY_MIN: 1,
  REPLY_MAX: 1.5,
  /** Time hiding after being exposed, seconds. */
  FLEE_SEC: 90,
  /** Seconds between two calls from the same mimic. */
  LURE_GAP_MIN: 12,
  LURE_GAP_MAX: 24,
  /** A taken player comes back after this long (Phase 2 only). */
  TAKEN_SEC: 8,
  /** Longest voice piece kept (seconds) and the sample rate pieces travel at. */
  PIECE_MAX: 3,
  RATE: 16000,
} as const;

export type MimicState = "dormant" | "wander" | "stalk" | "lure" | "chase" | "flee";
export const MIMIC_STATES: MimicState[] = ["dormant", "wander", "stalk", "lure", "chase", "flee"];

/** What a voice piece is about. Text tags need the optional speech-to-text; the others come from the sound itself. */
export type ClipTag = "short" | "long" | "loud" | "call" | "here" | "found" | "panic" | "question" | "laugh" | `name:${number}`;

/** A voice piece as the server knows it: labels only, never audio. */
export interface ClipInfo {
  /** "<owner n>:<piece id>" */
  key: string;
  owner: number;
  ms: number;
  tags: ClipTag[];
}

/** Snapshot mimic rows: [id, x×100, z×100, yaw×1000, state index, speaking (0/1)]. */
export interface EchoSnap2 extends EchoSnap {
  m?: number[][];
}

export type EchoEvent =
  | { type: "say"; mimic: number; clips: string[] }
  | { type: "exposed"; mimic: number; by: number }
  | { type: "taken"; n: number; mimic: number; lure: string | null }
  /** Sam cut himself free (his one escape this match). */
  | { type: "free"; n: number; mimic: number }
  | { type: "back"; n: number; x: number; z: number }
  | { type: "wake" }
  | { type: "pickup"; n: number; fuse: number }
  | { type: "drop"; n: number; fuse: number }
  | { type: "install"; n: number; fuse: number }
  | { type: "power" }
  /** A voice on Channel 4 that nobody pressed the button for. `as` is whose voice it is. */
  | { type: "radio"; clips: string[]; as: number }
  | { type: "end"; result: "win" | "lose" }
  | { type: "restart"; spawns: [number, number, number][] };

/** Player flags in snapshot rows (bit 4 = taken). */
export const ECHO_TAKEN = 4;

/** Words that label a voice piece when speech-to-text is on (English + Arabic dialects). */
export const CLIP_WORDS: Record<"call" | "here" | "found" | "panic" | "question", string[]> = {
  call: ["come", "over here", "this way", "follow", "quick", "hurry", "تعال", "تعالي", "تعالو", "تعالوا", "بسرعة", "يلا"],
  here: ["i'm here", "im here", "i am here", "here", "انا هنا", "أنا هنا", "هنا", "جنبك"],
  found: ["found", "key", "fuse", "got it", "لقيت", "لقيته", "المفتاح", "معايا", "معي"],
  panic: ["run", "help", "go go", "اجري", "الحق", "ساعدني", "ساعدوني", "يا لهوي", "اهرب"],
  question: ["where", "who", "what", "are you", "فين", "وين", "مين", "ايه", "إيه", "شو", "انت فين", "إنت فين"],
};

/** Labels a transcript. `names` maps player number → lowercase name. */
export function tagText(text: string, names: Record<number, string>): ClipTag[] {
  const t = ` ${text.toLowerCase()} `;
  const tags: ClipTag[] = [];
  for (const [tag, words] of Object.entries(CLIP_WORDS) as [keyof typeof CLIP_WORDS, string[]][]) {
    if (words.some((w) => t.includes(w))) tags.push(tag);
  }
  for (const [n, name] of Object.entries(names)) if (name.length >= 2 && t.includes(name.toLowerCase())) tags.push(`name:${Number(n)}`);
  return tags;
}

/** Cells a mimic may stand in. */
export function mimicOpen(tx: number, tz: number): boolean {
  return echoTile(tx, tz) !== "#";
}

/** Shortest walk between two tiles (4-way), as tile coordinates excluding the start. Empty if unreachable. */
export function echoPath(from: [number, number], to: [number, number]): [number, number][] {
  const key = (x: number, z: number) => z * ECHO_W + x;
  if (!mimicOpen(to[0], to[1])) return [];
  const prev = new Map<number, number>();
  const start = key(from[0], from[1]);
  const goal = key(to[0], to[1]);
  prev.set(start, -1);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const k = q[i];
    if (k === goal) break;
    const x = k % ECHO_W, z = Math.floor(k / ECHO_W);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      const nk = key(nx, nz);
      if (prev.has(nk) || !echoEdgeOpen(x, z, nx, nz)) continue;
      prev.set(nk, k);
      q.push(nk);
    }
  }
  if (!prev.has(goal)) return [];
  const out: [number, number][] = [];
  for (let k = goal; k !== start; k = prev.get(k)!) out.push([k % ECHO_W, Math.floor(k / ECHO_W)]);
  return out.reverse();
}

// ── μ-law: voice pieces travel as 8-bit samples at 16 kHz (16 KB per second) ──
export function muEncode(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let s = Math.max(-1, Math.min(1, pcm[i])) * 32635;
    const sign = s < 0 ? 0x80 : 0;
    if (s < 0) s = -s;
    s += 0x84;
    let exp = 7;
    for (let m = 0x4000; (s & m) === 0 && exp > 0; m >>= 1) exp--;
    const man = (s >> (exp + 3)) & 0x0f;
    out[i] = ~(sign | (exp << 4) | man) & 0xff;
  }
  return out;
}

export function muDecode(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const u = ~bytes[i] & 0xff;
    const sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
    let s = ((man << 3) + 0x84) << exp;
    s -= 0x84;
    out[i] = (sign ? -s : s) / 32635;
  }
  return out;
}
