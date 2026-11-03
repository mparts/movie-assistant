/** Scoring and ordering candidates: a transparent weighted baseline, optionally blended with embeddings. */
import { settings } from "../config/settings";
import { InformationState as IS, Movie } from "./types";

const { weights, ratingPrior, similarityMix, semanticWeight, neutral, runtimeFit: fit } = settings.ranking;

/** Ignore common description words so similarity reflects the plot, not filler. */
const STOP_WORDS = new Set(
  "a an and are as at be by for from has have he her his in into is it its of on or she that the their them there they this to was were who with you your".split(" ")
);
const words = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP_WORDS.has(w)));

/** Jaccard similarity: shared terms divided by distinct terms (0..1). */
function overlap<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Soft runtime fit; hard runtime limits are already applied by TMDB discovery. */
function runtimeFit(is: IS, movie: Movie): number {
  if (!movie.runtime || movie.runtime <= 0) return neutral; // unknown: neutral
  const { min, max } = is.constraints.runtime;
  if (min !== undefined && movie.runtime < min) return 0;
  if (max !== undefined && movie.runtime > max) return 0;
  if (min !== undefined && max !== undefined) {
    const mid = (min + max) / 2;
    return Math.max(0, 1 - Math.abs(movie.runtime - mid) / Math.max(fit.minHalfBand, (max - min) / 2));
  }
  if (max !== undefined) return Math.min(1, Math.max(0, (max - movie.runtime) / fit.rampMinutes + neutral));
  if (min !== undefined) return Math.min(1, Math.max(0, (movie.runtime - min) / fit.rampMinutes + neutral));
  return neutral; // no runtime preference: neutral
}

/** A transparent 0..1 score per factor, and the weighted total. */
export function movieScore(is: IS, movie: Movie) {
  const preferred = new Set(is.prefs.genres);
  const genres = preferred.size
    ? [...preferred].filter((g) => movie.genres.includes(g)).length / preferred.size
    : 0;

  const similarity = is.prefs.seeds.length
    ? Math.max(...is.prefs.seeds.map((seed) =>
        similarityMix.genres * overlap(new Set(movie.genres), new Set(seed.genres)) +
        similarityMix.text * overlap(words(movie.overview), words(seed.overview))
      ))
    : 0;

  const votes = Math.max(0, movie.votes || 0);
  const rating = Math.max(0, Math.min(1,
    ((votes * (movie.rating || 0) + ratingPrior.votes * ratingPrior.mean) / (votes + ratingPrior.votes)) / 10
  ));
  const runtime = runtimeFit(is, movie);
  const total =
    weights.genres * genres + weights.similarity * similarity + weights.rating * rating + weights.runtime * runtime;
  return { total, genres, similarity, rating, runtime };
}

/** Drop movies that may not be suggested (already suggested, rejected/seen, disliked genre). Keeps order. */
export function eligible(is: IS, movies: Movie[]): Movie[] {
  const out = new Set([...is.recommended.map((m) => m.id), ...is.rejected.map((r) => r.id)]);
  return movies.filter((m) => !out.has(m.id) && !m.genres.some((g) => is.dislikes.genres.includes(g)));
}

const byScore = (scored: { movie: Movie; index: number; score: number }[]) =>
  scored.sort((a, b) => b.score - a.score || a.index - b.index).map((x) => x.movie);

/** Eligible movies, best weighted score first (stable on ties). */
export const rank = (is: IS, movies: Movie[]): Movie[] =>
  byScore(eligible(is, movies).map((movie, index) => ({ movie, index, score: movieScore(is, movie).total })));

/** Blend embedding similarity into the weighted baseline. */
export function rankWithSemantics(is: IS, movies: Movie[], semantic: Map<number, number>): Movie[] {
  const pool = eligible(is, movies);
  const vals = pool.flatMap((m) => (semantic.has(m.id) ? [semantic.get(m.id)!] : []));
  if (!vals.length) return rank(is, movies);
  // Raw cosine scores cluster in a narrow band; stretch them over 0..1 so they can actually reorder candidates.
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : neutral);
  return byScore(pool.map((movie, index) => ({
    movie, index,
    score:
      semanticWeight * (semantic.has(movie.id) ? norm(semantic.get(movie.id)!) : 0) + // no overview: no invented match
      (1 - semanticWeight) * movieScore(is, movie).total,
  })));
}
