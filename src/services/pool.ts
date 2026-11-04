/** Loads tonight's movies when Phase 1 ends. Browser-safe: where the vectors come from is passed in. */
import type { Intake } from "../core/intake";
import type { Pool, VectorSource } from "../core/pool";
import { poolCriteria } from "../core/state";
import type { TmdbClient } from "../core/types";

export type { VectorSource };
/** Asks TMDB which movies pass tonight's filters (always fresh: platforms change), then gets their vectors. */
export async function loadPool(intake: Intake, tmdb: TmdbClient, vectorsFor: VectorSource): Promise<Pool> {
  const t0 = performance.now();
  const found = await tmdb.pool(poolCriteria(intake));
  const { movies, vectors, embedded } = await vectorsFor(found);
  return { movies, vectors, embeddedNow: embedded, ms: performance.now() - t0 };
}
