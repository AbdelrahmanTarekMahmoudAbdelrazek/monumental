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
