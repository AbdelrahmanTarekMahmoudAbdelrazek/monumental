import { hashSeed, mulberry32 } from "./pairing";

/**
 * "Which is more?" duel mode: two cards side by side, tap the one with the higher
 * (or, for "older", the earlier) value. Server-scored like everything else.
 */

export type DuelCategoryId = "movies" | "celebs" | "older" | "area" | "population";

export interface DuelCategory {
  id: DuelCategoryId;
  label: string;
  /** Question shown above the cards. */
  question: string;
  /** true = bigger value wins; false = smaller value wins (older = earlier year). */
  higherWins: boolean;
  /** Short note on the data source / snapshot, shown under the reveal. */
  source: string;
  /** Pairs closer than this are skipped so there's always a clear answer. */
  minGap: (a: number, b: number) => boolean;
  emoji: string;
}

export interface DuelItem {
  id: string;
  cat: DuelCategoryId;
  name: string;
  /** Second line on the card (year, country, field…). */
  sub: string;
  value: number;
  /** 1 = famous … 3 = harder */
  tier: 1 | 2 | 3;
  /** For countries: key into the outline map. */
  outline?: string;
}

const rel = (pct: number) => (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) >= pct;

export const DUEL_CATEGORIES: Record<DuelCategoryId, DuelCategory> = {
  movies: { id: "movies", label: "Movies", question: "Which movie has the higher IMDb rating?", higherWins: true, emoji: "🎬", source: "IMDb user rating, approximate snapshot (2026) — ratings drift by about ±0.1 over time.", minGap: (a, b) => Math.abs(a - b) >= 0.2 },
  celebs: { id: "celebs", label: "Who is taller?", question: "Who is taller?", higherWins: true, emoji: "📏", source: "Commonly reported heights.", minGap: (a, b) => Math.abs(a - b) >= 0.03 },
  older: { id: "older", label: "Which is older?", question: "Which came first?", higherWins: false, emoji: "⏳", source: "Year founded, built, invented or first released (approximate for ancient sites).", minGap: (a, b) => Math.abs(a - b) >= 3 },
  area: { id: "area", label: "Bigger country", question: "Which country is bigger?", higherWins: true, emoji: "🗺️", source: "Total area in km² (CIA World Factbook / UN).", minGap: rel(0.06) },
  population: { id: "population", label: "More people", question: "Which country has more people?", higherWins: true, emoji: "👥", source: "UN World Population Prospects 2024 estimate.", minGap: rel(0.05) },
};

type Row = [id: string, name: string, sub: string, value: number, tier: 1 | 2 | 3];
const rows = (cat: DuelCategoryId, list: Row[], outline = false): DuelItem[] =>
  list.map(([id, name, sub, value, tier]) => ({ id: `${cat}:${id}`, cat, name, sub, value, tier, outline: outline ? id : undefined }));

const MOVIES: Row[] = [
  ["shawshank", "The Shawshank Redemption", "1994", 9.3, 1], ["godfather", "The Godfather", "1972", 9.2, 1], ["dark_knight", "The Dark Knight", "2008", 9.0, 1],
  ["godfather2", "The Godfather Part II", "1974", 9.0, 2], ["angry_men", "12 Angry Men", "1957", 9.0, 3], ["schindler", "Schindler's List", "1993", 9.0, 2],
  ["lotr3", "The Lord of the Rings: The Return of the King", "2003", 9.0, 1], ["pulp_fiction", "Pulp Fiction", "1994", 8.9, 1], ["lotr1", "The Lord of the Rings: The Fellowship of the Ring", "2001", 8.9, 1],
  ["good_bad_ugly", "The Good, the Bad and the Ugly", "1966", 8.8, 3], ["forrest_gump", "Forrest Gump", "1994", 8.8, 1], ["fight_club", "Fight Club", "1999", 8.8, 1],
  ["inception", "Inception", "2010", 8.8, 1], ["matrix", "The Matrix", "1999", 8.7, 1], ["goodfellas", "Goodfellas", "1990", 8.7, 2],
  ["interstellar", "Interstellar", "2014", 8.7, 1], ["se7en", "Se7en", "1995", 8.6, 2], ["spirited_away", "Spirited Away", "2001", 8.6, 2],
  ["silence_lambs", "The Silence of the Lambs", "1991", 8.6, 2], ["private_ryan", "Saving Private Ryan", "1998", 8.6, 2], ["terminator2", "Terminator 2: Judgment Day", "1991", 8.6, 2],
  ["parasite", "Parasite", "2019", 8.5, 2], ["gladiator", "Gladiator", "2000", 8.5, 1], ["lion_king", "The Lion King", "1994", 8.5, 1],
  ["back_future", "Back to the Future", "1985", 8.5, 1], ["prestige", "The Prestige", "2006", 8.5, 2], ["whiplash", "Whiplash", "2014", 8.5, 2],
  ["departed", "The Departed", "2006", 8.5, 2], ["dune2", "Dune: Part Two", "2024", 8.5, 1], ["alien", "Alien", "1979", 8.5, 2],
  ["casablanca", "Casablanca", "1942", 8.5, 3], ["psycho", "Psycho", "1960", 8.5, 3], ["endgame", "Avengers: Endgame", "2019", 8.4, 1],
  ["coco", "Coco", "2017", 8.4, 2], ["spiderverse", "Spider-Man: Into the Spider-Verse", "2018", 8.4, 2], ["shining", "The Shining", "1980", 8.4, 2],
  ["wall_e", "WALL·E", "2008", 8.4, 2], ["joker", "Joker", "2019", 8.3, 1], ["toy_story", "Toy Story", "1995", 8.3, 1],
  ["up", "Up", "2009", 8.3, 1], ["oppenheimer", "Oppenheimer", "2023", 8.3, 1], ["jurassic_park", "Jurassic Park", "1993", 8.2, 1],
  ["finding_nemo", "Finding Nemo", "2003", 8.2, 1], ["top_gun_maverick", "Top Gun: Maverick", "2022", 8.2, 1], ["no_way_home", "Spider-Man: No Way Home", "2021", 8.2, 1],
  ["taxi_driver", "Taxi Driver", "1976", 8.2, 3], ["mad_max", "Mad Max: Fury Road", "2015", 8.1, 2], ["inside_out", "Inside Out", "2015", 8.1, 2],
  ["hp_deathly2", "Harry Potter and the Deathly Hallows – Part 2", "2011", 8.1, 1], ["pirates1", "Pirates of the Caribbean: The Curse of the Black Pearl", "2003", 8.1, 1],
  ["avengers", "The Avengers", "2012", 8.0, 1], ["dune", "Dune", "2021", 8.0, 1], ["la_la_land", "La La Land", "2016", 8.0, 2],
  ["titanic", "Titanic", "1997", 7.9, 1], ["avatar", "Avatar", "2009", 7.9, 1], ["shrek", "Shrek", "2001", 7.9, 1],
  ["irishman", "The Irishman", "2019", 7.8, 2], ["the_batman", "The Batman", "2022", 7.8, 1], ["social_network", "The Social Network", "2010", 7.8, 2],
  ["get_out", "Get Out", "2017", 7.8, 2], ["home_alone", "Home Alone", "1990", 7.7, 1], ["hp1", "Harry Potter and the Philosopher's Stone", "2001", 7.6, 1],
  ["frozen", "Frozen", "2013", 7.4, 1], ["black_panther", "Black Panther", "2018", 7.3, 1], ["barbie", "Barbie", "2023", 6.8, 1],
  ["fast_x", "Fast X", "2023", 5.8, 2], ["twilight", "Twilight", "2008", 5.3, 1], ["morbius", "Morbius", "2022", 5.2, 2],
  ["fifty_shades", "Fifty Shades of Grey", "2015", 4.2, 2], ["cats", "Cats", "2019", 2.8, 2],
];

const CELEBS: Row[] = [
  ["sultan_kosen", "Sultan Kösen", "Tallest living man", 2.51, 3], ["yao_ming", "Yao Ming", "Basketball", 2.29, 2], ["wembanyama", "Victor Wembanyama", "Basketball", 2.24, 2],
  ["shaq", "Shaquille O'Neal", "Basketball", 2.16, 1], ["lebron", "LeBron James", "Basketball", 2.06, 1], ["jordan", "Michael Jordan", "Basketball", 1.98, 1],
  ["the_rock", "Dwayne Johnson", "Actor", 1.96, 1], ["bolt", "Usain Bolt", "Sprinter", 1.95, 1], ["zlatan", "Zlatan Ibrahimović", "Football", 1.95, 2],
  ["lincoln", "Abraham Lincoln", "US President", 1.93, 2], ["haaland", "Erling Haaland", "Football", 1.94, 1], ["musk", "Elon Musk", "Entrepreneur", 1.88, 1],
  ["ronaldo", "Cristiano Ronaldo", "Football", 1.87, 1], ["keanu", "Keanu Reeves", "Actor", 1.86, 1], ["obama", "Barack Obama", "US President", 1.85, 1],
  ["dicaprio", "Leonardo DiCaprio", "Actor", 1.83, 1], ["brad_pitt", "Brad Pitt", "Actor", 1.80, 1], ["taylor_swift", "Taylor Swift", "Singer", 1.80, 1],
  ["zendaya", "Zendaya", "Actor", 1.78, 1], ["mbappe", "Kylian Mbappé", "Football", 1.78, 1], ["salah", "Mohamed Salah", "Football", 1.75, 1],
  ["serena", "Serena Williams", "Tennis", 1.75, 2], ["neymar", "Neymar", "Football", 1.75, 2], ["messi", "Lionel Messi", "Football", 1.70, 1],
  ["tom_cruise", "Tom Cruise", "Actor", 1.70, 1], ["napoleon", "Napoleon Bonaparte", "French emperor", 1.69, 2], ["selena", "Selena Gomez", "Singer", 1.65, 2],
  ["kevin_hart", "Kevin Hart", "Comedian", 1.63, 1], ["lady_gaga", "Lady Gaga", "Singer", 1.55, 2], ["ariana", "Ariana Grande", "Singer", 1.53, 2],
  ["devito", "Danny DeVito", "Actor", 1.47, 2], ["dinklage", "Peter Dinklage", "Actor", 1.35, 2],
];

/** Years: negative = BC. */
const OLDER: Row[] = [
  ["stonehenge", "Stonehenge", "Ancient monument", -3000, 2], ["great_pyramid", "Great Pyramid of Giza", "Ancient monument", -2560, 1],
  ["parthenon", "Parthenon", "Ancient Greece", -438, 2], ["colosseum", "Colosseum", "Ancient Rome", 80, 1], ["al_azhar", "Al-Azhar University", "Cairo", 970, 2],
  ["oxford", "University of Oxford", "Teaching since", 1096, 3], ["printing_press", "Gutenberg printing press", "Invention", 1440, 2], ["taj_mahal", "Taj Mahal", "Completed", 1653, 1],
  ["harvard", "Harvard University", "Founded", 1636, 2], ["usa", "United States", "Independence", 1776, 1], ["coca_cola", "Coca-Cola", "First sold", 1886, 1],
  ["statue_liberty", "Statue of Liberty", "Dedicated", 1886, 2], ["eiffel", "Eiffel Tower", "Opened", 1889, 1], ["nintendo", "Nintendo", "Founded (as a card company)", 1889, 2],
  ["telephone", "The telephone", "Patented", 1876, 1], ["light_bulb", "Edison's light bulb", "Invention", 1879, 2], ["first_flight", "Wright brothers' first flight", "Aviation", 1903, 1],
  ["disney", "Disney", "Founded", 1923, 1], ["television", "Television", "First demonstration", 1927, 2], ["lego", "LEGO", "Founded", 1932, 2],
  ["mcdonalds", "McDonald's", "First restaurant", 1940, 1], ["arpanet", "ARPANET (early internet)", "First message", 1969, 3], ["microsoft", "Microsoft", "Founded", 1975, 1],
  ["apple", "Apple", "Founded", 1976, 1], ["www", "World Wide Web", "Invented", 1989, 2], ["amazon", "Amazon", "Founded", 1994, 1],
  ["playstation", "PlayStation", "Released", 1994, 2], ["netflix", "Netflix", "Founded", 1997, 2], ["google", "Google", "Founded", 1998, 1],
  ["wikipedia", "Wikipedia", "Launched", 2001, 2], ["facebook", "Facebook", "Launched", 2004, 1], ["youtube", "YouTube", "Launched", 2005, 1],
  ["iphone", "iPhone", "Released", 2007, 1], ["bitcoin", "Bitcoin", "Launched", 2009, 2], ["instagram", "Instagram", "Launched", 2010, 1],
  ["tiktok", "TikTok", "Launched", 2016, 1], ["chatgpt", "ChatGPT", "Released", 2022, 1],
];

const AREA: Row[] = [
  ["russia", "Russia", "Europe / Asia", 17_098_246, 1], ["canada", "Canada", "North America", 9_984_670, 1], ["usa", "United States", "North America", 9_833_517, 1],
  ["china", "China", "Asia", 9_596_960, 1], ["brazil", "Brazil", "South America", 8_515_767, 1], ["australia", "Australia", "Oceania", 7_741_220, 1],
  ["india", "India", "Asia", 3_287_263, 1], ["argentina", "Argentina", "South America", 2_780_400, 1], ["kazakhstan", "Kazakhstan", "Asia", 2_724_900, 2],
  ["algeria", "Algeria", "Africa", 2_381_741, 2], ["dr_congo", "DR Congo", "Africa", 2_344_858, 2], ["saudi_arabia", "Saudi Arabia", "Asia", 2_149_690, 1],
  ["mexico", "Mexico", "North America", 1_964_375, 1], ["indonesia", "Indonesia", "Asia", 1_904_569, 2], ["sudan", "Sudan", "Africa", 1_861_484, 2],
  ["libya", "Libya", "Africa", 1_759_540, 2], ["iran", "Iran", "Asia", 1_648_195, 2], ["mongolia", "Mongolia", "Asia", 1_564_110, 2],
  ["peru", "Peru", "South America", 1_285_216, 2], ["chad", "Chad", "Africa", 1_284_000, 3], ["niger", "Niger", "Africa", 1_267_000, 3],
  ["angola", "Angola", "Africa", 1_246_700, 3], ["mali", "Mali", "Africa", 1_240_192, 3], ["south_africa", "South Africa", "Africa", 1_219_090, 2],
  ["colombia", "Colombia", "South America", 1_138_910, 2], ["ethiopia", "Ethiopia", "Africa", 1_104_300, 2], ["bolivia", "Bolivia", "South America", 1_098_581, 3],
  ["egypt", "Egypt", "Africa", 1_001_450, 1], ["tanzania", "Tanzania", "Africa", 947_300, 3], ["nigeria", "Nigeria", "Africa", 923_768, 2],
  ["venezuela", "Venezuela", "South America", 912_050, 3], ["pakistan", "Pakistan", "Asia", 796_095, 2], ["turkey", "Türkiye", "Europe / Asia", 783_562, 1],
  ["chile", "Chile", "South America", 756_102, 2], ["afghanistan", "Afghanistan", "Asia", 652_230, 3], ["ukraine", "Ukraine", "Europe", 603_550, 2],
  ["madagascar", "Madagascar", "Africa", 587_041, 2], ["kenya", "Kenya", "Africa", 580_367, 2], ["france", "France", "Europe (metropolitan)", 551_695, 1],
  ["yemen", "Yemen", "Asia", 527_968, 3], ["thailand", "Thailand", "Asia", 513_120, 2], ["spain", "Spain", "Europe", 505_370, 1],
  ["sweden", "Sweden", "Europe", 450_295, 2], ["morocco", "Morocco", "Africa", 446_550, 2], ["iraq", "Iraq", "Asia", 438_317, 2],
  ["japan", "Japan", "Asia", 377_915, 1], ["germany", "Germany", "Europe", 357_022, 1], ["finland", "Finland", "Europe", 338_145, 2],
  ["norway", "Norway", "Europe", 323_802, 2], ["italy", "Italy", "Europe", 301_340, 1], ["philippines", "Philippines", "Asia", 300_000, 2],
  ["uk", "United Kingdom", "Europe", 243_610, 1], ["syria", "Syria", "Asia", 185_180, 3], ["tunisia", "Tunisia", "Africa", 163_610, 3],
  ["bangladesh", "Bangladesh", "Asia", 148_460, 2], ["greece", "Greece", "Europe", 131_957, 2], ["south_korea", "South Korea", "Asia", 99_720, 1],
  ["portugal", "Portugal", "Europe", 92_090, 2], ["jordan", "Jordan", "Asia", 89_342, 2], ["uae", "United Arab Emirates", "Asia", 83_600, 2],
  ["ireland", "Ireland", "Europe", 70_273, 2], ["sri_lanka", "Sri Lanka", "Asia", 65_610, 3], ["netherlands", "Netherlands", "Europe", 41_543, 2],
  ["switzerland", "Switzerland", "Europe", 41_277, 2], ["belgium", "Belgium", "Europe", 30_528, 2], ["kuwait", "Kuwait", "Asia", 17_818, 3],
  ["qatar", "Qatar", "Asia", 11_586, 2], ["lebanon", "Lebanon", "Asia", 10_452, 3],
];

/** Millions of people (UN WPP 2024). */
const POPULATION: Row[] = [
  ["india", "India", "Asia", 1451, 1], ["china", "China", "Asia", 1419, 1], ["usa", "United States", "North America", 345, 1],
  ["indonesia", "Indonesia", "Asia", 283, 1], ["pakistan", "Pakistan", "Asia", 251, 2], ["nigeria", "Nigeria", "Africa", 233, 2],
  ["brazil", "Brazil", "South America", 212, 1], ["bangladesh", "Bangladesh", "Asia", 174, 2], ["russia", "Russia", "Europe / Asia", 144, 1],
  ["ethiopia", "Ethiopia", "Africa", 132, 2], ["mexico", "Mexico", "North America", 131, 1], ["japan", "Japan", "Asia", 124, 1],
  ["egypt", "Egypt", "Africa", 116, 1], ["philippines", "Philippines", "Asia", 116, 2], ["dr_congo", "DR Congo", "Africa", 109, 3],
  ["vietnam", "Vietnam", "Asia", 101, 2], ["iran", "Iran", "Asia", 91.6, 2], ["turkey", "Türkiye", "Europe / Asia", 87.5, 1],
  ["germany", "Germany", "Europe", 84.6, 1], ["thailand", "Thailand", "Asia", 71.7, 2], ["uk", "United Kingdom", "Europe", 69.1, 1],
  ["tanzania", "Tanzania", "Africa", 68.6, 3], ["france", "France", "Europe", 66.5, 1], ["south_africa", "South Africa", "Africa", 64.0, 2],
  ["italy", "Italy", "Europe", 59.3, 1], ["kenya", "Kenya", "Africa", 56.4, 2], ["myanmar", "Myanmar", "Asia", 54.5, 3],
  ["colombia", "Colombia", "South America", 52.9, 2], ["south_korea", "South Korea", "Asia", 51.7, 1], ["sudan", "Sudan", "Africa", 50.4, 3],
  ["uganda", "Uganda", "Africa", 50.0, 3], ["spain", "Spain", "Europe", 47.9, 1], ["algeria", "Algeria", "Africa", 46.8, 2],
  ["iraq", "Iraq", "Asia", 46.0, 2], ["argentina", "Argentina", "South America", 45.7, 1], ["afghanistan", "Afghanistan", "Asia", 42.6, 3],
  ["canada", "Canada", "North America", 39.7, 1], ["poland", "Poland", "Europe", 38.5, 2], ["morocco", "Morocco", "Africa", 38.1, 2],
  ["malaysia", "Malaysia", "Asia", 35.6, 2], ["saudi_arabia", "Saudi Arabia", "Asia", 33.9, 1], ["peru", "Peru", "South America", 34.2, 2],
  ["australia", "Australia", "Oceania", 26.7, 1], ["kazakhstan", "Kazakhstan", "Asia", 20.6, 3], ["chile", "Chile", "South America", 19.8, 2],
  ["netherlands", "Netherlands", "Europe", 18.2, 2], ["tunisia", "Tunisia", "Africa", 12.3, 3], ["jordan", "Jordan", "Asia", 11.6, 2],
  ["uae", "United Arab Emirates", "Asia", 11.0, 2], ["sweden", "Sweden", "Europe", 10.6, 2], ["portugal", "Portugal", "Europe", 10.4, 2],
  ["greece", "Greece", "Europe", 10.0, 2], ["switzerland", "Switzerland", "Europe", 8.9, 2], ["lebanon", "Lebanon", "Asia", 5.8, 3],
  ["norway", "Norway", "Europe", 5.6, 2], ["ireland", "Ireland", "Europe", 5.3, 2], ["kuwait", "Kuwait", "Asia", 4.9, 3],
  ["mongolia", "Mongolia", "Asia", 3.5, 3], ["qatar", "Qatar", "Asia", 3.0, 2],
];

export const DUEL_ITEMS: DuelItem[] = [
  ...rows("movies", MOVIES),
  ...rows("celebs", CELEBS),
  ...rows("older", OLDER),
  ...rows("area", AREA, true),
  ...rows("population", POPULATION, true),
];

export const DUEL_MAP: Record<string, DuelItem> = Object.fromEntries(DUEL_ITEMS.map((d) => [d.id, d]));

export function getDuelItem(id: string): DuelItem {
  const d = DUEL_MAP[id];
  if (!d) throw new Error(`Unknown duel item ${id}`);
  return d;
}

/** Display a duel value the way a person would say it. */
export function fmtDuelValue(cat: DuelCategoryId, v: number): string {
  switch (cat) {
    case "movies": return `★ ${v.toFixed(1)}`;
    case "celebs": return `${v.toFixed(2)} m`;
    case "older": return v < 0 ? `${-v} BC` : `${v}`;
    case "area": return `${Math.round(v).toLocaleString("en-US")} km²`;
    case "population": return v >= 1000 ? `${(v / 1000).toFixed(2)} billion` : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} million`;
  }
}

/** Which side wins: "a", "b". Pairs are generated so there is never a tie. */
export function duelWinner(a: DuelItem, b: DuelItem): "a" | "b" {
  const cat = DUEL_CATEGORIES[a.cat];
  return (cat.higherWins ? a.value > b.value : a.value < b.value) ? "a" : "b";
}

/** Pick `count` duel pairs from the given categories, same category per pair. */
export function pickDuelPairs(cats: DuelCategoryId[], tiers: number[], count: number, seed: string): { aId: string; bId: string }[] {
  const rnd = mulberry32(hashSeed(seed));
  const out: { aId: string; bId: string }[] = [];
  const used = new Set<string>();
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < 5000) {
    const cat = cats[Math.floor(rnd() * cats.length)];
    const pool = DUEL_ITEMS.filter((d) => d.cat === cat && tiers.includes(d.tier));
    if (pool.length < 2) continue;
    const a = pool[Math.floor(rnd() * pool.length)];
    const b = pool[Math.floor(rnd() * pool.length)];
    if (a.id === b.id || !DUEL_CATEGORIES[cat].minGap(a.value, b.value)) continue;
    const key = [a.id, b.id].sort().join("|");
    if (seen.has(key)) continue;
    // avoid showing the same card twice in a session when possible
    if (guard < 3000 && (used.has(a.id) || used.has(b.id))) continue;
    seen.add(key); used.add(a.id); used.add(b.id);
    out.push({ aId: a.id, bId: b.id });
  }
  return out;
}

export interface DuelPickInput { playerId: string; pick: "a" | "b" | null; ms: number | null }
export interface DuelScored { playerId: string; pick: "a" | "b" | null; ms: number | null; correct: boolean; rank: number | null; points: number }

/**
 * Duel scoring: wrong or no answer → 0. Correct answers are ranked by speed:
 * fastest correct 3 pts, 2nd & 3rd fastest 2 pts, every other correct answer 1 pt.
 */
export function scoreDuel(winner: "a" | "b", picks: DuelPickInput[]): DuelScored[] {
  const scored = picks.map((p) => ({ ...p, correct: p.pick === winner, rank: null as number | null, points: 0 }));
  const correct = scored.filter((s) => s.correct).sort((x, y) => (x.ms ?? 1e12) - (y.ms ?? 1e12));
  correct.forEach((s, i) => {
    s.rank = i + 1;
    s.points = i === 0 ? 3 : i <= 2 ? 2 : 1;
  });
  return scored;
}
