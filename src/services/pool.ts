/** Loads tonight's movies when Phase 1 ends. Browser-safe: where the vectors come from is passed in. */
import type { Intake } from "../core/intake";
import type { Pool } from "../core/pool";
import { criteriaFromIS, initialIS } from "../core/state";
import type { Movie, TmdbClient } from "../core/types";

/** Vectors for these movies (Node: the local catalogue; browser: the dev server). Movies without one are left out. */
export type VectorSource = (movies: Movie[]) => Promise<{ vectors: Map<number, Float32Array>; embedded: number }>;

/** Asks TMDB which movies pass tonight's filters (always fresh: platforms change), then gets their vectors. */
export async function loadPool(intake: Intake, tmdb: TmdbClient, vectorsFor: VectorSource): Promise<Pool> {
  const t0 = performance.now();
  const found = await tmdb.pool(criteriaFromIS(initialIS(intake)));
  const { vectors, embedded } = await vectorsFor(found);
  return { movies: found.filter((m) => vectors.has(m.id)), vectors, embeddedNow: embedded, ms: performance.now() - t0 };
}
