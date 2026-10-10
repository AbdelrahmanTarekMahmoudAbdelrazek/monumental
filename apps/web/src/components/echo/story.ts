/**
 * What the lost left behind: notes, radio logs and the officers' phones, placed around Marrowfield.
 * The hospital builds a prop at each spot; the engine lets you read one when you stand close and look at it.
 */
export type NoteKind = "paper" | "clipboard" | "phone" | "radio" | "drawing" | "taped";
export interface PhoneMsg { me: boolean; who?: string; text: string; time: string }
export interface StoryNote {
  id: number;
  kind: NoteKind;
  /** Where the prop is (metres); `ry` turns it; wall notes face the way `ry` points (0 = toward +z). */
  x: number; y: number; z: number; ry: number;
  title: string;
  /** Who wrote it / whose phone. */
  from: string;
  body?: string;
  msgs?: PhoneMsg[];
}

export const NOTES: StoryNote[] = [
  {
    id: 0, kind: "paper", x: 10.2, y: 0.8, z: 7.2, ry: 0.3, title: "Visitors' book", from: "Reception · 13 October 2011",
    body: "21:10  Mrs D. Halloran — to see Ward B (son)\n21:22  Fr. A. Lusk — Chapel\n21:31  ???? — signed as \"E. Marr\"\n21:40  ???? — signed as \"E. Marr\"\n21:44  ???? — signed as \"E. Marr\"\n\nNobody saw anyone come through the doors. The pen was still warm.",
  },
  {
    id: 1, kind: "paper", x: 47.4, y: 0.8, z: 7.8, ry: -0.4, title: "Night handover", from: "Nurse K. Abbott",
    body: "Room 7 asking for water again. Says the walls are \"learning his name\".\nBed 3, Ward B crying since 8. When I went in she was asleep. The crying kept going.\nDr Pell called twice from theatre. Theatre was locked and empty both times.\n\nIf I call you on the ward phone, ask me something only I would know.",
  },
  {
    id: 2, kind: "paper", x: 53.5, y: 0.8, z: 9.3, ry: 0.1, title: "Letter, unsent", from: "Matron J. Whitlock",
    body: "To the Trust board,\nI have now counted my night staff four times and got four different numbers. Three of my nurses insist they spoke to me in the corridor at 9 o'clock. I was in this office with the door locked.\nThe boiler engineer says the crack under the boiler room is \"breathing\". I am asking, again, for the building to be closed.",
  },
  {
    id: 3, kind: "radio", x: 77.4, y: 0.82, z: 34.4, ry: 0.6, title: "Radio log, Team Two", from: "Police checkpoint · 15 October 2011",
    body: "02:14  TEAM ONE: Checkpoint, this is Daniels. Found kids' ward. Empty. Coming back to you.\n02:19  TEAM ONE: Checkpoint, Daniels. Coming back to you.\n02:19  TEAM ONE: Coming back to you.\n02:20  CHECKPOINT: Daniels, you've sent that three times.\n02:31  [Daniels arrives at the checkpoint. Says nothing. Smiles.]\n02:33  TEAM ONE: Checkpoint, this is Daniels. I'm still in the kids' ward. Who did you just let in?\n02:34  [gunfire]\n—",
  },
  {
    id: 4, kind: "phone", x: 73.8, y: 0.03, z: 32.3, ry: 0.9, title: "PC R. Daniels' phone", from: "11% battery",
    msgs: [
      { me: false, who: "Jess ♥", text: "Are you still at that hospital? It's on the news", time: "23:52" },
      { me: true, text: "yeah. sinkhole. we're going down to look for survivors. don't wait up", time: "23:58" },
      { me: false, who: "Jess ♥", text: "Rob it's 3am. you just rang me from downstairs?? you were in the kitchen talking to Mia", time: "03:02" },
      { me: true, text: "I haven't left the checkpoint", time: "03:04" },
      { me: false, who: "Jess ♥", text: "you told her a story. you sounded exactly like you. then you went out the back", time: "03:04" },
      { me: true, text: "lock the door. don't open it if I knock. I mean it", time: "03:05" },
      { me: true, text: "if I call, ask me what we named the dog", time: "03:05" },
      { me: false, who: "Jess ♥", text: "Biscuit. why would I ask you that", time: "03:41" },
      { me: false, who: "Jess ♥", text: "Rob please answer. you rang. you said \"Biscuit\" before I asked", time: "03:42" },
    ],
  },
  {
    id: 5, kind: "phone", x: 84.4, y: 0.03, z: 43.2, ry: -0.5, title: "Sgt T. Okafor's phone", from: "Team Two · 3% battery",
    msgs: [
      { me: false, who: "Control", text: "Team Two report numbers", time: "02:40" },
      { me: true, text: "5 went in. 6 came back to the checkpoint", time: "02:41" },
      { me: false, who: "Control", text: "Say again", time: "02:41" },
      { me: true, text: "6. one of us is wrong. we can't tell which. they all know the birthday codes", time: "02:43" },
      { me: true, text: "we've started using torches on each other. held it on Pryce for ages. his face moved", time: "02:51" },
      { me: true, text: "pryce ran. we fired. it went in the walls", time: "02:52" },
      { me: true, text: "there are kids crying in the playroom. there are no kids in the playroom. don't send anyone else", time: "03:10" },
    ],
  },
  {
    id: 6, kind: "phone", x: 81.6, y: 0.03, z: 59.4, ry: 1.7, title: "PC L. Varga's phone", from: "Team Three · last message unsent",
    msgs: [
      { me: false, who: "Mum", text: "Lena call me when you finish, love you", time: "19:20" },
      { me: true, text: "on a job mum. love you too", time: "19:31" },
      { me: false, who: "Mum", text: "Lovely to hear your voice just now! Glad you're home safe x", time: "04:12" },
      { me: true, text: "mum I'm not home. I didn't call. who did you talk to", time: "04:15" },
      { me: true, text: "[not sent] if I come home don't let me in until you check my eyes in the light. it can't hold a face in the light", time: "04:19" },
    ],
  },
  {
    id: 7, kind: "drawing", x: 64.0, y: 1.25, z: 24.13, ry: 0, title: "A drawing on the playroom wall", from: "crayon, new",
    body: "Two mummies holding hands. One of them has no face.\n\nUnderneath, in big letters:\nMUMMY CAME TWICE\nTHE SECOND ONE KNEW MY NAME\nBUT SHE SANG IT WRONG",
  },
  {
    id: 8, kind: "paper", x: 61.2, y: 0.5, z: 11.0, ry: 0.2, title: "Chaplain's notebook", from: "Fr. A. Lusk",
    body: "Sat with the boy in Room 7 (Mr Marr, 19). He does impressions — the nurses, the porters, me. Uncanny.\nHe says he didn't learn them. He says something under the hospital listens through him and \"practises\".\nTonight I heard my own voice saying grace in the chapel. I was in the corridor. It had the words right. It had the tune wrong.",
  },
  {
    id: 9, kind: "paper", x: 27.3, y: 0.8, z: 52.2, ry: -0.2, title: "Patient file: MARR, Elliot", from: "Records · Room 7",
    body: "Admitted 2 Oct 2011. Auditory hallucinations: \"voices that are copies\". Mimicry of staff voices, word-perfect.\nNote 9 Oct: patient found standing in boiler room, ear to the floor crack. Says it is \"hungry for faces now, not just voices\".\nNote 13 Oct, 21:46: patient asked to be moved \"before it finishes me\".\nNote 13 Oct, 21:47: —",
  },
  {
    id: 10, kind: "clipboard", x: 46.5, y: 1.45, z: 66 - 0.12, ry: Math.PI, title: "Ward C observations", from: "Night staff",
    body: "Bed 1  BP fine. Says her daughter visited. Daughter lives in Canada.\nBed 2  Asleep.\nBed 3  Asleep.\nBed 4  Asleep. Is now in Bed 2 as well.\nBed 5  Patient screaming that the nurse who just did obs \"wasn't you\". I haven't done Bed 5 yet.\n\nDo NOT hand over to anyone you didn't see come in through the door.",
  },
  {
    id: 11, kind: "taped", x: 64.0, y: 1.5, z: 66 - 0.12, ry: Math.PI, title: "Taped to the cold room door", from: "kitchen staff",
    body: "WE ARE IN THE COLD ROOM\n4 of us. Sue, Raj, Pat, Mo.\nIF YOU KNOCK AND WE ANSWER, WALK AWAY.\nWe agreed: nobody speaks. If you hear us talk, it isn't us.\n\nIt's been talking for an hour.",
  },
  {
    id: 12, kind: "paper", x: 10.5, y: 0.02, z: 58.0, ry: 1.1, title: "Staff memo", from: "Estates",
    body: "Reminder: staff lockers on this floor do NOT lock from inside.\nIf you are hiding in one (as several of you were last night), keep quiet and keep still. It walks the corridors and listens. It opens doors it's seen close.\nAnd it is not your colleague asking if you're in there.",
  },
  {
    id: 13, kind: "paper", x: 39.3, y: 0.96, z: 32.3, ry: 0.5, title: "Coroner's tally", from: "Morgue",
    body: "Bodies recovered from Team One: 4.\nTeam One went in with 5.\nTeam One came back to the checkpoint with 5.\n\nSo who walked back out?",
  },
  {
    id: 14, kind: "paper", x: 47.0, y: 0.02, z: 31.4, ry: 2.2, title: "Room 7, written on the floor", from: "E. Marr",
    body: "IT CAN'T HOLD A FACE IN THE LIGHT.\nIT ANSWERS LATE.\nIT DOESN'T KNOW WHAT IT HASN'T HEARD.\nCOUNT YOUR FRIENDS. THEN COUNT AGAIN.\n\nIf you find this: don't hide where it watched you hide.",
  },
];

/** Blood words on the walls: [text, x, y, z, ry, width]. */
export const WALL_WORDS: [string, number, number, number, number, number][] = [
  ["IT WEARS US", 34.5, 1.7, 24 - 0.11, Math.PI, 2.6],
  ["COUNT YOUR FRIENDS", 58.0, 1.6, 39 + 0.11, 0, 3.2],
  ["DON'T FOLLOW THE CRYING", 66.0, 1.8, 39 + 0.11, 0, 3.4],
  ["5 IN  6 OUT", 77.5, 1.9, 39 - 0.11, Math.PI, 2.2],
  ["MUMMY?", 69 - 0.11, 1.3, 27.0, -Math.PI / 2, 1.6],
  ["NOT ME", 88.0, 1.6, 45 + 0.11, 0, 1.8],
  ["IT ANSWERS LATE", 40.0, 1.7, 66 - 0.11, Math.PI, 2.6],
];
