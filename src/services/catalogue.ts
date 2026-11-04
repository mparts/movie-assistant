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
  onKeywords?: (done: number, total: number) => void;
}

/**
 * A vector for every movie that has an overview (movies without one are left out of the result).
 * New movies get a record, keywords and a vector, saved to disk; known ones are read from the copy.
 */
export async function ensureVectors(
  movies: Movie[],
  c: Catalogue,
  tmdb: TmdbClient,
  opts: EnsureOptions = {}
): Promise<{ vectors: Map<number, Float32Array>; embedded: number }> {
  const withText = movies.filter((m) => m.overview?.trim());

  // Records: keep the newest copy of each movie; save only when a movie is new to the catalogue.
  let newRecords = 0;
  for (const m of withText) {
    if (!c.records.has(m.id)) newRecords++;
    const { runtime: _, ...rest } = m; // runtimes live in their own cache
    c.records.set(m.id, rest);
  }

  // Keywords for movies seen for the first time. A failed request is retried next time (the movie is embedded
  // without keywords now, and again once its keywords arrive, because its text changes).
  const needKeywords = withText.filter((m) => !Array.isArray(c.keywords[m.id]));
  for (let i = 0; i < needKeywords.length; i += 1000) {
    const chunk = needKeywords.slice(i, i + 1000);
    for (let j = 0; j < chunk.length; j += settings.search.walkConcurrency) {
      await Promise.all(
        chunk.slice(j, j + settings.search.walkConcurrency).map(async (m) => {
          try {
            c.keywords[m.id] = await tmdb.keywords(m.id);
          } catch {
            /* retried next time */
          }
        })
      );
    }
    writeJsonAtomic(cat.keywordsPath, c.keywords, "keyword cache");
    opts.onKeywords?.(Math.min(i + 1000, needKeywords.length), needKeywords.length);
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

  if (newRecords || todo.length) writeJsonAtomic(cat.recordsPath, { entries: [...c.records.values()] }, "catalogue");

  const vectors = new Map<number, Float32Array>();
  for (const m of withText) {
    const v = c.store.get(m.id);
    if (v) vectors.set(m.id, v);
  }
  return { vectors, embedded: todo.length };
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
