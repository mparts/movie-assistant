/**
 * Deterministic language tables: what the system "knows" about moods, genre aliases and languages.
 * Values are genre NAMES as TMDB spells them; ids come from TMDB at runtime.
 */

export const MOODS: Record<string, string[]> = {
  exciting: ["Action", "Thriller", "Adventure"],
  "action-packed": ["Action", "Adventure"],
  thrilling: ["Thriller"],
  funny: ["Comedy"],
  hilarious: ["Comedy"],
  scary: ["Horror"],
  spooky: ["Horror"],
  romantic: ["Romance"],
  sad: ["Drama"],
  emotional: ["Drama"],
  "mind-bending": ["Science Fiction", "Mystery"],
  dark: ["Crime", "Thriller"],
  "feel-good": ["Comedy", "Family"],
  family: ["Family", "Animation"],
};

export const GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery",
  "Romance", "Science Fiction", "Thriller", "War", "Western",
];

/** Aliases may name a combination ("romcom"): every genre in it is required. */
const GENRE_ALIASES: Record<string, string | string[]> = {
  "sci-fi": "Science Fiction",
  "sci fi": "Science Fiction",
  scifi: "Science Fiction",
  "science-fiction": "Science Fiction",
  comedies: "Comedy",
  dramas: "Drama",
  thrillers: "Thriller",
  romcom: ["Romance", "Comedy"],
  "rom-com": ["Romance", "Comedy"],
  "rom com": ["Romance", "Comedy"],
  "romantic comedy": ["Romance", "Comedy"],
  "love story": "Romance",
  cartoon: "Animation",
  animated: "Animation",
  musical: "Music",
  detective: "Mystery",
  whodunit: "Mystery",
  "scary movie": "Horror",
};

/** "scarier" → "scary", etc. Anything else goes through MOODS after stripping "more ". */
const COMPARATIVES: Record<string, string> = {
  funnier: "funny",
  scarier: "scary",
  sadder: "sad",
  darker: "dark",
  spookier: "spooky",
};

const norm = (s: string) =>
  s.toLowerCase().trim().replace(/\s+(movies?|films?)$/, "");

/** Free text (mood or genre) → canonical TMDB genre names. [] if unknown. */
export function resolveGenres(text?: string): string[] {
  if (!text) return [];
  const t = norm(text);
  if (MOODS[t]) return MOODS[t];
  if (GENRE_ALIASES[t]) return [GENRE_ALIASES[t]].flat();
  const exact = GENRES.find((g) => g.toLowerCase() === t);
  return exact ? [exact] : [];
}

/**
 * Free text → genre names, and whether a movie must have ALL of them (`required`).
 * A named genre, an alias, or a mood with a single genre ("romantic" = Romance) is required:
 * "romantic comedy" means both. A mood with several genres ("exciting") offers alternatives.
 */
export function resolvePreference(text?: string): { names: string[]; required: boolean } {
  const t = text ? norm(text) : "";
  // "Family" is both a genre and a mood (Family, Animation): the genre name wins.
  const exact = GENRES.find((g) => g.toLowerCase() === t);
  if (exact) return { names: [exact], required: true };
  const names = resolveGenres(text);
  return { names, required: names.length > 0 && (!MOODS[t] || MOODS[t].length === 1) };
}

/** "funnier" / "more exciting" → genre names. */
export function resolveTone(direction: string): string[] {
  const t = norm(direction).replace(/^more\s+/, "");
  return resolveGenres(COMPARATIVES[t] ?? t);
}

const LANGUAGES: Record<string, string> = {
  english: "en", french: "fr", spanish: "es", german: "de", italian: "it",
  japanese: "ja", korean: "ko", swedish: "sv", hindi: "hi", chinese: "zh",
  portuguese: "pt", russian: "ru",
};

/** "Korean" → "ko"; 2-letter codes pass through; otherwise undefined. */
export function languageCode(text: string): string | undefined {
  const t = text.toLowerCase().trim();
  if (LANGUAGES[t]) return LANGUAGES[t];
  return /^[a-z]{2}$/.test(t) ? t : undefined;
}
