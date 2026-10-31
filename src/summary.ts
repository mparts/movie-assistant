import { InformationState } from "./types";

/** Compact view of what the system currently believes, for the LLM prompts. Empty fields are omitted. */
export function stateSummary(is: InformationState): Record<string, unknown> {
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

export const lastSuggested = (is: InformationState): string | null =>
  is.recommended.length ? is.recommended[is.recommended.length - 1].title : null;
