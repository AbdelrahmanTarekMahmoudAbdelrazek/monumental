/** What changed in each update, newest first. Shown on the home pages so every update is easy to tell apart. */
export interface SiteVersion {
  v: number;
  name: string;
  /** The one big improvement, in a sentence. */
  big: string;
  more: string[];
  date: string;
}
export const SITE_VERSIONS: readonly SiteVersion[] = [
  {
    v: 36, name: "Practice Alone", date: "2026-10",
    big: "Practice alone: a Copy of you, with your face, your name and your own voice, hunts you — and your pistol never runs out.",
    more: [
      "\"Practice alone\" in the lobby when you're the only one in the room: the Copy wakes after 15 seconds",
      "It wears your face and name, moves like a player and talks back in your own recorded voice",
      "Start with the pistol, unlimited bullets; you're never gone for good",
      "Dust hangs in your torch beam, and the beam shows in the air",
      "Smarter Copy voice: it waits for you to finish talking, never talks while the real friend is talking nearby, and its voice comes from mouth height",
      "Smart Copy now listens on your device only — your voice is never sent to anyone's servers",
      "The Copy answers when someone calls the name it is wearing, picks its words better and avoids lines you just heard it say live",
      "Voices come round corners through doorways instead of through walls, with the echo of the room they're in",
      "Word tags fixed: \"where\" no longer counts as \"here\", \"same\" no longer counts as \"Sam\"",
      "Real recorded horror sounds (crying, screams, doors, the creature) play as soon as they're added",
      "Nora's headlamp is really brighter again; the game view no longer opens cut off at the bottom",
    ],
  },
  {
    v: 35, name: "Real Halls", date: "2026-10",
    big: "Echo Halls goes real: photo-scanned hospital, real people, a real pistol and recorded gunshots.",
    more: [
      "14 photo-scanned surfaces: peeling paint, cracked tiles, worn lino, rusted steel",
      "28 scanned props: hospital beds, desks, cabinets, extinguishers, lamps, crates and more",
      "Your teens are real people now: Maya, Theo, Sam and Nora walk, run and sneak with motion-captured animation",
      "The Copy is a real creature that screams, runs and attacks",
      "Dead officers and staff are real bodies lying where they fell",
      "A scanned service pistol with recoil, flying casings and recorded indoor gunshots and ricochets",
      "Film grain, bloom and a darker, more real picture on computers",
    ],
  },
  {
    v: 34, name: "Lower Floor", date: "2026-10",
    big: "Echo Halls is 2½× bigger: a whole lower floor, an east wing, lockers to hide in and one pistol with three bullets.",
    more: [
      "9 new rooms: chapel, cafeteria, playroom, police checkpoint, laundry, records, Ward C, kitchen, ambulance bay",
      "Two corridors and two stairwell links, so you can run in loops",
      "Hide in 17 lockers — the Copy only finds you if it saw you get in, hears you talk, or checks",
      "A dead officer's pistol: 3 bullets. Shoot the Copy and it runs — shoot a friend and they bleed",
      "Read 14 notes, radio logs and the officers' last text messages",
      "Blood, bodies of the lost police teams, and a much more disturbing soundtrack",
      "Smarter Copy: hears gunshots and running, searches lockers",
    ],
  },
  {
    v: 33, name: "Real Voices", date: "2026-10",
    big: "Voices sound like the real person now, and the Copy moves like a player instead of a robot.",
    more: ["Clean 24 kHz voice pieces", "Human turning, speeding up and slowing down", "One shared room echo for everyone"],
  },
  {
    v: 32, name: "The Copy", date: "2026-10",
    big: "The monster always wears a friend's face, follows you, crouches with you and searches for fuses like a player.",
    more: ["Two grabs and you're gone", "It steals fuses and hides them", "It rides the lift with you if nobody counts heads"],
  },
];
export const SITE_VERSION = SITE_VERSIONS[0];
