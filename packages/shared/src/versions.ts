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
    v: 42, name: "Never Quiet", date: "2026-10",
    big: "The Copy holds a conversation: when you finish talking it answers in a friend's voice about half a second later — and it makes new sentences out of their words.",
    more: [
      "Conversation: it hears every time someone near it stops talking and answers most of the time, at human speed",
      "It hears questions without speech-to-text: when your voice rises at the end, it answers instead of chatting",
      "New sentences: your speech is also cut at the pauses into short phrases, and it stitches phrases into things you never said in that order",
      "Short pieces count now: names, \"yeah?\", \"here!\" (from 0.4 s)",
      "It never runs out: pieces come back after a minute and a quarter instead of being used up",
      "It talks 2–3× more often everywhere: calling from the dark, chatting while it walks with you, and on the radio",
      "Practice: it stays at your side longer (about 14 s) talking with you before it attacks, and comes back for you sooner",
    ],
  },
  {
    v: 41, name: "Smooth 60", date: "2026-10",
    big: "Echo Halls aims for a steady 60 fps: it only draws what you can see and adjusts its own quality to hold the frame rate.",
    more: [
      "The hospital is cut into blocks: rooms behind you and beyond the fog are no longer drawn (up to 10× fewer triangles per frame)",
      "Nothing past 34 m is drawn — the fog already hides it",
      "Hundreds of dead ceiling tubes merged into one draw",
      "Automatic quality: drops resolution, glow and film effects the moment fps sags; tries better quality only after holding 60 for 10 seconds",
      "Bodies on the floor no longer cost a shadow pass",
    ],
  },
  {
    v: 40, name: "It Learns", date: "2026-10",
    big: "The Copy now learns across matches: the more people play, the more real ways of moving it knows, the new moves it invents, and the tricks it keeps because they worked.",
    more: [
      "A long memory that survives between matches: real walking, looking-around and stopping moves from every match (movement only — no voice, no names)",
      "It invents new moves: mirrored, faster or slower, or two real moves stitched together; the ones that fool people are kept",
      "Moves it was using when it fooled someone are used more; moves it was using when it got caught fade",
      "It learns its tricks: how close to let you get before attacking, whether to steal fuses or keep hunting, how much to talk — what works gets chosen more",
      "The lobby shows how much it has learned, and you can switch off learning from your own movement",
    ],
  },
  {
    v: 39, name: "Motion Mirror", date: "2026-10",
    big: "The Copy learns to move from you: it replays the real walking, pausing and looking-around of the friend whose face it wears — and it steals fuses, even out of the box.",
    more: [
      "Motion Mirror: every player's own movement is studied during the match (speed, how they look around, when they stop) and the Copy moves with those habits",
      "In practice it copies YOUR way of moving",
      "It goes for loose fuses nobody is guarding, and pulls fuses back out of the fuse box when nobody is near it, then hides them",
      "Shoot it while it carries a fuse and it drops it right there",
      "It talks a lot more: calls out from the dark, chats while walking with you, answers when you speak, and the radio crackles twice as often",
    ],
  },
  {
    v: 38, name: "Feet on the Floor", date: "2026-10",
    big: "Everyone stands on the floor again: the Copy, your friends and the lobby preview were sunk to the waist — now full height.",
    more: [
      "Fixed: animations pushed every real character about a metre into the floor (only chest and face showed)",
      "The Copy creature is full size, feet on the ground, when it runs at you",
      "Practice: the Copy now attacks you even face to face after a few seconds at your side, and never gives up and wanders off",
      "Removed the woman's moaning sounds; the screams stay",
    ],
  },
  {
    v: 37, name: "Real Screams", date: "2026-10",
    big: "The hospital sounds real now: 52 recorded sounds — crying children, screams, moans, doors, whispers behind you and the creature's shriek.",
    more: [
      "Real children crying and laughing where there are no children",
      "Real screams far away, people moaning in pain, breathing right behind you",
      "Doors creaking and slamming, chains, glass, bodies falling",
      "The Copy shrieks and roars with a real creature's voice when it shows itself",
      "A real music box, radio static, a distant siren and a dead heart monitor",
      "Real room tone and wind under everything; the pistol racks when you pick it up",
    ],
  },
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
