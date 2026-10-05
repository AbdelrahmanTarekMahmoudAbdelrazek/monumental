/**
 * SMUGGLERS — write a story together, one sentence at a time, while sneaking in your secret word.
 *  • Every player gets a secret word (or two). Nobody else knows it.
 *  • The story starts from a random opener. Players take turns adding one sentence, for a few laps.
 *  • Then everyone guesses each other player's secret word from a list (real words + decoys).
 *  • Smuggled your word into one of YOUR sentences → +2. …and nobody guessed it → +3 more.
 *  • Every correct guess → +1.
 */

export interface SmuggleSettings {
  /** Times around the table. */
  laps: number;
  /** Seconds to write a sentence. */
  turnSec: number;
  /** Secret words per player. */
  wordsPer: 1 | 2;
}
export const DEFAULT_SMUGGLE_SETTINGS: SmuggleSettings = { laps: 3, turnSec: 45, wordsPer: 1 };
export const SMUGGLE_LIMITS = { laps: { min: 2, max: 5 }, turnSec: { min: 20, max: 120 }, players: { min: 3, max: 10 } } as const;
export const SMUGGLE_SENTENCE_MAX = 160;
export const SMUGGLE_GUESS_SEC = 75;

export function normaliseSmuggleSettings(s: Partial<SmuggleSettings> | undefined): SmuggleSettings {
  const c = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    laps: c(s?.laps, SMUGGLE_LIMITS.laps.min, SMUGGLE_LIMITS.laps.max, DEFAULT_SMUGGLE_SETTINGS.laps),
    turnSec: c(s?.turnSec, SMUGGLE_LIMITS.turnSec.min, SMUGGLE_LIMITS.turnSec.max, DEFAULT_SMUGGLE_SETTINGS.turnSec),
    wordsPer: s?.wordsPer === 2 ? 2 : 1,
  };
}

/** Secret words: concrete, a little odd, and hard to sneak in without looking suspicious. */
export const SMUGGLE_WORDS = Array.from(new Set(`GIRAFFE CHEESE ROCKET WEDDING PENGUIN BANANA VOLCANO PIRATE TOASTER
UMBRELLA DINOSAUR PIZZA ROBOT CACTUS SUBMARINE GHOST WIZARD MUSTACHE TRAMPOLINE PICKLE OCTOPUS LIGHTHOUSE
CHAINSAW SPAGHETTI KANGAROO TROPHY UNICORN HELICOPTER SAXOPHONE PYJAMAS BALLOON CROCODILE MERMAID ZOMBIE
TORNADO TELESCOPE CUPCAKE PARACHUTE VAMPIRE IGLOO WATERMELON BULLDOZER HAMSTER SKELETON CATAPULT DONUT
FLAMINGO SNOWMAN TREASURE CARROT TRACTOR MICROWAVE KARAOKE NINJA PANCAKE GORILLA LOLLIPOP PYRAMID
SPACESHIP TEAPOT JELLYFISH CASTLE SURFBOARD COWBOY SAUSAGE HEDGEHOG LASAGNA DISCO WALRUS SCARECROW
ACCORDION BURRITO MAGNET PINEAPPLE TUXEDO SLOTH PARROT GLITTER HARMONICA AVOCADO RACCOON CANNON SOMBRERO
BLENDER KAZOO MEATBALL PLATYPUS SUNFLOWER HOTDOG NOODLE SEAGULL LLAMA YACHT BAGPIPES MUFFIN CHANDELIER
SPATULA ALIEN PRETZEL TIARA WAFFLE BUMBLEBEE COCONUT DRAGON GOLDFISH JETPACK LOBSTER MARSHMALLOW
POPCORN RAINBOW SKATEBOARD STEGOSAURUS TURNIP VIOLIN WIG YETI ZEBRA`.split(/\s+/).filter(Boolean)));

export const SMUGGLE_OPENERS = [
  "The museum guard heard a noise at 3 AM…",
  "Nobody expected the school trip to end like this.",
  "The letter arrived fifty years too late.",
  "Grandma's will had one very strange condition.",
  "The elevator stopped between the 13th and 14th floor.",
  "On the first day of the job, the boss disappeared.",
  "The village had never seen snow in July.",
  "Captain Rosa looked at the map and frowned.",
  "The new neighbours moved in at midnight.",
  "It was supposed to be a quiet camping weekend.",
  "The detective found only one clue: a wet footprint.",
  "Everyone at the party froze when the lights went out.",
  "The robot woke up and asked for its mother.",
  "The bakery's secret recipe had been stolen.",
  "Two strangers sat down at the same train seat.",
  "The king announced a contest nobody wanted to win.",
  "The wedding was perfect until the cake started talking.",
  "A message appeared on every phone in the city.",
  "The submarine's radio crackled with an unknown voice.",
  "My cat came home wearing a tiny hat.",
  "The final exam had only one question.",
  "The haunted house was on sale for one dollar.",
  "At the bottom of the pool, someone had left a door.",
  "The astronauts realised they had forgotten something important.",
];

/** Did this text contain the word (as a whole word, allowing plurals / possessives)? */
export function containsWord(text: string, word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return false;
  const re = new RegExp(`(^|[^a-z])${w}(s|es|'s)?([^a-z]|$)`, "i");
  return re.test(text.toLowerCase());
}

export type SmugglePhase = "lobby" | "writing" | "guessing" | "reveal";

export interface SmugglePlayerPublic {
  id: string;
  nickname: string;
  connected: boolean;
  /** Playing this game (false = joined late, watching). */
  inGame: boolean;
  score: number;
  /** Guessing phase: has locked in guesses. */
  guessed: boolean;
}

export interface SmuggleLine {
  by: string | null; // null = the opener
  text: string;
  skipped?: boolean;
}

export interface SmuggleResult {
  playerId: string;
  words: string[];
  /** Per secret word: smuggled into one of their own sentences? */
  smuggled: boolean[];
  /** Who guessed this player's word correctly. */
  caughtBy: string[];
  points: number;
}

export interface SmugglePublicState {
  code: string;
  phase: SmugglePhase;
  hostId: string;
  settings: SmuggleSettings;
  players: SmugglePlayerPublic[];
  story: SmuggleLine[];
  order: string[];
  turnId: string | null;
  lap: number;
  turnEndsAt: number;
  serverNow: number;
  /** Guessing: the word options (all secret words in play + decoys), shuffled. */
  options: string[];
  results: SmuggleResult[] | null;
  /** Reveal: each player's guesses — guesser → target → word. */
  guesses: Record<string, Record<string, string>> | null;
  game: number;
  event?: { text: string; at: number };
}

export type SmuggleAction =
  | { type: "start" }
  | { type: "write"; text: string }
  | { type: "guess"; guesses: Record<string, string> }
  | { type: "settings"; settings: Partial<SmuggleSettings> }
  | { type: "to_lobby" };
