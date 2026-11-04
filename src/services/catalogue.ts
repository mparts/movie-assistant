/**
 * The local copy of the movie catalogue (Node only): a record, keywords and a vector per movie, in `.cache/`.
 * `ensureVectors` is the one place that turns movies into vectors: from the copy when it has them, otherwise by
 * fetching details and embedding on the spot (then saved). `createNodePool` loads tonight's pool, from the copy when
 * it can (see there). Used by `embed-catalogue`, the typed chat and the dev server (for the browser).
 */
import { embeddings as embCfg, services } from "../config/services.ts";
import { settings } from "../config/settings.ts";
import type { Intake } from "../core/intake.ts";
import type { Pool } from "../core/pool.ts";
import { poolCriteria } from "../core/state.ts";
import type { Movie, SearchCriteria, TmdbClient } from "../core/types.ts";
import { embedTexts, hash53, movieText } from "./embeddings.ts";
import { readJson, writeJsonAtomic } from "./jsonFile.ts";
import { loadVectorStore, vectorStorePath, type VectorStore } from "./vectorStore.ts";

const cat = settings.catalogue;

/** What `embed-catalogue` walked, and when: every TMDB movie with at least `minVotes` votes and `minMinutes` minutes. */
interface Coverage {
  minVotes: number;
  minMinutes: number;
  /** ISO date of the walk. Movies released since its year are checked against TMDB at every pool. */
  updated: string;
}

interface Catalogue {
  records: Map<number, Movie>;
  keywords: Record<string, string[]>;
  store: VectorStore;
  /** Unknown (an older file): the copy is then never used as a pool on its own. */
  coverage?: Coverage;
}

export function openCatalogue(): Catalogue {
  const file = readJson(cat.recordsPath) as { entries?: unknown; coverage?: Coverage } | undefined;
  const raw = file?.entries;
  const records = new Map<number, Movie>(
    Array.isArray(raw) ? raw.filter((m): m is Movie => Number.isInteger(m?.id) && typeof m?.title === "string").map((m) => [m.id, m]) : []
  );
  const keywords = (readJson(cat.keywordsPath) ?? {}) as Record<string, string[]>;
  const cov = file?.coverage;
  const coverage = Number.isFinite(cov?.minVotes) && Number.isFinite(cov?.minMinutes) && typeof cov?.updated === "string" ? cov : undefined;
  return { records, keywords, coverage, store: loadVectorStore(vectorStorePath(cat.vectorsPath, embCfg.model), embCfg.model) };
}

export const saveRecords = (c: Catalogue) =>
  writeJsonAtomic(cat.recordsPath, { coverage: c.coverage, entries: [...c.records.values()] }, "catalogue");

interface EnsureOptions {
  /** Embedding progress (the catalogue script prints it). */
  onProgress?: (done: number, total: number) => void;
  onDetails?: (done: number, total: number) => void;
}

/** A record without details yet: `cast` and `certification` are set (maybe empty) once a details call succeeded. */
const needsDetails = (m: Movie | undefined) => !m || !Array.isArray(m.cast) || m.certification === undefined;

/**
 * The catalogue's copy of every movie that has an overview, with its vector (movies without one are left out).
 * Fresh TMDB fields (votes, rating) win over the stored ones; details (runtime, credits) come from the copy.
 * New movies get details, keywords and a vector, saved to disk.
 */
export async function ensureVectors(
  movies: Movie[],
  c: Catalogue,
  tmdb: TmdbClient,
  opts: EnsureOptions = {}
): Promise<{ movies: Movie[]; vectors: Map<number, Float32Array>; embedded: number }> {
  const withText = movies.filter((m) => m.overview?.trim());

  // Records: merge what TMDB just returned into the stored copy (which may hold details).
  let changed = 0;
  for (const m of withText) {
    if (!c.records.has(m.id)) changed++;
    const fresh = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as Partial<Movie>;
    c.records.set(m.id, { ...c.records.get(m.id), ...fresh } as Movie);
  }

  // Details (runtime, credits, US rating, keywords) for movies that have none yet. A failed request is retried next time:
  // the movie is embedded without keywords now, and again once they arrive, because its text changes.
  const todoDetails = withText.filter((m) => needsDetails(c.records.get(m.id)));
  const n = settings.search.walkConcurrency;
  for (let i = 0; i < todoDetails.length; i += 1000) {
    const chunk = todoDetails.slice(i, i + 1000);
    for (let j = 0; j < chunk.length; j += n) {
      await Promise.all(
        chunk.slice(j, j + n).map(async (m) => {
          try {
            const { keywords, ...details } = await tmdb.details(m.id);
            c.keywords[m.id] = keywords;
            c.records.set(m.id, { ...c.records.get(m.id)!, ...details });
            changed++;
          } catch {
            /* retried next time */
          }
        })
      );
    }
    writeJsonAtomic(cat.keywordsPath, c.keywords, "keyword cache");
    saveRecords(c);
    opts.onDetails?.(Math.min(i + 1000, todoDetails.length), todoDetails.length);
  }

  // Vectors for new or changed texts.
  const todo = withText
    .map((m) => {
      const text = embCfg.documentPrefix + movieText(m, c.keywords[m.id] ?? [], cat.maxKeywords);
      return { id: m.id, text, hash: hash53(text) };
    })
    .filter((x) => c.store.hash(x.id) !== x.hash);
  const url = services[embCfg.service].upstream + embCfg.path;
  const batches = Math.ceil(todo.length / embCfg.batchSize);
  for (let b = 0; b < batches; b++) {
    const batch = todo.slice(b * embCfg.batchSize, (b + 1) * embCfg.batchSize);
    const vecs = await embedTexts(url, embCfg.model, batch.map((x) => x.text), embCfg.timeoutMs);
    batch.forEach((x, i) => c.store.put(x.id, x.hash, vecs[i]));
    if ((b + 1) % cat.saveEvery === 0 || b + 1 === batches) {
      c.store.save();
      opts.onProgress?.(Math.min((b + 1) * embCfg.batchSize, todo.length), todo.length);
    }
  }

  if (changed && !todoDetails.length) saveRecords(c);

  const vectors = new Map<number, Float32Array>();
  const out: Movie[] = [];
  for (const m of withText) {
    const v = c.store.get(m.id);
    if (!v) continue;
    vectors.set(m.id, v);
    out.push(c.records.get(m.id)!);
  }
  return { movies: out, vectors, embedded: todo.length };
}

/* ---- tonight's pool ---- */

/** US ratings from mildest to strictest. NR (not rated) is left out, so it never fits under an age limit. */
const US_RATINGS = ["G", "PG", "PG-13", "R", "NC-17"];

/** Does the movie fit tonight's age limit? Without a limit every movie fits. Unrated or unknown ratings never fit under one. */
export function fitsRating(m: Movie, { certificationLte }: SearchCriteria): boolean {
  if (certificationLte === undefined) return true;
  const rank = US_RATINGS.indexOf(m.certification ?? "");
  return rank >= 0 && rank <= US_RATINGS.indexOf(certificationLte);
}

/**
 * Does the movie fit tonight by its own runtime? TMDB's runtime filter is loose (for "at most 120 minutes" it also
 * returns movies of 150), so every pool is checked against the runtime from the catalogue.
 */
const fitsRuntime = (m: Movie, { runtime }: SearchCriteria) =>
  m.runtime !== undefined && m.runtime >= (runtime.min ?? 0) && (runtime.max === undefined || m.runtime <= runtime.max);

/**
 * The pool from the local copy, or undefined when the copy cannot answer: platforms (they change weekly; only TMDB
 * knows), or filters wider than what the catalogue walked (fewer votes, shorter movies).
 */
export function localPool(c: Catalogue, criteria: SearchCriteria, minVotes: number): Movie[] | undefined {
  const cov = c.coverage;
  if (criteria.watch || !cov || minVotes < cov.minVotes || (criteria.runtime.min ?? 0) < cov.minMinutes) return undefined;
  return [...c.records.values()].filter(
    (m) =>
      m.votes >= minVotes &&
      fitsRuntime(m, criteria) &&
      !m.genres.some((g) => criteria.excludeGenres.includes(g)) &&
      fitsRating(m, criteria)
  );
}

/**
 * Tonight's pool for a Node process (the typed chat, and the dev server for the browser).
 * Opens the 235 MB catalogue on first use and keeps it. Without platforms the pool comes from the local copy, plus
 * one small TMDB walk over the movies released since the catalogue's last top-up year (new releases get details and
 * vectors on the spot and join the copy). With platforms, or filters wider than the copy, TMDB is walked. Either
 * way only movies whose own runtime fits tonight are kept.
 */
export function createNodePool(tmdb: TmdbClient, log: (line: string) => void = () => {}) {
  let catalogue: Catalogue | undefined;
  let queue = Promise.resolve() as Promise<unknown>;
  /** One at a time: two overlapping calls would save the same files concurrently. */
  const serial = <T>(f: (c: Catalogue) => Promise<T>): Promise<T> => {
    const run = queue.then(() => f((catalogue ??= openCatalogue())));
    queue = run.catch(() => undefined);
    return run;
  };

  const pool = (intake: Intake): Promise<Pool> =>
    serial(async (c) => {
      const t0 = performance.now();
      const criteria = poolCriteria(intake);
      const local = localPool(c, criteria, settings.search.minVotes);
      let movies: Movie[];
      if (local) {
        const since = Number(c.coverage!.updated.slice(0, 4));
        const recent = await tmdb.pool({ ...criteria, year: { min: since } });
        const known = new Set(local.map((m) => m.id));
        const added = recent.filter((m) => !known.has(m.id) && !c.records.has(m.id));
        if (added.length) log(`[pool] ${added.length} movies released since ${since} are new to the catalogue`);
        movies = [...local, ...added];
      } else movies = await tmdb.pool(criteria);
      const out = await ensureVectors(movies, c, tmdb);
      const fit = out.movies.filter((m) => fitsRuntime(m, criteria) && fitsRating(m, criteria));
      return { movies: fit, vectors: out.vectors, embeddedNow: out.embedded, ms: performance.now() - t0, source: local ? "catalogue" : "tmdb" };
    });

  /** The open catalogue (after the first pool or vectors call), e.g. for the bench's keyword labels. */
  const opened = () => (catalogue ??= openCatalogue());

  return { pool, catalogue: opened };
}
