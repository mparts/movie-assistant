/**
 * Deterministic language tables: genre names and aliases, and languages. Moods are not here: they live in the wish,
 * which is ranked semantically. Values are genre NAMES as TMDB spells them; ids come from TMDB at runtime.
 */

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

const norm = (s: string) =>
  s.toLowerCase().trim().replace(/\s+(movies?|films?)$/, "");

/** A genre name or alias → canonical TMDB genre names ("romcom" → Romance and Comedy). [] if unknown. */
export function resolveGenres(text?: string): string[] {
  if (!text) return [];
  const t = norm(text);
  const exact = GENRES.find((g) => g.toLowerCase() === t);
  if (exact) return [exact];
  return GENRE_ALIASES[t] ? [GENRE_ALIASES[t]].flat() : [];
}

/** Every everyday word that names one of these genres: the genre itself and its aliases ("comedies"). Lowercase. */
export function wordsFor(genres: string[]): string[] {
  const wanted = new Set(genres);
  const words = new Set<string>(genres.map((g) => g.toLowerCase()));
  for (const [w, v] of Object.entries(GENRE_ALIASES)) if ([v].flat().some((g) => wanted.has(g))) words.add(norm(w));
  return [...words];
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
