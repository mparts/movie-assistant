/** Tonight's movies (a resource of the dialogue, like a domain database; not part of the information state). */
import { settings } from "../config/settings";
import type { Movie } from "./types";

export interface Pool {
  /** Every movie that passes the Phase 1 filters and has a vector. */
  movies: Movie[];
  /** Embedding of each movie's text (`movieText`), by id. */
  vectors: Map<number, Float32Array>;
  /** Movies that were not in the catalogue yet and were embedded while loading. */
  embeddedNow: number;
  ms: number;
  /** Where the list of movies came from: the local copy, or a walk over TMDB. */
  source: "catalogue" | "tmdb";
}

/** Loads tonight's pool when Phase 1 ends. Node: the catalogue (or TMDB); browser: the dev server, which does the same. */
export type PoolLoader = (intake: import("./intake").Intake) => Promise<Pool>;

/** Enough movies to talk about, too few (the user may go anyway), or none at all. */
type PoolCheck = "ok" | "small" | "empty";

export const poolCheck = (pool: Pick<Pool, "movies">): PoolCheck =>
  pool.movies.length === 0 ? "empty" : pool.movies.length < settings.pool.minPool ? "small" : "ok";
