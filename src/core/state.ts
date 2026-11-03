/** The information state: its initial value and read-only views of it. */
import { settings } from "../config/settings";
import { InformationState as IS, SearchCriteria } from "./types";
import { last } from "./util";

export const initialIS = (): IS => ({
  next_moves: [],
  private: { agenda: [], notices: [] },
  shared: {},
  history: [],
  readiness: { meaningfulTurns: 0, evidence: [] },
  prefs: { genres: [], required: [], seeds: [] },
  vibe: [],
  constraints: { runtime: {}, year: {} },
  dislikes: { genres: [] },
  candidates: [],
  recommended: [],
  rejected: [],
  recommendStreak: 0,
  search: { status: "idle", page: 1, noMore: false },
});

/** Taste = a genre/mood, a movie they like, or a vibe. Limits and dislikes alone are not taste. */
export const hasTaste = (is: IS) => is.prefs.genres.length > 0 || is.prefs.seeds.length > 0 || is.vibe.length > 0;

/** Anything at all worth searching on. */
export const hasSignal = (is: IS): boolean => {
  const c = is.constraints;
  return (
    hasTaste(is) ||
    is.dislikes.genres.length > 0 ||
    c.runtime.min !== undefined || c.runtime.max !== undefined ||
    c.year.min !== undefined || c.year.max !== undefined ||
    c.rating !== undefined || c.language !== undefined
  );
};

export function criteriaFromIS(is: IS, page: number = is.search.page): SearchCriteria {
  return {
    // Named genres are combined (AND); with none named, the mood/liked-movie genres are alternatives (OR).
    genres: is.prefs.required.length ? is.prefs.required : is.prefs.genres,
    matchAll: is.prefs.required.length > 0,
    excludeGenres: is.dislikes.genres,
    runtime: is.constraints.runtime,
    year: is.constraints.year,
    rating: is.constraints.rating,
    language: is.constraints.language,
    page,
  };
}

/** Compact view of what the system currently believes, for the LLM prompts. Empty fields are omitted. */
export function stateSummary(is: IS): Record<string, unknown> {
  const { runtime, year, rating, language } = is.constraints;
  const o: Record<string, unknown> = {};
  if (is.prefs.genres.length) o.wantedGenres = is.prefs.genres;
  if (is.prefs.seeds.length) o.likesMoviesLike = is.prefs.seeds.map((m) => m.title);
  if (is.vibe.length) o.vibe = is.vibe;
  if (is.dislikes.genres.length) o.avoidGenres = is.dislikes.genres;
  if (runtime.max !== undefined) o.maxRuntimeMinutes = runtime.max;
  if (runtime.min !== undefined) o.minRuntimeMinutes = runtime.min;
  if (year.min !== undefined) o.fromYear = year.min;
  if (year.max !== undefined) o.toYear = year.max;
  if (rating !== undefined) o.minRating = rating;
  if (language) o.originalLanguage = language;
  return o;
}

export const lastSuggested = (is: IS): string | null => last(is.recommended)?.title ?? null;

/** The user's positive taste as text: the query for semantic ranking, and context for the LLM. */
export function tasteProfile(is: IS): string | null {
  const chars = settings.dialogue.descriptionChars.seed;
  const parts: string[] = [];
  if (is.vibe.length) parts.push(`Desired feeling, atmosphere or themes: ${is.vibe.join("; ")}.`);
  if (is.prefs.genres.length) parts.push(`Preferred genres: ${is.prefs.genres.join(", ")}.`);
  if (is.prefs.seeds.length) {
    const liked = is.prefs.seeds.map(
      (m) => `${m.title} (${m.genres.join(", ")})${m.overview ? `: ${m.overview.slice(0, chars)}` : ""}`
    );
    parts.push(`Movies the user likes: ${liked.join("; ")}.`);
  }
  return parts.join(" ") || null;
}
