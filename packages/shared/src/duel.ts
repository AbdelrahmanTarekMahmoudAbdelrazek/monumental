import { hashSeed, mulberry32 } from "./pairing";

/**
 * "Which is more?" duel mode: two cards side by side, tap the one with the higher
 * (or, for "older", the earlier) value. Server-scored like everything else.
 */

export type DuelCategoryId = "movies" | "celebs" | "older" | "area" | "population" | "rivers" | "heavier";

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
  rivers: { id: "rivers", label: "Longer river", question: "Which river is longer?", higherWins: true, emoji: "🏞️", source: "Commonly cited lengths; river lengths vary by source and measuring method.", minGap: rel(0.06) },
  heavier: { id: "heavier", label: "Which is heavier?", question: "Which animal is heavier?", higherWins: true, emoji: "⚖️", source: "Typical adult weight.", minGap: rel(0.15) },
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
  ["lotr2", "The Lord of the Rings: The Two Towers", "2002", 8.8, 1], ["star_wars", "Star Wars", "1977", 8.6, 1], ["empire_strikes", "The Empire Strikes Back", "1980", 8.7, 1],
  ["return_jedi", "Return of the Jedi", "1983", 8.3, 2], ["seven_samurai", "Seven Samurai", "1954", 8.6, 3], ["wonderful_life", "It's a Wonderful Life", "1946", 8.6, 3],
  ["city_of_god", "City of God", "2002", 8.6, 3], ["life_beautiful", "Life Is Beautiful", "1997", 8.6, 2], ["green_mile", "The Green Mile", "1999", 8.6, 1],
  ["pianist", "The Pianist", "2002", 8.5, 2], ["leon", "Léon: The Professional", "1994", 8.5, 2], ["usual_suspects", "The Usual Suspects", "1995", 8.5, 2],
  ["american_history_x", "American History X", "1998", 8.5, 2], ["fireflies", "Grave of the Fireflies", "1988", 8.5, 3], ["infinity_war", "Avengers: Infinity War", "2018", 8.4, 1],
  ["django", "Django Unchained", "2012", 8.5, 1], ["dk_rises", "The Dark Knight Rises", "2012", 8.4, 1], ["your_name", "Your Name", "2016", 8.4, 2],
  ["mononoke", "Princess Mononoke", "1997", 8.3, 2], ["across_spiderverse", "Spider-Man: Across the Spider-Verse", "2023", 8.5, 2], ["basterds", "Inglourious Basterds", "2009", 8.4, 2],
  ["memento", "Memento", "2000", 8.4, 2], ["toy_story3", "Toy Story 3", "2010", 8.3, 1], ["good_will", "Good Will Hunting", "1997", 8.3, 2],
  ["amelie", "Amélie", "2001", 8.3, 3], ["braveheart", "Braveheart", "1995", 8.3, 1], ["lion_desert", "Lion of the Desert", "1981", 8.3, 3],
  ["wolf_wall_st", "The Wolf of Wall Street", "2013", 8.2, 1], ["1917", "1917", "2019", 8.2, 2], ["shutter_island", "Shutter Island", "2010", 8.2, 1],
  ["truman_show", "The Truman Show", "1998", 8.2, 1], ["ratatouille", "Ratatouille", "2007", 8.1, 1], ["monsters_inc", "Monsters, Inc.", "2001", 8.1, 1],
  ["httyd", "How to Train Your Dragon", "2010", 8.1, 1], ["gone_girl", "Gone Girl", "2014", 8.1, 2], ["catch_me", "Catch Me If You Can", "2002", 8.1, 1],
  ["ford_ferrari", "Ford v Ferrari", "2019", 8.1, 2], ["gotg", "Guardians of the Galaxy", "2014", 8.0, 1], ["deadpool", "Deadpool", "2016", 8.0, 1],
  ["blade_runner_2049", "Blade Runner 2049", "2017", 8.0, 2], ["martian", "The Martian", "2015", 8.0, 1], ["zootopia", "Zootopia", "2016", 8.0, 1],
  ["iron_man", "Iron Man", "2008", 7.9, 1], ["knives_out", "Knives Out", "2019", 7.9, 2], ["dunkirk", "Dunkirk", "2017", 7.8, 2],
  ["eeaao", "Everything Everywhere All at Once", "2022", 7.8, 2], ["hangover", "The Hangover", "2009", 7.7, 1], ["superbad", "Superbad", "2007", 7.6, 2],
  ["moana", "Moana", "2016", 7.6, 1], ["avatar2", "Avatar: The Way of Water", "2022", 7.5, 1], ["tenet", "Tenet", "2020", 7.3, 2],
  ["encanto", "Encanto", "2021", 7.2, 1], ["transformers", "Transformers", "2007", 7.0, 1], ["jurassic_world", "Jurassic World", "2015", 6.9, 1],
  ["aquaman", "Aquaman", "2018", 6.8, 2], ["venom", "Venom", "2018", 6.6, 1], ["bvs", "Batman v Superman: Dawn of Justice", "2016", 6.5, 1],
  ["mamma_mia", "Mamma Mia!", "2008", 6.5, 2], ["cars2", "Cars 2", "2011", 6.2, 2], ["black_adam", "Black Adam", "2022", 6.2, 2],
  ["suicide_squad", "Suicide Squad", "2016", 5.9, 1], ["matrix4", "The Matrix Resurrections", "2021", 5.7, 2], ["fantastic4_2015", "Fantastic Four", "2015", 4.3, 3],
  ["last_airbender", "The Last Airbender", "2010", 4.0, 2], ["the_room", "The Room", "2003", 3.6, 3], ["sharknado", "Sharknado", "2013", 3.3, 3],
  ["battlefield_earth", "Battlefield Earth", "2000", 2.5, 3],
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
  ["giannis", "Giannis Antetokounmpo", "Basketball", 2.11, 2], ["curry", "Stephen Curry", "Basketball", 1.88, 1], ["kobe", "Kobe Bryant", "Basketball", 1.98, 1],
  ["brady", "Tom Brady", "American football", 1.93, 2], ["federer", "Roger Federer", "Tennis", 1.85, 1], ["djokovic", "Novak Djokovic", "Tennis", 1.88, 1],
  ["hamilton", "Lewis Hamilton", "Formula 1", 1.74, 1], ["tyson", "Mike Tyson", "Boxing", 1.78, 1], ["ali", "Muhammad Ali", "Boxing", 1.91, 1],
  ["mcgregor", "Conor McGregor", "MMA", 1.75, 2], ["khabib", "Khabib Nurmagomedov", "MMA", 1.78, 2], ["arnold", "Arnold Schwarzenegger", "Actor", 1.88, 1],
  ["will_smith", "Will Smith", "Actor", 1.88, 1], ["hemsworth", "Chris Hemsworth", "Actor", 1.90, 1], ["jackie_chan", "Jackie Chan", "Actor", 1.74, 1],
  ["depp", "Johnny Depp", "Actor", 1.78, 1], ["rdj", "Robert Downey Jr.", "Actor", 1.74, 1], ["tom_holland", "Tom Holland", "Actor", 1.73, 1],
  ["radcliffe", "Daniel Radcliffe", "Actor", 1.65, 2], ["margot", "Margot Robbie", "Actor", 1.68, 2], ["kidman", "Nicole Kidman", "Actor", 1.80, 2],
  ["gadot", "Gal Gadot", "Actor", 1.78, 2], ["beyonce", "Beyoncé", "Singer", 1.69, 1], ["rihanna", "Rihanna", "Singer", 1.73, 1],
  ["kim_k", "Kim Kardashian", "TV personality", 1.59, 2], ["bieber", "Justin Bieber", "Singer", 1.75, 1], ["sheeran", "Ed Sheeran", "Singer", 1.73, 2],
  ["drake", "Drake", "Rapper", 1.82, 2], ["einstein", "Albert Einstein", "Physicist", 1.75, 2], ["gandhi", "Mahatma Gandhi", "Indian leader", 1.64, 2],
  ["queen_elizabeth", "Queen Elizabeth II", "British monarch", 1.63, 2], ["trump", "Donald Trump", "US President", 1.90, 1], ["zuckerberg", "Mark Zuckerberg", "Entrepreneur", 1.71, 1],
  ["bezos", "Jeff Bezos", "Entrepreneur", 1.71, 2], ["van_dijk", "Virgil van Dijk", "Football", 1.95, 2], ["courtois", "Thibaut Courtois", "Football", 2.00, 2],
  ["crouch", "Peter Crouch", "Football", 2.01, 3], ["modric", "Luka Modrić", "Football", 1.72, 2], ["maradona", "Diego Maradona", "Football", 1.65, 1],
  ["pele", "Pelé", "Football", 1.73, 1], ["undertaker", "The Undertaker", "Wrestling", 2.08, 2], ["cena", "John Cena", "Wrestling", 1.85, 1],
  ["thor_bjornsson", "Hafþór Björnsson", "Strongman", 2.06, 3],
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
  ["gobekli_tepe", "Göbekli Tepe", "Oldest known temple", -9500, 3], ["sphinx", "Great Sphinx of Giza", "Ancient monument", -2500, 2], ["abu_simbel", "Abu Simbel temples", "Ancient Egypt", -1264, 2],
  ["great_wall", "Great Wall of China (first walls)", "Ancient China", -700, 2], ["hagia_sophia", "Hagia Sophia", "Built", 537, 2], ["angkor_wat", "Angkor Wat", "Built", 1150, 2],
  ["notre_dame", "Notre-Dame de Paris", "Construction began", 1163, 2], ["machu_picchu", "Machu Picchu", "Built", 1450, 2], ["mona_lisa", "Mona Lisa", "Painting began", 1503, 1],
  ["hamlet", "Shakespeare's Hamlet", "Written", 1600, 2], ["telescope", "Galileo's telescope", "Invention", 1609, 2], ["steam_engine", "Watt's steam engine", "Patented", 1769, 2],
  ["battery", "Electric battery", "Invented by Volta", 1800, 3], ["bicycle", "The bicycle", "First two-wheeler", 1817, 2], ["photograph", "The first photograph", "Taken by Niépce", 1826, 3],
  ["suez_canal", "Suez Canal", "Opened", 1869, 1], ["big_ben", "Big Ben", "Clock started", 1859, 2], ["car", "The first car", "Benz Motorwagen", 1886, 2],
  ["radio", "Radio", "Marconi's first transmission", 1895, 2], ["olympics", "Modern Olympic Games", "First held", 1896, 1], ["cairo_university", "Cairo University", "Founded", 1908, 2],
  ["penicillin", "Penicillin", "Discovered", 1928, 2], ["world_cup", "FIFA World Cup", "First held", 1930, 1], ["toyota", "Toyota", "Founded", 1937, 2],
  ["samsung", "Samsung", "Founded", 1938, 2], ["ikea", "IKEA", "Founded", 1943, 2], ["eniac", "ENIAC computer", "Completed", 1945, 3],
  ["nba", "The NBA", "Founded", 1946, 2], ["sony", "Sony", "Founded", 1946, 2], ["adidas", "Adidas", "Founded", 1949, 2],
  ["champions_league", "European Cup (Champions League)", "First season", 1955, 2], ["cairo_tower", "Cairo Tower", "Opened", 1961, 2], ["nike", "Nike", "Founded", 1964, 1],
  ["moon_landing", "Moon landing", "Apollo 11", 1969, 1], ["aswan_dam", "Aswan High Dam", "Completed", 1970, 2], ["starbucks", "Starbucks", "First store", 1971, 1],
  ["email", "The first email", "Sent", 1971, 3], ["mobile_call", "The first mobile phone call", "Made", 1973, 2], ["tetris", "Tetris", "Created", 1984, 2],
  ["mario", "Super Mario Bros.", "Released", 1985, 1], ["pokemon", "Pokémon (games)", "Released", 1996, 1], ["spotify", "Spotify", "Founded", 2006, 2],
  ["twitter", "Twitter", "Launched", 2006, 1], ["whatsapp", "WhatsApp", "Launched", 2009, 1], ["uber", "Uber", "Founded", 2009, 2],
  ["burj_khalifa", "Burj Khalifa", "Opened", 2010, 1], ["minecraft", "Minecraft", "Released", 2011, 1], ["snapchat", "Snapchat", "Launched", 2011, 2],
  ["fortnite", "Fortnite", "Released", 2017, 1],
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
  ["poland", "Poland", "Europe", 312_696, 2], ["vietnam", "Vietnam", "Asia", 331_212, 2], ["malaysia", "Malaysia", "Asia", 330_803, 2],
  ["oman", "Oman", "Asia", 309_500, 2], ["ecuador", "Ecuador", "South America", 283_561, 3], ["new_zealand", "New Zealand", "Oceania", 268_021, 2],
  ["uganda", "Uganda", "Africa", 241_550, 3], ["romania", "Romania", "Europe", 238_397, 3], ["ghana", "Ghana", "Africa", 238_533, 3],
  ["laos", "Laos", "Asia", 236_800, 3], ["belarus", "Belarus", "Europe", 207_600, 3], ["senegal", "Senegal", "Africa", 196_722, 3],
  ["cambodia", "Cambodia", "Asia", 181_035, 3], ["uruguay", "Uruguay", "South America", 176_215, 3], ["nepal", "Nepal", "Asia", 147_181, 2],
  ["cuba", "Cuba", "North America", 109_884, 2], ["iceland", "Iceland", "Europe", 103_000, 2], ["hungary", "Hungary", "Europe", 93_028, 3],
  ["azerbaijan", "Azerbaijan", "Asia", 86_600, 3], ["austria", "Austria", "Europe", 83_871, 2], ["czechia", "Czechia", "Europe", 78_867, 3],
  ["serbia", "Serbia", "Europe", 77_474, 3], ["croatia", "Croatia", "Europe", 56_594, 3], ["denmark", "Denmark", "Europe", 43_094, 2],
  ["bhutan", "Bhutan", "Asia", 38_394, 3], ["taiwan", "Taiwan", "Asia", 36_193, 2], ["israel", "Israel", "Asia", 22_072, 3],
  ["slovenia", "Slovenia", "Europe", 20_273, 3], ["palestine", "Palestine", "Asia", 6_020, 2], ["bahrain", "Bahrain", "Asia", 765, 2],
  ["singapore", "Singapore", "Asia", 734, 1], ["somalia", "Somalia", "Africa", 637_657, 3], ["zambia", "Zambia", "Africa", 752_612, 3],
  ["mozambique", "Mozambique", "Africa", 801_590, 3], ["namibia", "Namibia", "Africa", 825_615, 3], ["botswana", "Botswana", "Africa", 581_730, 3],
  ["cameroon", "Cameroon", "Africa", 475_442, 3], ["paraguay", "Paraguay", "South America", 406_752, 3], ["zimbabwe", "Zimbabwe", "Africa", 390_757, 3],
  ["turkmenistan", "Turkmenistan", "Asia", 488_100, 3], ["uzbekistan", "Uzbekistan", "Asia", 448_978, 3], ["kyrgyzstan", "Kyrgyzstan", "Asia", 199_951, 3],
  ["guyana", "Guyana", "South America", 214_969, 3],
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
  ["ukraine", "Ukraine", "Europe", 37.9, 2], ["angola", "Angola", "Africa", 37.9, 3], ["ghana", "Ghana", "Africa", 34.4, 3],
  ["madagascar", "Madagascar", "Africa", 31.9, 3], ["yemen", "Yemen", "Asia", 40.6, 3], ["nepal", "Nepal", "Asia", 29.7, 3],
  ["venezuela", "Venezuela", "South America", 28.4, 3], ["niger", "Niger", "Africa", 27.0, 3], ["syria", "Syria", "Asia", 24.7, 3],
  ["mali", "Mali", "Africa", 24.5, 3], ["sri_lanka", "Sri Lanka", "Asia", 23.1, 3], ["taiwan", "Taiwan", "Asia", 23.1, 2],
  ["chad", "Chad", "Africa", 20.3, 3], ["romania", "Romania", "Europe", 19.0, 3], ["senegal", "Senegal", "Africa", 18.5, 3],
  ["ecuador", "Ecuador", "South America", 18.1, 3], ["cambodia", "Cambodia", "Asia", 17.6, 3], ["bolivia", "Bolivia", "South America", 12.4, 3],
  ["belgium", "Belgium", "Europe", 11.8, 2], ["cuba", "Cuba", "North America", 11.0, 2], ["czechia", "Czechia", "Europe", 10.7, 3],
  ["azerbaijan", "Azerbaijan", "Asia", 10.3, 3], ["hungary", "Hungary", "Europe", 9.7, 3], ["israel", "Israel", "Asia", 9.4, 3],
  ["austria", "Austria", "Europe", 9.1, 2], ["belarus", "Belarus", "Europe", 9.1, 3], ["laos", "Laos", "Asia", 7.8, 3],
  ["libya", "Libya", "Africa", 7.4, 3], ["kyrgyzstan", "Kyrgyzstan", "Asia", 7.2, 3], ["serbia", "Serbia", "Europe", 6.7, 3],
  ["denmark", "Denmark", "Europe", 6.0, 2], ["singapore", "Singapore", "Asia", 5.9, 1], ["finland", "Finland", "Europe", 5.6, 2],
  ["palestine", "Palestine", "Asia", 5.5, 2], ["oman", "Oman", "Asia", 5.3, 2], ["new_zealand", "New Zealand", "Oceania", 5.2, 2],
  ["mauritania", "Mauritania", "Africa", 5.2, 3], ["uruguay", "Uruguay", "South America", 3.4, 3], ["slovenia", "Slovenia", "Europe", 2.1, 3],
  ["bahrain", "Bahrain", "Asia", 1.6, 2], ["guyana", "Guyana", "South America", 0.83, 3], ["bhutan", "Bhutan", "Asia", 0.79, 3],
  ["iceland", "Iceland", "Europe", 0.39, 2],
];

/** Kilometres. */
const RIVERS: Row[] = [
  ["nile", "Nile", "Africa", 6650, 1], ["amazon", "Amazon", "South America", 6400, 1], ["yangtze", "Yangtze", "China", 6300, 1],
  ["mississippi", "Mississippi–Missouri", "United States", 6275, 1], ["yenisei", "Yenisei", "Russia", 5539, 3], ["yellow", "Yellow River", "China", 5464, 2],
  ["ob", "Ob–Irtysh", "Russia / Kazakhstan", 5410, 3], ["parana", "Paraná", "South America", 4880, 3], ["congo", "Congo", "Africa", 4700, 2],
  ["amur", "Amur", "Russia / China", 4444, 3], ["lena", "Lena", "Russia", 4400, 3], ["mekong", "Mekong", "Southeast Asia", 4350, 2],
  ["mackenzie", "Mackenzie", "Canada", 4241, 3], ["niger", "Niger", "West Africa", 4180, 2], ["murray", "Murray–Darling", "Australia", 3672, 3],
  ["volga", "Volga", "Russia", 3531, 2], ["indus", "Indus", "Pakistan / India", 3180, 2], ["rio_grande", "Rio Grande", "USA / Mexico", 3051, 2],
  ["brahmaputra", "Brahmaputra", "South Asia", 2900, 3], ["danube", "Danube", "Europe", 2850, 1], ["euphrates", "Euphrates", "Middle East", 2800, 2],
  ["zambezi", "Zambezi", "Southern Africa", 2574, 2], ["ganges", "Ganges", "India / Bangladesh", 2525, 1], ["colorado", "Colorado River", "USA / Mexico", 2330, 2],
  ["tigris", "Tigris", "Middle East", 1850, 2], ["rhine", "Rhine", "Europe", 1230, 1], ["elbe", "Elbe", "Germany / Czechia", 1094, 3],
  ["loire", "Loire", "France", 1006, 3], ["seine", "Seine", "France", 777, 2], ["tiber", "Tiber", "Italy", 406, 2],
  ["thames", "Thames", "United Kingdom", 346, 1], ["jordan", "Jordan River", "Middle East", 251, 2],
];

/** Kilograms, typical adult. */
const HEAVIER: Row[] = [
  ["blue_whale", "Blue whale", "Ocean", 150_000, 1], ["orca", "Orca", "Ocean", 5_000, 1], ["african_elephant", "African elephant", "Savanna", 6_000, 1],
  ["white_rhino", "White rhinoceros", "Africa", 2_300, 2], ["hippo", "Hippopotamus", "Africa", 1_500, 1], ["giraffe", "Giraffe", "Africa", 1_200, 1],
  ["great_white", "Great white shark", "Ocean", 1_100, 1], ["saltwater_croc", "Saltwater crocodile", "Asia / Australia", 1_000, 2], ["cow", "Cow", "Farm", 700, 1],
  ["horse", "Horse", "Farm", 500, 1], ["camel", "Camel", "Desert", 500, 1], ["moose", "Moose", "North America", 450, 2],
  ["polar_bear", "Polar bear", "Arctic", 450, 1], ["grizzly", "Grizzly bear", "North America", 300, 2], ["tiger", "Tiger", "Asia", 220, 1],
  ["lion", "Lion", "Africa", 190, 1], ["gorilla", "Gorilla", "Central Africa", 160, 2], ["ostrich", "Ostrich", "Africa", 120, 2],
  ["panda", "Giant panda", "China", 110, 1], ["kangaroo", "Red kangaroo", "Australia", 85, 2], ["human", "Adult human", "Everywhere", 70, 1],
  ["emperor_penguin", "Emperor penguin", "Antarctica", 30, 2], ["labrador", "Labrador retriever", "Dog", 30, 1], ["koala", "Koala", "Australia", 9, 2],
  ["house_cat", "House cat", "Pet", 4.5, 1], ["chicken", "Chicken", "Farm", 2.5, 1], ["rabbit", "Rabbit", "Pet", 2, 2],
  ["bald_eagle", "Bald eagle", "North America", 4.5, 3], ["anaconda", "Green anaconda", "South America", 70, 3], ["komodo", "Komodo dragon", "Indonesia", 70, 3],
];

export const DUEL_ITEMS: DuelItem[] = [
  ...rows("movies", MOVIES),
  ...rows("celebs", CELEBS),
  ...rows("older", OLDER),
  ...rows("area", AREA, true),
  ...rows("population", POPULATION, true),
  ...rows("rivers", RIVERS),
  ...rows("heavier", HEAVIER),
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
    case "population": return v >= 1000 ? `${(v / 1000).toFixed(2)} billion` : v < 1 ? `${Math.round(v * 1000).toLocaleString("en-US")} thousand` : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} million`;
    case "rivers": return `${Math.round(v).toLocaleString("en-US")} km`;
    case "heavier": return v >= 1000 ? `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} tonnes` : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} kg`;
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
