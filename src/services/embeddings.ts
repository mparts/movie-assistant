import type { Movie } from "../core/types";
import { isDebug } from "../core/util";

export interface Embedder {
  /** A 0..1 semantic relevance score per movie id (movies without a description are skipped). */
  score(profile: string, movies: Movie[]): Promise<Map<number, number>>;
}

/** Cosine similarity, mapped from [-1, 1] to [0, 1]. */
export function cosine01(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return Math.max(0, Math.min(1, (dot / Math.sqrt(aa * bb) + 1) / 2));
}

export interface EmbedderOptions {
  /** Full URL of Ollama's batch endpoint (…/api/embed). */
  url: string;
  model: string;
  queryPrefix: string;
  documentPrefix: string;
  batchSize: number;
  timeoutMs: number;
  /** Where movie-description vectors survive restarts. Without one, the cache lives only in memory. */
  store?: EmbeddingStore;
}

/** Persistent storage for description vectors. Both methods must never throw: a bad cache is an empty cache. */
export interface EmbeddingStore {
  /** Vectors saved earlier for this model, by key. Insertion order is age order (oldest first). */
  load(model: string): Map<string, number[]>;
  save(model: string, entries: Map<string, number[]>): void;
}

/**
 * The text a movie is embedded as: `title (year). Genres: … . overview Keywords: ….` The catalogue and movies embedded
 * on the spot must use exactly this, or their vectors are not comparable.
 */
export function movieText(m: Pick<Movie, "title" | "year" | "genres" | "overview">, keywords: string[], maxKeywords: number): string {
  const kw = keywords.slice(0, maxKeywords);
  return (
    `${m.title}${m.year ? ` (${m.year})` : ""}. Genres: ${m.genres.join(", ") || "none"}. ${m.overview.trim()}` +
    (kw.length ? ` Keywords: ${kw.join(", ")}.` : "")
  );
}

/** One request to Ollama's batch endpoint (…/api/embed). Long texts are truncated to the model's context. */
export async function embedTexts(url: string, model: string, texts: string[], timeoutMs: number): Promise<number[][]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts, truncate: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama embeddings HTTP ${res.status}`);
    const { embeddings } = (await res.json()) as { embeddings?: unknown };
    const valid =
      Array.isArray(embeddings) &&
      embeddings.length === texts.length &&
      embeddings.every((v) => Array.isArray(v) && v.length > 0 && v.every((n) => Number.isFinite(n)));
    if (!valid) throw new Error("Ollama returned invalid embeddings");
    return embeddings as number[][];
  } finally {
    clearTimeout(timer);
  }
}

/** Small non-cryptographic 53-bit hash (works in browser and Node): short, stable cache keys for long texts. */
export function hash53(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** One instance keeps an in-memory cache across turns; description vectors also go to the store, if any. */
export function createEmbedder(o: EmbedderOptions): Embedder {
  const cache = new Map<string, number[]>();
  /** Keys that belong in the store (descriptions repeat across sessions; the per-turn taste query does not). */
  const persisted = new Set<string>();
  let loaded = false;
  function loadStore() {
    if (loaded) return;
    loaded = true;
    for (const [key, vec] of o.store?.load(o.model) ?? []) {
      cache.set(key, vec);
      persisted.add(key);
    }
  }

  const embed = (texts: string[]) => embedTexts(o.url, o.model, texts, o.timeoutMs);

  interface Item { key: string; text: string; persist: boolean }

  /** Embeds only items not seen before, in batches; saves to the store when new descriptions were added. */
  async function vectors(items: Item[]): Promise<number[][]> {
    loadStore();
    const seen = new Set<string>();
    const missing = items.filter((i) => !cache.has(i.key) && !seen.has(i.key) && !!seen.add(i.key));
    for (let i = 0; i < missing.length; i += o.batchSize) {
      const batch = missing.slice(i, i + o.batchSize);
      (await embed(batch.map((b) => b.text))).forEach((v, j) => {
        cache.set(batch[j].key, v);
        if (batch[j].persist) persisted.add(batch[j].key);
      });
    }
    if (o.store && missing.some((m) => m.persist)) {
      o.store.save(o.model, new Map([...persisted].map((k) => [k, cache.get(k)!])));
    }
    if (isDebug()) console.log(`[embed] ${missing.length} new / ${items.length} texts`);
    return items.map((i) => cache.get(i.key)!);
  }

  return {
    async score(profile, movies) {
      const withText = movies.filter((m) => m.overview.trim());
      if (!profile.trim() || !withText.length) return new Map();
      const queryText = o.queryPrefix + profile.trim();
      const [query, ...docs] = await vectors([
        { key: `q:${queryText}`, text: queryText, persist: false },
        ...withText.map((m) => {
          const text = o.documentPrefix + m.overview.trim();
          return { key: `d:${hash53(text)}`, text, persist: true };
        }),
      ]);
      return new Map(withText.map((m, i) => [m.id, cosine01(query, docs[i])]));
    },
  };
}
