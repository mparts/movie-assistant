/**
 * Labelled wishes for `npm run rank-bench` (first written for the step 5 spike). `said`: the user's own words. `wish`:
 * the same, rewritten as a movie description (what the NLU keeps). `avoid`: things to avoid, kept out of the wish.
 * `good`: titles that should reach the top 10 ("Robin Hood (1973)" pins a version). `bad` / `badKeywords`: titles or
 * TMDB keywords that must not. Family labels were written before the spike's round 3; adult labels were picked from a
 * genre-and-votes list, not from rankings.
 */
export type Wish = {
  name: string;
  said: string;
  wish: string;
  genres: string[];
  avoid?: string[];
  good: string[];
  bad?: string[];
  badKeywords?: string[];
};

export const FAMILY: Wish[] = [
  {
    name: "cozy, funny, talking animals",
    said: "something cozy and funny, maybe with talking animals",
    wish: "A heartwarming, funny animated story in which a group of talking animals goes on a cozy adventure together.",
    genres: ["Comedy", "Animation", "Family"],
    good: ["Zootopia", "Madagascar", "Lady and the Tramp", "The Aristocats", "One Hundred and One Dalmatians", "The Secret Life of Pets", "Robin Hood (1973)", "Fantastic Mr. Fox", "Kung Fu Panda", "Sing"],
  },
  {
    name: "epic family adventure, not scary",
    said: "an epic adventure the whole family enjoys, but nothing too scary",
    wish: "A grand family adventure: unlikely heroes travel through wondrous lands on an exciting quest, full of humor and heart.",
    genres: ["Adventure", "Family"],
    avoid: ["a frightening, dark and scary story with monsters and danger"],
    good: ["Up", "Moana", "How to Train Your Dragon", "Treasure Planet", "Onward", "The Emperor's New Groove", "Raya and the Last Dragon", "The Croods", "Finding Nemo"],
  },
  {
    name: "laugh and cry",
    said: "something that makes us laugh and cry",
    wish: "A touching, funny story about family, growing up and friendship, with big emotional moments that are both hilarious and sad.",
    genres: ["Comedy", "Drama", "Family"],
    good: ["Inside Out", "Coco", "Up", "Toy Story 3", "Luca", "Lilo & Stitch", "Inside Out 2", "Klaus", "Turning Red"],
  },
  {
    name: "mystery kids can follow",
    said: "a clever mystery the kids can follow",
    wish: "Young detectives follow clues to solve a puzzling mystery in a clever, fun and kid-friendly adventure.",
    genres: ["Mystery", "Family"],
    good: ["The Great Mouse Detective", "Scooby-Doo", "Zootopia", "The Great Muppet Caper", "Get a Clue", "Scooby-Doo 2: Monsters Unleashed"],
  },
  {
    name: "magical, but no princesses",
    said: "something magical and animated, but no princesses please",
    wish: "A magical animated adventure full of wonder, humor and enchanting creatures.",
    genres: ["Animation", "Fantasy", "Family"],
    avoid: ["princesses, royal balls, castles and fairy tales"],
    good: ["Spirited Away", "My Neighbor Totoro", "Onward", "How to Train Your Dragon", "Encanto", "Coco", "Kiki's Delivery Service", "Ponyo", "Monsters, Inc.", "Wish Dragon", "Castle in the Sky"],
    badKeywords: ["princess"],
  },
];

export const ADULT: Wish[] = [
  {
    name: "mind-bending sci-fi",
    said: "a mind-bending sci-fi that makes me think",
    wish: "A cerebral science fiction film whose twisting plot about time, memory or reality keeps you thinking long after it ends.",
    genres: ["Science Fiction"],
    good: ["Inception", "Tenet", "Looper", "Predestination", "Minority Report", "Mickey 17", "The Platform", "A.I. Artificial Intelligence", "The Cloverfield Paradox", "The Adam Project"],
  },
  {
    name: "gritty crime thriller",
    said: "a dark, gritty crime thriller",
    wish: "A tense, gritty crime thriller in which a detective hunts a ruthless killer or criminal through a dark city.",
    genres: ["Crime", "Thriller"],
    good: ["The Pale Blue Eye", "Nocturnal Animals", "The Town", "Uncut Gems", "The Irishman", "John Wick", "Inside Man", "American Psycho"],
  },
  {
    name: "feel-good romcom",
    said: "a light feel-good romantic comedy",
    wish: "A warm, witty romantic comedy where two people meet, clash, and slowly fall in love; light, charming and feel-good.",
    genres: ["Romance", "Comedy"],
    good: ["To All the Boys I've Loved Before", "Love Actually", "The Kissing Booth", "Bridget Jones's Diary", "Just Go with It", "Pride & Prejudice", "Set It Up", "Always Be My Maybe", "Love at First Sight", "The Kissing Booth 2"],
  },
  {
    name: "scary but not gory",
    said: "something scary with ghosts, but not gory",
    wish: "A creepy supernatural horror film full of suspense and dread, with a haunted house, a ghost or a demon.",
    genres: ["Horror"],
    avoid: ["graphic gore, blood, torture and slasher violence"],
    good: ["The Conjuring", "The Conjuring 2", "The Conjuring: The Devil Made Me Do It", "Annabelle", "Annabelle: Creation", "Annabelle Comes Home", "The Nun", "Ouija: Origin of Evil", "Under the Shadow", "The Blair Witch Project", "The Ritual"],
    badKeywords: ["gore", "slasher", "torture", "splatter"],
  },
  {
    name: "war epic",
    said: "a realistic war movie",
    wish: "A harrowing, realistic war film about soldiers on the battlefield and the brotherhood and sacrifice of combat.",
    genres: ["War"],
    good: ["Dunkirk", "Hacksaw Ridge", "1917", "All Quiet on the Western Front", "Da 5 Bloods", "Beasts of No Nation", "The Siege of Jadotville", "Mosul", "Midway", "Narvik", "The Forgotten Battle", "Sand Castle"],
  },
  {
    name: "inspiring true story",
    said: "an inspiring true story",
    wish: "An inspiring biographical drama based on a true story about a brilliant person who beats the odds to change their field.",
    genres: ["Drama", "History"],
    good: ["Bohemian Rhapsody", "The Blind Side", "The Aviator", "Hacksaw Ridge", "The Post", "The Boy Who Harnessed the Wind", "The Six Triple Eight", "Gandhi"],
  },
  {
    name: "clever fun heist",
    said: "a fun, clever heist movie",
    wish: "A slick, funny heist movie where a charming crew of thieves pulls off an elaborate, clever robbery.",
    genres: ["Crime", "Comedy"],
    good: ["Ocean's Eleven", "Inside Man", "Red Notice", "Fast Five", "The Town", "Army of Thieves", "Lift"],
  },
  {
    name: "quiet, melancholic drama",
    said: "something slow and melancholic, a quiet drama",
    wish: "A slow, beautiful and melancholic drama about loneliness, lost love and two people who briefly connect.",
    genres: ["Drama", "Romance"],
    good: ["Moonlight", "Marriage Story", "The Curious Case of Benjamin Button", "Atonement"],
  },
  {
    name: "anime for adults",
    said: "a beautiful anime movie for adults",
    wish: "A visually stunning Japanese anime film with a mature, poetic story about spirits, fate or growing up.",
    genres: ["Animation", "Fantasy"],
    good: ["Spirited Away", "Howl's Moving Castle", "Princess Mononoke", "Grave of the Fireflies", "Akira", "The Boy and the Heron", "My Neighbor Totoro", "Warriors of the Wind", "Castle in the Sky", "Kiki's Delivery Service"],
  },
  {
    name: "car chases, no superheroes",
    said: "lots of car chases, but no superhero stuff",
    wish: "A high-octane action movie full of thrilling car chases, getaway drivers and stunts on the open road.",
    genres: ["Action"],
    avoid: ["superheroes with superpowers, costumes and comic book villains"],
    good: ["Mad Max: Fury Road", "Furious 7", "Fast & Furious 6", "The Fast and the Furious", "Fast Five", "The Fate of the Furious", "2 Fast 2 Furious", "Fast & Furious", "The Fast and the Furious: Tokyo Drift", "Mission: Impossible - Fallout", "Extraction"],
    badKeywords: ["superhero", "based on comic", "marvel cinematic universe (mcu)", "dc extended universe (dceu)"],
  },
];
