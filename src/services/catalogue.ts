/**
 * The local copy of the movie catalogue (Node only): a record, keywords and a vector per movie, in `.cache/`.
 * `ensureVectors` is the one place that turns movies into vectors: from the copy when it has them, otherwise by
 * fetching keywords and embedding on the spot (then saved). Used by `embed-catalogue`, the typed chat and the
 * dev server (for the browser).
 */
import { embeddings as embCfg, services } from "../config/services";
import { settings } from "../config/settings";
import type { Movie, TmdbClient } from "../core/types";
import { embedTexts, hash53, movieText } from "./embeddings";
import { readJson, writeJsonAtomic } from "./jsonFile";
import { loadVectorStore, vectorStorePath, type VectorStore } from "./vectorStore";

const cat = settings.catalogue;

export interface Catalogue {
  records: Map<number, Movie>;
  keywords: Record<string, string[]>;
  store: VectorStore;
}

export function openCatalogue(): Catalogue {
  const raw = (readJson(cat.recordsPath) as { entries?: unknown } | undefined)?.entries;
  const records = new Map<number, Movie>(
    Array.isArray(raw) ? raw.filter((m): m is Movie => Number.isInteger(m?.id) && typeof m?.title === "string").map((m) => [m.id, m]) : []
  );
  const keywords = (readJson(cat.keywordsPath) ?? {}) as Record<string, string[]>;
  return { records, keywords, store: loadVectorStore(vectorStorePath(cat.vectorsPath, embCfg.model), embCfg.model) };
}

export interface EnsureOptions {
  /** Embedding progress (the catalogue script prints it). */
  onProgress?: (done: number, total: number) => void;
  onDetails?: (done: number, total: number) => void;
}

/** A record without details yet: `cast` is set (maybe empty) once a details call succeeded. */
const needsDetails = (m: Movie | undefined) => !m || !Array.isArray(m.cast);

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

  // Details (runtime, credits, keywords) for movies that have none yet. A failed request is retried next time:
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
    writeJsonAtomic(cat.recordsPath, { entries: [...c.records.values()] }, "catalogue");
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

  if (changed && !todoDetails.length) writeJsonAtomic(cat.recordsPath, { entries: [...c.records.values()] }, "catalogue");

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

/**
 * Pool vectors for a Node process: opens the 235 MB catalogue on first use and keeps it for later calls.
 * The typed chat and the dev server both use this.
 */
export function nodeVectorSource(tmdb: TmdbClient) {
  let catalogue: Catalogue | undefined;
  let queue = Promise.resolve() as Promise<unknown>;
  return (movies: Movie[]) => {
    // One at a time: two overlapping calls would save the same files concurrently.
    const run = queue.then(() => ensureVectors(movies, (catalogue ??= openCatalogue()), tmdb));
    queue = run.catch(() => undefined);
    return run;
  };
}
