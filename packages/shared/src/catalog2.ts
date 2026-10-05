import type { Monument } from "./types";

type Seed = Omit<Monument, "silhouette" | "image">;

/**
 * Mixed-mode catalogue: animals, nature, vehicles, space.
 * Every figure is a commonly cited reference value; `heightNote` says exactly
 * what is measured. Space bodies are compared by DIAMETER (drawn as height).
 */
export const SEED2: Seed[] = [
  // ───────────── ANIMALS ─────────────
  { id: "giraffe", name: "Giraffe (adult male)", country: "Africa", heightM: 5.5, heightNote: "Ground to the tip of the horns (ossicones) of a large male.", category: "animal", tier: 1, funFact: "A giraffe's neck has only seven vertebrae — the same number as yours." },
  { id: "african_elephant", name: "African bush elephant", country: "Africa", heightM: 4, heightNote: "Shoulder height of a large bull.", category: "animal", tier: 1, funFact: "It is the largest living land animal and can weigh over 6 tonnes." },
  { id: "woolly_mammoth", name: "Woolly mammoth", country: "Extinct (Ice Age)", heightM: 3.4, heightNote: "Estimated shoulder height of a large male.", category: "animal", tier: 2, funFact: "The last mammoths lived on Wrangel Island until about 4,000 years ago — after the Great Pyramid was built." },
  { id: "human", name: "Adult human", country: "Everywhere", heightM: 1.7, heightNote: "Approximate average adult height.", category: "animal", tier: 1, funFact: "You are about 1 cm taller in the morning than at night." },
  { id: "blue_whale", name: "Blue whale (breaching)", country: "All oceans", heightM: 25, measure: "length", heightNote: "Typical adult LENGTH, shown standing on its tail; the record is about 30 m.", category: "animal", tier: 1, funFact: "Its heart is about the size of a small car." },
  { id: "t_rex", name: "Tyrannosaurus rex", country: "Extinct (Cretaceous)", heightM: 3.7, heightNote: "Hip height of a large adult; total length about 12 m.", category: "animal", tier: 1, funFact: "T. rex lived closer in time to us than to the first Stegosaurus." },
  { id: "brachiosaurus", name: "Brachiosaurus", country: "Extinct (Jurassic)", heightM: 12, heightNote: "Estimated head height with the neck raised.", category: "animal", tier: 2, funFact: "Its front legs were longer than its back legs, like a giraffe's." },
  { id: "ostrich", name: "Ostrich", country: "Africa", heightM: 2.7, heightNote: "Head height of a large male.", category: "animal", tier: 2, funFact: "An ostrich eye is bigger than its brain." },
  { id: "polar_bear", name: "Polar bear (standing)", country: "Arctic", heightM: 3, heightNote: "A large male standing on its hind legs.", category: "animal", tier: 2, funFact: "Its fur isn't white — each hair is clear and hollow." },
  { id: "gorilla", name: "Gorilla (standing)", country: "Central Africa", heightM: 1.7, heightNote: "A silverback standing upright.", category: "animal", tier: 3, funFact: "Gorillas share about 98% of their DNA with humans." },
  { id: "emperor_penguin", name: "Emperor penguin", country: "Antarctica", heightM: 1.15, heightNote: "Standing height of an adult.", category: "animal", tier: 2, funFact: "Males balance the egg on their feet for about two months without eating." },
  { id: "house_cat", name: "House cat (sitting)", country: "Everywhere", heightM: 0.3, heightNote: "Sitting, to the tips of the ears.", category: "animal", tier: 1, funFact: "Ancient Egyptians shaved their eyebrows to mourn a family cat." },
  { id: "chicken", name: "Chicken", country: "Everywhere", heightM: 0.4, heightNote: "Standing height of a typical hen, to the comb.", category: "animal", tier: 2, funFact: "There are more chickens on Earth than any other bird — over 20 billion." },
  { id: "red_kangaroo", name: "Red kangaroo (standing)", country: "Australia", heightM: 1.8, heightNote: "A large male standing upright.", category: "animal", tier: 3, funFact: "It can cover 8 m in a single hop." },
  { id: "dromedary_camel", name: "Dromedary camel", country: "Egypt & Arabia", heightM: 2.1, heightNote: "Height to the top of the hump.", category: "animal", tier: 2, funFact: "The hump stores fat, not water." },

  // ───────────── NATURE ─────────────
  { id: "mount_everest", name: "Mount Everest", country: "Nepal / China", heightM: 8849, heightNote: "Elevation above sea level (2020 survey).", category: "nature", tier: 1, funFact: "The summit rock is marine limestone — it was once the sea floor." },
  { id: "k2", name: "K2", country: "Pakistan / China", heightM: 8611, heightNote: "Elevation above sea level.", category: "nature", tier: 2, funFact: "Nicknamed the 'Savage Mountain' for its difficulty." },
  { id: "kilimanjaro", name: "Mount Kilimanjaro", country: "Tanzania", heightM: 5895, heightNote: "Elevation above sea level (Uhuru Peak).", category: "nature", tier: 1, funFact: "It is the tallest free-standing mountain on Earth." },
  { id: "mont_blanc", name: "Mont Blanc", country: "France / Italy", heightM: 4806, heightNote: "Elevation above sea level; the snow cap changes it by a metre or two each survey.", category: "nature", tier: 2, funFact: "Its height shrinks and grows with the thickness of its ice cap." },
  { id: "matterhorn", name: "Matterhorn", country: "Switzerland / Italy", heightM: 4478, heightNote: "Elevation above sea level.", category: "nature", tier: 2, funFact: "Its near-perfect pyramid shape inspired a famous chocolate logo." },
  { id: "mount_fuji", name: "Mount Fuji", country: "Japan", heightM: 3776, heightNote: "Elevation above sea level.", category: "nature", tier: 1, funFact: "It last erupted in 1707." },
  { id: "mauna_kea", name: "Mauna Kea", country: "USA (Hawaii)", heightM: 4207, heightNote: "Elevation above sea level; 10,211 m from its base on the ocean floor.", category: "nature", tier: 3, funFact: "Measured from its base, it is taller than Everest." },
  { id: "mount_sinai", name: "Mount Sinai (Jabal Musa)", country: "Egypt", heightM: 2285, heightNote: "Elevation above sea level.", category: "nature", tier: 2, funFact: "Pilgrims climb its 3,750 'Steps of Repentance' to watch the sunrise." },
  { id: "mount_catherine", name: "Mount Catherine", country: "Egypt", heightM: 2629, heightNote: "Elevation above sea level — Egypt's highest point.", category: "nature", tier: 3, funFact: "It stands only a few kilometres from Mount Sinai." },
  { id: "table_mountain", name: "Table Mountain", country: "South Africa", heightM: 1085, heightNote: "Elevation above sea level (Maclear's Beacon).", category: "nature", tier: 3, funFact: "When clouds pour over its flat top, locals call it the 'tablecloth'." },
  { id: "vesuvius", name: "Mount Vesuvius", country: "Italy", heightM: 1281, heightNote: "Elevation above sea level.", category: "nature", tier: 3, funFact: "Its eruption in AD 79 buried Pompeii." },
  { id: "uluru", name: "Uluru", country: "Australia", heightM: 348, heightNote: "Height above the surrounding plain (863 m above sea level).", category: "nature", tier: 2, funFact: "It changes colour from orange to deep red at sunset." },
  { id: "angel_falls", name: "Angel Falls", country: "Venezuela", heightM: 979, heightNote: "Total height of the falls — the world's tallest uninterrupted waterfall.", category: "nature", tier: 2, funFact: "The water often turns to mist before it reaches the bottom." },
  { id: "victoria_falls", name: "Victoria Falls", country: "Zambia / Zimbabwe", heightM: 108, heightNote: "Height of the drop at its deepest point.", category: "nature", tier: 2, funFact: "Locals call it 'The Smoke That Thunders'." },
  { id: "niagara_falls", name: "Niagara Falls (Horseshoe)", country: "Canada / USA", heightM: 57, heightNote: "Height of the Horseshoe Falls drop.", category: "nature", tier: 1, funFact: "About 2,400 tonnes of water go over every second." },
  { id: "hyperion_redwood", name: "Hyperion (tallest tree)", country: "USA (California)", heightM: 116, heightNote: "The tallest known living tree, a coast redwood (~116 m).", category: "nature", tier: 3, funFact: "Its exact location is kept secret to protect it." },
  { id: "general_sherman", name: "General Sherman tree", country: "USA (California)", heightM: 83.8, heightNote: "Height of the giant sequoia; the largest tree by volume.", category: "nature", tier: 3, funFact: "It is roughly 2,200 years old." },
  { id: "baobab", name: "Baobab tree", country: "Africa / Madagascar", heightM: 25, heightNote: "A large baobab (they rarely exceed ~25–30 m).", category: "nature", tier: 3, funFact: "A baobab trunk can store over 100,000 litres of water." },
  { id: "saguaro", name: "Saguaro cactus", country: "USA / Mexico", heightM: 12, heightNote: "A tall mature saguaro (record ~23 m).", category: "nature", tier: 3, funFact: "It may not grow its first arm until it is 50–100 years old." },
  { id: "old_faithful", name: "Old Faithful eruption", country: "USA (Yellowstone)", heightM: 40, heightNote: "Typical eruption height (32–56 m).", category: "nature", tier: 3, funFact: "It erupts roughly every 60–110 minutes." },

  // ───────────── VEHICLES ─────────────
  { id: "starship", name: "SpaceX Starship", country: "USA", heightM: 124, heightNote: "Full stack (booster + ship), current versions ~124 m.", category: "vehicle", tier: 2, funFact: "It is the tallest and most powerful rocket ever flown." },
  { id: "saturn_v", name: "Saturn V", country: "USA", heightM: 110.6, heightNote: "Full height including the launch escape tower.", category: "vehicle", tier: 1, funFact: "It carried every crew that walked on the Moon." },
  { id: "falcon_9", name: "Falcon 9", country: "USA", heightM: 70, heightNote: "Height with payload fairing (Block 5).", category: "vehicle", tier: 2, funFact: "Its first stage lands itself upright and flies again." },
  { id: "space_shuttle", name: "Space Shuttle stack", country: "USA", heightM: 56.1, heightNote: "Launch stack: orbiter, external tank and boosters.", category: "vehicle", tier: 2, funFact: "The big orange tank was the only part not reused." },
  { id: "airbus_a380", name: "Airbus A380", country: "Europe", heightM: 24.1, heightNote: "Height to the top of the tail fin.", category: "vehicle", tier: 1, funFact: "Its wing area could hold about 70 parked cars." },
  { id: "boeing_747", name: "Boeing 747", country: "USA", heightM: 19.4, heightNote: "Height to the top of the tail fin (747-400).", category: "vehicle", tier: 2, funFact: "The 747's famous hump started as a cargo-door workaround." },
  { id: "double_decker_bus", name: "Double-decker bus", country: "United Kingdom", heightM: 4.4, heightNote: "Typical London double-decker height.", category: "vehicle", tier: 1, funFact: "London buses are painted red so they're easy to spot in fog." },
  { id: "family_car", name: "Family car", country: "Everywhere", heightM: 1.45, heightNote: "Typical sedan roof height.", category: "vehicle", tier: 1, funFact: "There are well over a billion cars on the world's roads." },
  { id: "bicycle", name: "Bicycle", country: "Everywhere", heightM: 1.05, heightNote: "Typical adult bike, ground to handlebars.", category: "vehicle", tier: 1, funFact: "The bicycle is the most energy-efficient way humans travel." },
  { id: "bagger_288", name: "Bagger 288 excavator", country: "Germany", heightM: 96, heightNote: "Height of the bucket-wheel excavator.", category: "vehicle", tier: 3, funFact: "It is one of the largest land vehicles ever built, about 220 m long." },
  { id: "belaz_75710", name: "BelAZ 75710 dump truck", country: "Belarus", heightM: 8.2, heightNote: "Height of the world's largest dump truck.", category: "vehicle", tier: 3, funFact: "It can carry about 450 tonnes in one load." },
  { id: "hot_air_balloon", name: "Hot-air balloon", country: "Everywhere", heightM: 20, heightNote: "A typical sport balloon, envelope plus basket.", category: "vehicle", tier: 3, funFact: "The first passengers, in 1783, were a sheep, a duck and a rooster." },

  // ───────────── SPACE (diameters) ─────────────
  { id: "the_moon", name: "The Moon", country: "Space", heightM: 3_474_800, measure: "diameter", heightNote: "Mean diameter, 3,474.8 km.", category: "space", tier: 1, funFact: "It drifts about 3.8 cm farther from Earth every year." },
  { id: "earth", name: "Earth", country: "Space", heightM: 12_742_000, measure: "diameter", heightNote: "Mean diameter, 12,742 km.", category: "space", tier: 1, funFact: "If Earth were a billiard ball, it would be smoother than one." },
  { id: "mars", name: "Mars", country: "Space", heightM: 6_779_000, measure: "diameter", heightNote: "Mean diameter, 6,779 km.", category: "space", tier: 1, funFact: "A day on Mars is just 37 minutes longer than ours." },
  { id: "mercury", name: "Mercury", country: "Space", heightM: 4_879_000, measure: "diameter", heightNote: "Diameter, 4,879 km.", category: "space", tier: 2, funFact: "It is smaller than Jupiter's moon Ganymede." },
  { id: "venus", name: "Venus", country: "Space", heightM: 12_104_000, measure: "diameter", heightNote: "Diameter, 12,104 km.", category: "space", tier: 2, funFact: "A day on Venus is longer than its year." },
  { id: "jupiter", name: "Jupiter", country: "Space", heightM: 139_820_000, measure: "diameter", heightNote: "Mean diameter, 139,820 km.", category: "space", tier: 1, funFact: "Its Great Red Spot is a storm wider than Earth." },
  { id: "saturn", name: "Saturn", country: "Space", heightM: 116_460_000, measure: "diameter", heightNote: "Mean diameter of the planet, 116,460 km — rings not counted.", category: "space", tier: 1, funFact: "Saturn is less dense than water — it would float in a big enough bath." },
  { id: "uranus", name: "Uranus", country: "Space", heightM: 50_724_000, measure: "diameter", heightNote: "Mean diameter, 50,724 km.", category: "space", tier: 2, funFact: "It spins on its side." },
  { id: "neptune", name: "Neptune", country: "Space", heightM: 49_244_000, measure: "diameter", heightNote: "Mean diameter, 49,244 km.", category: "space", tier: 2, funFact: "Its winds are the fastest in the Solar System." },
  { id: "pluto", name: "Pluto", country: "Space", heightM: 2_376_600, measure: "diameter", heightNote: "Diameter, 2,376.6 km.", category: "space", tier: 2, funFact: "Pluto is narrower than the United States is wide." },
  { id: "ceres", name: "Ceres", country: "Space", heightM: 939_400, measure: "diameter", heightNote: "Mean diameter, 939.4 km.", category: "space", tier: 3, funFact: "It is the largest object in the asteroid belt." },
  { id: "ganymede", name: "Ganymede", country: "Space", heightM: 5_268_000, measure: "diameter", heightNote: "Diameter, 5,268 km.", category: "space", tier: 3, funFact: "The largest moon in the Solar System — bigger than Mercury." },
  { id: "phobos", name: "Phobos (moon of Mars)", country: "Space", heightM: 22_500, measure: "diameter", heightNote: "Mean diameter, about 22.5 km.", category: "space", tier: 3, funFact: "It is spiralling inward and will break apart in ~50 million years." },
  { id: "halley_nucleus", name: "Halley's Comet nucleus", country: "Space", heightM: 11_000, measure: "diameter", heightNote: "Mean diameter of the nucleus, about 11 km (it's 15 km long).", category: "space", tier: 4, funFact: "It returns every ~76 years — next in 2061." },
  { id: "olympus_mons", name: "Olympus Mons (Mars)", country: "Space", heightM: 21_900, heightNote: "Height above the Martian datum, ~21.9 km — the tallest volcano known.", category: "space", tier: 2, funFact: "It is so wide that from its summit the slope would vanish over the horizon." },
  { id: "the_sun", name: "The Sun", country: "Space", heightM: 1_392_700_000, measure: "diameter", heightNote: "Diameter, about 1.39 million km.", category: "space", tier: 1, funFact: "About 1.3 million Earths would fit inside it." },
  { id: "proxima_centauri", name: "Proxima Centauri", country: "Space", heightM: 214_500_000, measure: "diameter", heightNote: "Diameter, about 0.154 times the Sun's.", category: "space", tier: 3, funFact: "The closest star to the Sun, 4.24 light-years away." },
  { id: "sirius_a", name: "Sirius A", country: "Space", heightM: 2_381_000_000, measure: "diameter", heightNote: "Diameter, about 1.71 times the Sun's.", category: "space", tier: 3, funFact: "The brightest star in the night sky." },
  { id: "arcturus", name: "Arcturus", country: "Space", heightM: 35_300_000_000, measure: "diameter", heightNote: "Diameter, about 25 times the Sun's.", category: "space", tier: 4, funFact: "Its light was used to open the 1933 Chicago World's Fair." },
  { id: "betelgeuse", name: "Betelgeuse", country: "Space", heightM: 1_060_000_000_000, measure: "diameter", heightNote: "Diameter ~760 times the Sun's (estimates range ~640–1,000).", category: "space", tier: 3, funFact: "Placed where the Sun is, it would swallow the orbit of Mars." },
];
