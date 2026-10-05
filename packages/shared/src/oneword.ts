/**
 * ONE WORD — a team word-association game.
 *  • Two teams (red, blue). Each has one Spymaster; everyone else guesses.
 *  • 25 word cards. The starting team owns 9, the other 8, 7 are neutral bystanders, 1 is the bomb.
 *  • Only Spymasters see which card belongs to whom.
 *  • On your turn your Spymaster gives ONE word + a number ("Ocean 3") linking as many of your cards as possible.
 *  • Your team taps cards: your colour → keep going (up to number + 1 guesses), neutral → turn over,
 *    the other team's card → it counts for them and your turn is over, the bomb → your team loses instantly.
 *  • First team to uncover all of its cards wins.
 */

export type OwTeam = "red" | "blue";
export type OwColor = OwTeam | "neutral" | "bomb";
export type OwRole = "spymaster" | "operative";

export const otherTeam = (t: OwTeam): OwTeam => (t === "red" ? "blue" : "red");

export interface OwSettings {
  /** Seconds per clue / per guessing phase. 0 = no timer. */
  timerSec: number;
  /** Word pack. */
  pack: "standard" | "easy" | "mixed";
}
export const DEFAULT_OW_SETTINGS: OwSettings = { timerSec: 0, pack: "standard" };
export const OW_TIMER_CHOICES = [0, 60, 90, 120, 180] as const;
export const OW_MAX_PLAYERS = 16;

export function normaliseOwSettings(s: Partial<OwSettings> | undefined): OwSettings {
  const t = Math.round(Number(s?.timerSec));
  const timerSec = Number.isFinite(t) ? Math.min(300, Math.max(0, t)) : DEFAULT_OW_SETTINGS.timerSec;
  const pack = s?.pack === "easy" || s?.pack === "mixed" ? s.pack : "standard";
  return { timerSec: timerSec > 0 && timerSec < 30 ? 30 : timerSec, pack };
}

/** Everyday, picturable nouns — kept short so cards stay readable on phones. */
const EASY = `APPLE BANANA BREAD CAKE CHEESE COOKIE EGG HONEY LEMON PIZZA SOUP SUGAR TEA COFFEE MILK
DOG CAT HORSE COW PIG SHEEP DUCK FROG LION TIGER BEAR WOLF FOX MOUSE SNAKE SHARK WHALE OWL BEE SPIDER
SUN MOON STAR CLOUD RAIN SNOW WIND STORM RIVER LAKE OCEAN BEACH ISLAND MOUNTAIN FOREST DESERT VOLCANO
HOUSE DOOR WINDOW ROOF WALL KITCHEN GARDEN BED CHAIR TABLE LAMP CLOCK MIRROR BOX KEY BELL CANDLE
CAR BUS TRAIN PLANE BOAT BIKE ROCKET TRUCK SHIP WHEEL ROAD BRIDGE TUNNEL MAP
BALL KITE DOLL GAME CARD DICE PUZZLE DRUM GUITAR PIANO SONG DANCE PARTY GIFT
HAT SHOE SOCK GLOVE SHIRT DRESS COAT RING CROWN GLASSES BAG UMBRELLA
DOCTOR NURSE TEACHER POLICE PILOT CHEF FARMER KING QUEEN PRINCE GHOST ROBOT ALIEN PIRATE WIZARD
BOOK PEN PAPER LETTER PHONE CAMERA COMPUTER SCREEN RADIO TV
TREE FLOWER LEAF ROSE GRASS SEED ROOT APPLE CORN CARROT POTATO TOMATO ONION PEPPER
GOLD SILVER IRON STONE GLASS FIRE ICE WATER SMOKE SAND`;

const STANDARD = `ANCHOR ANGEL ARMY ARROW ATLAS BAND BANK BAR BARK BAT BATTERY BEAM BEAT BELT BERRY BLADE BLOCK
BOARD BOLT BOND BOOT BOTTLE BOW BRAIN BRANCH BRASS BRICK BRUSH BUCKET BUG BUTTON CABLE CAMP CANAL
CANVAS CAPE CAPITAL CASTLE CELL CHAIN CHARGE CHECK CHEST CHIP CIRCLE CLIFF CLUB COACH CODE COIN COLD
COMET COMPASS CONCERT COPPER CORAL CORNER COTTON COURT CRANE CRASH CREAM CROSS CROW CRYSTAL CUBE CURRENT
CURTAIN CYCLE DART DATE DECK DIAMOND DINOSAUR DISK DRAFT DRAGON DREAM DRILL DROP DUST EAGLE ECHO EDGE
ENGINE EXPLORER FACE FAN FEATHER FENCE FIELD FIGURE FILE FILM FINE FISH FLAG FLASH FLUTE FLY FOG FORK
FORT FOUNTAIN FRAME FROST GAP GATE GEAR GENIUS GIANT GLOBE GRACE GRAPE GRID GROUND GUARD HAMMER HAND
HARBOR HAWK HEART HELMET HERO HOLE HOOK HORN HOSPITAL HOTEL ICON INK JACK JAM JET JEWEL JUNGLE KNIGHT
KNOT LAB LADDER LASER LATCH LAWN LEAD LIGHT LINE LINK LOCK LOG MAGNET MAIL MARBLE MARCH MASK MATCH
MAZE MEDAL MERCURY METAL MILL MINE MINT MODEL MOLE MOTOR MUSEUM NAIL NEEDLE NET NIGHT NOTE NOVEL NUT
OIL OLIVE ORANGE ORBIT ORGAN PALACE PALM PAN PANEL PARK PASS PATCH PATH PEARL PENGUIN PILOT PIPE PIT
PITCH PLANET PLATE PLOT POINT POLE POOL PORT POST POUND PRESS PRISM PUMP PUPIL PYRAMID QUARTER RACE
RACKET RADAR RAIL RANGE RAY RECORD REEF RING ROBIN ROCK ROLL ROUND RULER SAFE SAIL SALT SATURN SCALE
SCHOOL SCORE SCREW SEAL SECRET SHADOW SHELL SHIELD SHOT SIGNAL SINK SKATE SKULL SLIP SNOWMAN SOLDIER
SPACE SPARK SPELL SPHINX SPIKE SPINE SPOT SPRING SPY SQUARE STADIUM STAFF STAMP STATION STEAM STEEL
STICK STRAW STRING STRIKE SUIT SWING SWITCH SWORD TABLET TAIL TANK TAP TELESCOPE TEMPLE THREAD THRONE
TICK TIDE TIE TOOTH TORCH TOWER TRACK TRAP TRIANGLE TRIP TRUNK TUBE TURKEY TWIST UNICORN VAN VAULT
VELVET VET VOICE WAKE WATCH WAVE WEB WELL WHIP WHISTLE WING WITCH WORM YARD ZERO`;

const pack = (s: string) => Array.from(new Set(s.split(/\s+/).filter(Boolean)));
export const OW_WORDS = { easy: pack(EASY), standard: pack(STANDARD), mixed: pack(EASY + " " + STANDARD) } as const;

/** Shuffle a copy with the given rng. */
function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 25 words + the secret key: 9 for the starting team, 8 for the other, 7 neutral, 1 bomb. */
export function makeOwBoard(packName: OwSettings["pack"], startTeam: OwTeam, rnd: () => number) {
  const words = shuffle(OW_WORDS[packName], rnd).slice(0, 25);
  const key: OwColor[] = [
    ...Array<OwColor>(9).fill(startTeam),
    ...Array<OwColor>(8).fill(otherTeam(startTeam)),
    ...Array<OwColor>(7).fill("neutral"),
    "bomb",
  ];
  return { words, key: shuffle(key, rnd) };
}

/** Returns an error message, or null when the clue is allowed. */
export function checkClue(raw: string, boardWords: string[]): string | null {
  const w = raw.trim().toUpperCase();
  if (!w) return "Type a clue";
  if (/\s/.test(w)) return "One word only — no spaces";
  if (w.length > 24) return "That clue is too long";
  if (!/^[\p{L}\p{N}'-]+$/u.test(w)) return "Letters and numbers only";
  for (const b of boardWords) {
    if (w === b) return "You can't use a word that's on the board";
    if (w.length >= 3 && b.length >= 3 && (w.includes(b) || b.includes(w))) return `Too close to "${b}" on the board`;
  }
  return null;
}

export type OwPhase = "lobby" | "playing" | "finished";

export interface OwPlayerPublic {
  id: string;
  nickname: string;
  team: OwTeam | null;
  role: OwRole;
  connected: boolean;
}

export interface OwCardPublic {
  word: string;
  /** Known colour: set once revealed (and for every card when the game is over). */
  color: OwColor | null;
  revealed: boolean;
  /** Teammates currently pointing at this card (player ids). */
  marks: string[];
}

export interface OwClueLog {
  team: OwTeam;
  word: string;
  /** 0 = unlimited. */
  count: number;
  guesses: { word: string; color: OwColor }[];
}

export interface OwPublicState {
  code: string;
  phase: OwPhase;
  hostId: string;
  settings: OwSettings;
  players: OwPlayerPublic[];
  cards: OwCardPublic[];
  startTeam: OwTeam;
  turn: OwTeam;
  stage: "clue" | "guess";
  clue: { word: string; count: number } | null;
  /** Guesses still allowed this turn (99 = unlimited). */
  guessesLeft: number;
  remaining: Record<OwTeam, number>;
  log: OwClueLog[];
  /** 0 when there is no timer. */
  turnEndsAt: number;
  serverNow: number;
  winner: OwTeam | null;
  winReason: "cards" | "bomb" | null;
  /** Games won by each team at this table. */
  wins: Record<OwTeam, number>;
  game: number;
  /** Last notable event for toasts. */
  event?: { text: string; at: number; color?: OwColor };
}

export type OwAction =
  | { type: "join_team"; team: OwTeam; role: OwRole }
  | { type: "start" }
  | { type: "clue"; word: string; count: number }
  | { type: "mark"; index: number }
  | { type: "reveal"; index: number }
  | { type: "end_turn" }
  | { type: "settings"; settings: Partial<OwSettings> }
  | { type: "shuffle_teams" }
  | { type: "to_lobby" };
