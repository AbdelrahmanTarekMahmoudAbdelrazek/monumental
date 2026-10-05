import type { CatalogGroup, Monument, MonumentCategory } from "./types";
import { getSilhouette } from "./silhouettes";
import { SEED2 } from "./catalog2";

type Seed = Omit<Monument, "silhouette" | "image">;

/**
 * Heights are checked against Wikipedia / official sources (Oct 2026).
 * `heightNote` says exactly what the figure includes so the game is fair.
 *
 * tier 1 = world-famous, 2 = well known, 3 = lesser-known, 4 = obscure
 */
const SEED: Seed[] = [
  // ---------------- EGYPT ----------------
  { id: "great_pyramid", name: "Great Pyramid of Giza", country: "Egypt", heightM: 138.5, heightNote: "Current height (eroded, no capstone). Originally 146.6 m.", category: "ancient", tier: 1, funFact: "It was the tallest man-made structure on Earth for about 3,800 years." },
  { id: "khafre", name: "Pyramid of Khafre", country: "Egypt", heightM: 136.4, heightNote: "Current height; originally 143.5 m. Still has some of its original casing stones at the top.", category: "ancient", tier: 2, funFact: "It looks taller than the Great Pyramid because it sits on higher bedrock." },
  { id: "menkaure", name: "Pyramid of Menkaure", country: "Egypt", heightM: 61, heightNote: "Current height; originally about 65 m.", category: "ancient", tier: 3, funFact: "In 1196 a sultan tried to demolish it; after eight months his crew had only gouged a vertical scar." },
  { id: "sphinx", name: "Great Sphinx of Giza", country: "Egypt", heightM: 20, heightNote: "Height from base to top of head. Length 73 m.", category: "ancient", tier: 1, funFact: "It was carved from a single mass of limestone bedrock, not built from blocks." },
  { id: "abu_simbel", name: "Abu Simbel colossi", country: "Egypt", heightM: 20, heightNote: "Each seated statue of Ramesses II, approx. 20 m, not counting the cliff façade.", category: "ancient", tier: 2, funFact: "The whole temple was cut into blocks and moved 65 m uphill in the 1960s to escape Lake Nasser." },
  { id: "cairo_tower", name: "Cairo Tower", country: "Egypt", heightM: 187, heightNote: "Total height including the rooftop mast.", category: "tower", tier: 2, funFact: "Its lattice façade is designed to resemble a lotus plant." },
  { id: "luxor_obelisk", name: "Luxor Obelisk (Paris)", country: "France", heightM: 23, heightNote: "Obelisk only, excluding the 9 m pedestal. Originally from Luxor Temple.", category: "ancient", tier: 3, funFact: "Its twin still stands at Luxor Temple in Egypt; France was gifted both but only moved one." },

  // ---------------- ANCIENT / RELIGIOUS ----------------
  { id: "taj_mahal", name: "Taj Mahal", country: "India", heightM: 73, heightNote: "Top of the main dome finial above the plinth.", category: "religious", tier: 1, funFact: "The four minarets lean slightly outward so they would fall away from the tomb in an earthquake." },
  { id: "angkor_wat", name: "Angkor Wat (central tower)", country: "Cambodia", heightM: 65, heightNote: "Central tower above ground level.", category: "religious", tier: 1, funFact: "It is the largest religious monument in the world by land area." },
  { id: "el_castillo", name: "El Castillo, Chichén Itzá", country: "Mexico", heightM: 30, heightNote: "Including the 6 m temple on top; the pyramid body alone is 24 m.", category: "ancient", tier: 1, funFact: "At the equinoxes, the sun casts a serpent-shaped shadow down the north staircase." },
  { id: "pyramid_sun", name: "Pyramid of the Sun, Teotihuacan", country: "Mexico", heightM: 65, heightNote: "Commonly cited 65 m (sources range 65–71 m).", category: "ancient", tier: 2, funFact: "Its base is almost as wide as the Great Pyramid's, but it is less than half as tall." },
  { id: "tikal_iv", name: "Temple IV, Tikal", country: "Guatemala", heightM: 70, heightNote: "Approximate height including roof comb; often cited as 64.6–70 m.", category: "ancient", tier: 4, funFact: "It is the tallest pre-Columbian structure still standing in the Americas." },
  { id: "parthenon", name: "Parthenon", country: "Greece", heightM: 14, heightNote: "Height of the columns + entablature, approx. 13.7 m.", category: "ancient", tier: 1, funFact: "Almost no line on the building is truly straight — subtle curves correct optical illusions." },
  { id: "colosseum", name: "Colosseum", country: "Italy", heightM: 48, heightNote: "Outer wall at its tallest surviving point.", category: "ancient", tier: 1, funFact: "It could be flooded for mock naval battles in its early years." },
  { id: "pantheon", name: "Pantheon, Rome", country: "Italy", heightM: 43, heightNote: "Height to the top of the dome; the interior is a perfect 43.3 m sphere.", category: "ancient", tier: 2, funFact: "Its unreinforced concrete dome is still the largest in the world after 1,900 years." },
  { id: "petra_treasury", name: "Al-Khazneh (The Treasury), Petra", country: "Jordan", heightM: 39, heightNote: "Carved façade height, approx. 39 m.", category: "ancient", tier: 2, funFact: "Bedouin legend said the urn on top held pharaoh's gold, so it is pocked with bullet holes." },
  { id: "stonehenge", name: "Stonehenge (great trilithon)", country: "United Kingdom", heightM: 7.3, heightNote: "Tallest surviving upright (stone 56) above ground.", category: "ancient", tier: 2, funFact: "The bluestones were hauled about 240 km from the Preseli Hills in Wales." },
  { id: "kaaba", name: "Kaaba", country: "Saudi Arabia", heightM: 13.1, heightNote: "Height of the cube structure.", category: "religious", tier: 2, funFact: "Its black silk covering, the kiswah, is replaced every year." },
  { id: "hagia_sophia", name: "Hagia Sophia", country: "Türkiye", heightM: 55.6, heightNote: "Dome height above the floor; minarets are taller (~60 m).", category: "religious", tier: 1, funFact: "It held the title of world's largest cathedral for nearly a thousand years." },
  { id: "st_peters", name: "St. Peter's Basilica", country: "Vatican City", heightM: 136.6, heightNote: "To the top of the cross on the dome.", category: "religious", tier: 1, funFact: "It remains the tallest dome in the world." },
  { id: "milan_cathedral", name: "Milan Cathedral (Duomo)", country: "Italy", heightM: 108.5, heightNote: "To the top of the Madonnina statue on the main spire.", category: "religious", tier: 2, funFact: "For centuries no building in Milan was allowed to rise above the golden Madonnina." },
  { id: "cologne_cathedral", name: "Cologne Cathedral", country: "Germany", heightM: 157.4, heightNote: "Height of the twin spires.", category: "religious", tier: 2, funFact: "Construction took 632 years — from 1248 to 1880." },
  { id: "ulm_minster", name: "Ulm Minster", country: "Germany", heightM: 161.5, heightNote: "Steeple height; the tallest church tower until Sagrada Família's central tower was completed.", category: "religious", tier: 3, funFact: "You can climb 768 steps to a viewing platform just below the top of the spire." },
  { id: "sagrada_familia", name: "Sagrada Família (Tower of Jesus Christ)", country: "Spain", heightM: 172.5, heightNote: "Central tower incl. the 17 m cross, completed in 2026 — now the tallest church in the world.", category: "religious", tier: 1, funFact: "Gaudí deliberately kept it slightly lower than Montjuïc hill so his work would not surpass God's." },
  { id: "blue_mosque", name: "Blue Mosque (Sultan Ahmed)", country: "Türkiye", heightM: 43, heightNote: "Main dome height; its six minarets are about 64 m.", category: "religious", tier: 2, funFact: "Over 20,000 handmade İznik tiles give it its nickname." },
  { id: "dome_of_rock", name: "Dome of the Rock", country: "Jerusalem", heightM: 35, heightNote: "Approximate total height of the shrine (dome diameter 20 m).", category: "religious", tier: 2, funFact: "Its golden dome was originally lead; the gold-leaf cladding dates from 1993." },
  { id: "hassan_ii", name: "Hassan II Mosque minaret", country: "Morocco", heightM: 210, heightNote: "Minaret height — the tallest minaret in the world.", category: "religious", tier: 3, funFact: "A laser on top of the minaret shines toward Mecca at night." },
  { id: "qutb_minar", name: "Qutb Minar", country: "India", heightM: 72.5, heightNote: "Total height of the brick minaret.", category: "tower", tier: 3, funFact: "It is the tallest brick minaret in the world, built from 1199 onward." },
  { id: "lotus_temple", name: "Lotus Temple", country: "India", heightM: 34, heightNote: "Height of the tallest marble petals above ground.", category: "religious", tier: 3, funFact: "Its 27 marble petals are arranged in clusters of three to form nine sides." },
  { id: "shwedagon", name: "Shwedagon Pagoda", country: "Myanmar", heightM: 99, heightNote: "Stupa height from platform; some sources cite 112 m including the hilltop base.", category: "religious", tier: 3, funFact: "The top is studded with thousands of diamonds and a 76-carat one at the very tip." },
  { id: "potala", name: "Potala Palace", country: "China (Tibet)", heightM: 117, heightNote: "Height of the palace structure above its hill base.", category: "landmark", tier: 3, funFact: "It has over 1,000 rooms and sits at 3,700 m above sea level." },
  { id: "himeji", name: "Himeji Castle", country: "Japan", heightM: 46.4, heightNote: "Main keep height, excluding the stone base (~15 m).", category: "landmark", tier: 3, funFact: "Its white plaster earned it the nickname 'White Heron Castle'." },
  { id: "kinkakuji", name: "Kinkaku-ji (Golden Pavilion)", country: "Japan", heightM: 12.5, heightNote: "Height of the three-storey pavilion.", category: "religious", tier: 3, funFact: "The current building is a 1955 reconstruction after a monk burned the original down." },
  { id: "wat_arun", name: "Wat Arun (central prang)", country: "Thailand", heightM: 70, heightNote: "Central tower; sources range 66–86 m.", category: "religious", tier: 4, funFact: "It is decorated with pieces of Chinese porcelain used as ships' ballast." },
  { id: "leshan_buddha", name: "Leshan Giant Buddha", country: "China", heightM: 71, heightNote: "Total height of the seated figure.", category: "statue", tier: 2, funFact: "Its ears alone are 7 m long, and a hidden drainage system keeps it from eroding." },
  { id: "spring_temple_buddha", name: "Spring Temple Buddha", country: "China", heightM: 128, heightNote: "Statue only; 153 m including the lotus throne, 208 m with the pedestal building.", category: "statue", tier: 3, funFact: "It was the tallest statue in the world from 2008 until the Statue of Unity in 2018." },
  { id: "big_buddha_hk", name: "Tian Tan Buddha (Big Buddha)", country: "Hong Kong", heightM: 34, heightNote: "Statue on its lotus, excluding the podium.", category: "statue", tier: 3, funFact: "The 268 steps up to it are a pilgrimage route for visitors on Lantau Island." },
  { id: "motherland_calls", name: "The Motherland Calls", country: "Russia", heightM: 85, heightNote: "Including the 33 m sword; the figure alone is 52 m.", category: "statue", tier: 2, funFact: "The statue is not fixed to its foundation — it stands under its own weight." },
  { id: "christ_redeemer", name: "Christ the Redeemer", country: "Brazil", heightM: 30, heightNote: "Statue only; 38 m including the 8 m pedestal.", category: "statue", tier: 1, funFact: "Its arms span 28 m and it is struck by lightning several times a year." },
  { id: "statue_of_liberty", name: "Statue of Liberty", country: "United States", heightM: 93, heightNote: "Ground to torch INCLUDING pedestal. The copper statue alone is 46 m.", category: "statue", tier: 1, funFact: "Its copper skin is only 2.4 mm thick — about two pennies." },
  { id: "statue_of_unity", name: "Statue of Unity", country: "India", heightM: 182, heightNote: "Statue only; 240 m including the base.", category: "statue", tier: 1, funFact: "It is the tallest statue in the world, nearly four times the Statue of Liberty's figure." },
  { id: "moai", name: "Moai (average)", country: "Chile (Easter Island)", heightM: 4, heightNote: "Average moai height; the tallest erected one is about 10 m.", category: "statue", tier: 1, funFact: "Most moai have bodies buried underground — the 'heads' are only the top third." },
  { id: "mount_rushmore", name: "Mount Rushmore (faces)", country: "United States", heightM: 18, heightNote: "Height of each carved face.", category: "statue", tier: 1, funFact: "Each nose is about 6 m long; the original plan included torsos." },
  { id: "great_wall_tower", name: "Great Wall watchtower (Badaling)", country: "China", heightM: 12, heightNote: "Typical two-storey watchtower above the wall, approx. 12 m.", category: "ancient", tier: 4, funFact: "Sticky-rice mortar helped the Ming-era wall survive 600 years of earthquakes." },

  // ---------------- TOWERS & LANDMARKS ----------------
  { id: "eiffel_tower", name: "Eiffel Tower", country: "France", heightM: 330, heightNote: "Including antennas (since 2022); the iron structure is 300 m.", category: "tower", tier: 1, funFact: "It grows about 15 cm taller in summer as the iron expands." },
  { id: "cn_tower", name: "CN Tower", country: "Canada", heightM: 553.3, heightNote: "Total height to the tip of the antenna.", category: "tower", tier: 1, funFact: "It was the world's tallest free-standing structure for 32 years." },
  { id: "tokyo_skytree", name: "Tokyo Skytree", country: "Japan", heightM: 634, heightNote: "Total height to the tip.", category: "tower", tier: 1, funFact: "634 was chosen because 'mu-sa-shi' sounds like the old name of the Tokyo region." },
  { id: "space_needle", name: "Space Needle", country: "United States", heightM: 184, heightNote: "Total height to the tip of the aircraft-warning beacon.", category: "tower", tier: 1, funFact: "Built for the 1962 World's Fair, it was designed to withstand 9.0 earthquakes." },
  { id: "kl_tower", name: "Kuala Lumpur Tower", country: "Malaysia", heightM: 421, heightNote: "Total height including antenna.", category: "tower", tier: 3, funFact: "A 100-year-old tree was saved during construction by shifting the foundation." },
  { id: "washington_monument", name: "Washington Monument", country: "United States", heightM: 169, heightNote: "Official height 169.046 m.", category: "tower", tier: 1, funFact: "A colour change a third of the way up marks a 20-year pause in construction." },
  { id: "elizabeth_tower", name: "Big Ben (Elizabeth Tower)", country: "United Kingdom", heightM: 96, heightNote: "Tower height; 'Big Ben' is strictly the bell inside.", category: "tower", tier: 1, funFact: "The tower leans about 0.26° to the north-west, roughly 46 cm at the top." },
  { id: "leaning_tower", name: "Leaning Tower of Pisa", country: "Italy", heightM: 56, heightNote: "Approx. 55.9 m on the low side, 56.7 m on the high side.", category: "tower", tier: 1, funFact: "It began leaning during construction in 1178 because of soft ground." },
  { id: "giralda", name: "La Giralda", country: "Spain", heightM: 104, heightNote: "Total bell-tower height including the Giraldillo weathervane.", category: "tower", tier: 3, funFact: "It was built as a minaret in 1198 and has ramps inside instead of stairs." },
  { id: "nelsons_column", name: "Nelson's Column", country: "United Kingdom", heightM: 52, heightNote: "Ground to the top of Nelson's hat (51.6 m).", category: "landmark", tier: 2, funFact: "The 1839 measurement claimed 56 m; a 2006 laser survey found it 4.4 m shorter." },
  { id: "trajans_column", name: "Trajan's Column", country: "Italy", heightM: 35, heightNote: "Column incl. pedestal is 35 m; without pedestal 30 m. Statue of St Peter adds ~3 m.", category: "ancient", tier: 3, funFact: "Its spiral frieze would stretch 190 m if unrolled." },
  { id: "mole_antonelliana", name: "Mole Antonelliana", country: "Italy", heightM: 167.5, heightNote: "Total height to the tip of the spire.", category: "landmark", tier: 4, funFact: "Begun as a synagogue, it now houses Italy's National Museum of Cinema." },
  { id: "monas", name: "Monas (National Monument)", country: "Indonesia", heightM: 132, heightNote: "Total height including the gilded flame.", category: "landmark", tier: 3, funFact: "The flame on top is coated with 50 kg of gold leaf." },
  { id: "obelisco_ba", name: "Obelisco de Buenos Aires", country: "Argentina", heightM: 67.5, heightNote: "Total obelisk height.", category: "landmark", tier: 3, funFact: "It was built in just 31 days in 1936." },
  { id: "atomium", name: "Atomium", country: "Belgium", heightM: 102, heightNote: "Total height to the top sphere.", category: "landmark", tier: 2, funFact: "It is an iron crystal unit cell magnified 165 billion times." },
  { id: "gateway_arch", name: "Gateway Arch", country: "United States", heightM: 192, heightNote: "Height of the arch (also 192 m wide).", category: "landmark", tier: 1, funFact: "It is the tallest arch in the world and exactly as wide as it is tall." },
  { id: "arc_de_triomphe", name: "Arc de Triomphe", country: "France", heightM: 50, heightNote: "Total height of the arch.", category: "landmark", tier: 1, funFact: "In 1919 a pilot flew a biplane through the arch to celebrate the end of WWI." },
  { id: "brandenburg_gate", name: "Brandenburg Gate", country: "Germany", heightM: 26, heightNote: "Total height including the Quadriga sculpture.", category: "landmark", tier: 1, funFact: "Napoleon took the Quadriga to Paris in 1806; it came back in 1814." },
  { id: "tower_bridge", name: "Tower Bridge", country: "United Kingdom", heightM: 65, heightNote: "Height of the two towers.", category: "bridge", tier: 1, funFact: "Its bascules still lift around 800 times a year for river traffic." },
  { id: "golden_gate_tower", name: "Golden Gate Bridge (tower)", country: "United States", heightM: 227, heightNote: "Tower height above water.", category: "bridge", tier: 1, funFact: "Its 'International Orange' colour was chosen to stand out in fog." },
  { id: "sydney_harbour_bridge", name: "Sydney Harbour Bridge", country: "Australia", heightM: 134, heightNote: "Top of the arch above the water.", category: "bridge", tier: 2, funFact: "Locals call it 'The Coathanger'." },
  { id: "sydney_opera", name: "Sydney Opera House", country: "Australia", heightM: 65, heightNote: "Tallest shell above sea level.", category: "landmark", tier: 1, funFact: "The roof is covered in over one million self-cleaning tiles." },
  { id: "lincoln_memorial", name: "Lincoln Memorial", country: "United States", heightM: 30, heightNote: "Height of the building (the seated statue inside is 5.8 m).", category: "landmark", tier: 2, funFact: "Its 36 columns represent the states in the Union when Lincoln died." },
  { id: "neuschwanstein", name: "Neuschwanstein Castle", country: "Germany", heightM: 65, heightNote: "Tallest tower of the castle.", category: "landmark", tier: 2, funFact: "King Ludwig II slept in it only 11 nights before his death." },
  { id: "hollywood_sign", name: "Hollywood Sign (letters)", country: "United States", heightM: 13.7, heightNote: "Height of each letter (45 ft).", category: "landmark", tier: 2, funFact: "It originally read 'HOLLYWOODLAND' and advertised a housing development." },
  { id: "cleopatras_needle", name: "Cleopatra's Needle (London)", country: "United Kingdom", heightM: 21, heightNote: "Obelisk only, excluding its pedestal.", category: "ancient", tier: 4, funFact: "Six sailors died towing it from Egypt in 1877 when its pontoon broke loose." },
  { id: "white_tower", name: "White Tower, Tower of London", country: "United Kingdom", heightM: 27, heightNote: "Height of the keep to the battlements; turrets are slightly taller.", category: "landmark", tier: 3, funFact: "William the Conqueror built it to intimidate Londoners, not defend them." },
  { id: "great_mosque_djenne", name: "Great Mosque of Djenné", country: "Mali", heightM: 16, heightNote: "Approximate height of the tallest minaret tower.", category: "religious", tier: 4, funFact: "The whole town re-plasters it with mud every year in a festival." },

  // ---------------- SKYSCRAPERS ----------------
  { id: "burj_khalifa", name: "Burj Khalifa", country: "United Arab Emirates", heightM: 828, heightNote: "Architectural height incl. spire; tip is 829.8 m.", category: "skyscraper", tier: 1, funFact: "You can watch the sunset from the ground, then ride up and watch it set again." },
  { id: "empire_state", name: "Empire State Building", country: "United States", heightM: 443.2, heightNote: "To the tip of the antenna; roof height is 381 m.", category: "skyscraper", tier: 1, funFact: "It was built in just 410 days during the Great Depression." },
  { id: "chrysler", name: "Chrysler Building", country: "United States", heightM: 319, heightNote: "Including the spire, which was secretly assembled inside and hoisted in 90 minutes.", category: "skyscraper", tier: 2, funFact: "The spire stunt made it beat 40 Wall Street to 'world's tallest' in 1930." },
  { id: "petronas", name: "Petronas Towers", country: "Malaysia", heightM: 451.9, heightNote: "To the tip of the spires (counted in architectural height).", category: "skyscraper", tier: 1, funFact: "The skybridge is not fixed to the towers — it slides as they sway." },
  { id: "taipei_101", name: "Taipei 101", country: "Taiwan", heightM: 508, heightNote: "To the tip of the spire.", category: "skyscraper", tier: 1, funFact: "A 660-tonne steel ball near the top swings to counter typhoon winds." },
  { id: "shanghai_tower", name: "Shanghai Tower", country: "China", heightM: 632, heightNote: "Architectural height.", category: "skyscraper", tier: 2, funFact: "Its 120° twist cuts wind loads by about a quarter." },
  { id: "one_wtc", name: "One World Trade Center", country: "United States", heightM: 541.3, heightNote: "Including the spire = 1,776 ft; roof is 417 m.", category: "skyscraper", tier: 1, funFact: "1,776 feet is a reference to the year of the US Declaration of Independence." },
  { id: "merdeka_118", name: "Merdeka 118", country: "Malaysia", heightM: 678.9, heightNote: "Including the 160 m spire.", category: "skyscraper", tier: 2, funFact: "It is the second-tallest building in the world and the tallest in Southeast Asia." },
  { id: "lotte_world", name: "Lotte World Tower", country: "South Korea", heightM: 555, heightNote: "Architectural height.", category: "skyscraper", tier: 3, funFact: "Its shape is based on traditional Korean ceramics and calligraphy brushes." },
  { id: "the_shard", name: "The Shard", country: "United Kingdom", heightM: 309.6, heightNote: "Architectural height to the top of the glass shards.", category: "skyscraper", tier: 2, funFact: "A fox was found living on the 72nd floor during construction." },
  { id: "burj_al_arab", name: "Burj Al Arab", country: "United Arab Emirates", heightM: 321, heightNote: "Total height including the mast.", category: "skyscraper", tier: 2, funFact: "It stands on an artificial island 280 m from the beach." },
  { id: "gherkin", name: "30 St Mary Axe (The Gherkin)", country: "United Kingdom", heightM: 180, heightNote: "Architectural height.", category: "skyscraper", tier: 3, funFact: "Despite its curves, there is only one piece of curved glass — the lens at the very top." },
  { id: "kingdom_centre", name: "Kingdom Centre", country: "Saudi Arabia", heightM: 302, heightNote: "Architectural height to the top of the sky bridge.", category: "skyscraper", tier: 4, funFact: "The giant opening at the top is spanned by a 65 m sky bridge." },
  { id: "willis_tower", name: "Willis Tower (Sears Tower)", country: "United States", heightM: 527, heightNote: "To the tip of the antennas; roof is 442 m.", category: "skyscraper", tier: 2, funFact: "Its design is nine bundled tubes of different heights — like cigarettes in a pack." },
];

export const MONUMENTS: Monument[] = [...SEED, ...SEED2].map((m) => ({ ...m, silhouette: getSilhouette(m.id) }));

export const MONUMENT_CATEGORIES: MonumentCategory[] = ["ancient", "religious", "tower", "statue", "skyscraper", "bridge", "landmark"];
export const MIXED_GROUPS: CatalogGroup[] = ["monuments", "animal", "nature", "vehicle", "space"];

export const GROUP_LABEL: Record<CatalogGroup, string> = {
  monuments: "Monuments",
  animal: "Animals",
  nature: "Nature",
  vehicle: "Vehicles",
  space: "Space",
};

export function groupOf(m: Pick<Monument, "category">): CatalogGroup {
  return m.category === "animal" || m.category === "nature" || m.category === "vehicle" || m.category === "space" ? m.category : "monuments";
}

/** "How tall is …?" / "How wide is …?" / "How long is …?" */
export function sizeQuestion(m: Pick<Monument, "measure" | "name">): string {
  const verb = m.measure === "diameter" ? "How wide is" : m.measure === "length" ? "How long is" : "How tall is";
  return `${verb} ${m.name}?`;
}

export function measureWord(m: Pick<Monument, "measure">): string {
  return m.measure === "diameter" ? "diameter" : m.measure === "length" ? "length" : "height";
}

export const MONUMENT_MAP: Record<string, Monument> = Object.fromEntries(MONUMENTS.map((m) => [m.id, m]));

export function getMonument(id: string): Monument {
  const m = MONUMENT_MAP[id];
  if (!m) throw new Error(`Unknown monument ${id}`);
  return m;
}
