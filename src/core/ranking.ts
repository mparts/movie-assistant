/**
 * Ranking tonight's pool. Pure and synchronous: the typed chat, the browser and `npm run rank-bench` all call this.
 *
 *   score = 0.8·semantic + 0.1·genres + 0.1·popularity − avoid − reject + person      (settings.ranking)
 *
 * Every term but `person` is a percentile within the movies still eligible, so the weights compare like with like.
 * semantic: similarity to the wish, or to a liked movie, whichever is higher. avoid / reject: a penalty only for the
 * movies most similar to an avoid text / a turned-down movie. person: a wanted actor or director is in it.
 */
import { settings } from "../config/settings";
import type { Pool } from "./pool";
import type { InformationState as IS, Movie } from "./types";

const R = settings.ranking;

/** The query side: vectors of the wish, the liked movies, and the avoid texts (any may be missing). */
export interface QueryVectors {
  wish?: Float32Array;
  seeds: Float32Array[];
  avoid: Float32Array[];
}

export interface Scored {
  movie: Movie;
  score: number;
  /** The terms, for "why this movie?" and the bench. */
  semantic: number;
  genres: number;
  popularity: number;
  avoid: number;
  reject: number;
  person: number;
}

/* ---- people ---- */

const nameWords = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Is this person (as the user named them: "Nolan", "Keanu Reeves") a director or top-billed actor of the movie? */
export function featuresPerson(movie: Movie, name: string): boolean {
  const said = nameWords(name);
  if (!said.length) return false;
  return [...(movie.directors ?? []), ...(movie.cast ?? [])].some((credit) => {
    const words = nameWords(credit);
    return said.every((w) => words.includes(w));
  });
}

/* ---- filters ---- */

/** Movies that may be suggested: not suggested, seen, turned down or liked already; inside every filter. */
export function eligible(is: IS, movies: Movie[]): Movie[] {
  const out = new Set([...is.recommended.map((m) => m.id), ...is.rejected.map((r) => r.id), ...is.seeds.map((m) => m.id)]);
  const { year, language } = is.constraints;
  const unwanted = is.people.filter((p) => p.negated);
  return movies.filter(
    (m) =>
      !out.has(m.id) &&
      !m.genres.some((g) => is.avoidGenres.includes(g)) &&
      !unwanted.some((p) => featuresPerson(m, p.name)) &&
      (year.min === undefined || (m.year !== undefined && m.year >= year.min)) &&
      (year.max === undefined || (m.year !== undefined && m.year <= year.max)) &&
      (!language || m.language === language)
  );
}

/* ---- similarity, cached per pool and query vector (both stay the same objects across turns) ---- */

const norms = new WeakMap<Float32Array, number>();
function norm(v: Float32Array): number {
  let n = norms.get(v);
  if (n === undefined) {
    n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n);
    norms.set(v, n);
  }
  return n;
}

/** Cosine similarity of `q` to every pool movie, aligned with `pool.movies` (0 for a movie without a vector). */
const simCache = new WeakMap<Pool, WeakMap<Float32Array, Float32Array>>();
function similarities(pool: Pool, q: Float32Array): Float32Array {
  let byQuery = simCache.get(pool);
  if (!byQuery) simCache.set(pool, (byQuery = new WeakMap()));
  let sims = byQuery.get(q);
  if (!sims) {
    sims = new Float32Array(pool.movies.length);
    const nq = norm(q);
    pool.movies.forEach((m, i) => {
      const v = pool.vectors.get(m.id);
      if (!v || v.length !== q.length || !nq) return;
      let dot = 0;
      for (let k = 0; k < v.length; k++) dot += q[k] * v[k];
      sims![i] = dot / (nq * norm(v));
    });
    byQuery.set(q, sims);
  }
  return sims;
}

/** Rank of each value among all of them, as 0..1 (the highest is 1). */
function percentiles(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const pct = new Array<number>(values.length);
  order.forEach(([, i], rank) => (pct[i] = values.length > 1 ? rank / (values.length - 1) : 1));
  return pct;
}

/** 0 below percentile `from`, rising to 1 at the top. */
const ramp = (pct: number, from: number) => Math.max(0, (pct - from) / (1 - from));

/** Every eligible movie of the pool, best first, with the terms of its score. */
export function rankPool(is: IS, pool: Pool, q: QueryVectors): Scored[] {
  const index = new Map(pool.movies.map((m, i) => [m.id, i]));
  const movies = eligible(is, pool.movies);
  /** Percentiles within the eligible movies of the similarity to `v`. */
  const pctOf = (v: Float32Array) => {
    const sims = similarities(pool, v);
    return percentiles(movies.map((m) => sims[index.get(m.id)!]));
  };

  const semanticSources = [...(q.wish ? [q.wish] : []), ...q.seeds].map(pctOf);
  const avoids = q.avoid.map(pctOf);
  const turnedDown = is.rejected.flatMap((r) => {
    const v = r.reason === "no" ? pool.vectors.get(r.id) : undefined;
    return v ? [pctOf(v)] : [];
  });
  const popularity = percentiles(movies.map((m) => m.votes));
  const wantedGenres = new Set(is.genres);
  const wantedPeople = is.people.filter((p) => !p.negated);

  const scored = movies.map((movie, i): Scored => {
    const semantic = semanticSources.length ? Math.max(...semanticSources.map((p) => p[i])) : 0;
    const genres = wantedGenres.size ? movie.genres.filter((g) => wantedGenres.has(g)).length / wantedGenres.size : 0;
    const avoid = Math.max(0, ...avoids.map((p) => R.avoid.weight * ramp(p[i], R.avoid.from)));
    const reject = Math.max(0, ...turnedDown.map((p) => R.reject.weight * ramp(p[i], R.reject.from)));
    const person = wantedPeople.some((p) => featuresPerson(movie, p.name)) ? R.person : 0;
    const score =
      R.weights.semantic * semantic + R.weights.genres * genres + R.weights.popularity * popularity[i] - avoid - reject + person;
    return { movie, score, semantic, genres, popularity: popularity[i], avoid, reject, person };
  });
  // Ties (e.g. no taste yet) keep the pool's order.
  return scored.sort((a, b) => b.score - a.score);
}
