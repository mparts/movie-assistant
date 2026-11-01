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
}

/** One instance keeps an in-memory cache across conversation turns. */
export function createEmbedder(o: EmbedderOptions): Embedder {
  const cache = new Map<string, number[]>();

  async function embed(texts: string[]): Promise<number[][]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs);
    try {
      const res = await fetch(o.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: o.model, input: texts }),
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

  /** Embeds only texts not seen before, in batches. */
  async function vectors(texts: string[]): Promise<number[][]> {
    const missing = [...new Set(texts)].filter((t) => !cache.has(t));
    for (let i = 0; i < missing.length; i += o.batchSize) {
      const batch = missing.slice(i, i + o.batchSize);
      (await embed(batch)).forEach((v, j) => cache.set(batch[j], v));
    }
    if (isDebug()) console.log(`[embed] ${missing.length} new / ${texts.length} texts`);
    return texts.map((t) => cache.get(t)!);
  }

  return {
    async score(profile, movies) {
      const withText = movies.filter((m) => m.overview.trim());
      if (!profile.trim() || !withText.length) return new Map();
      const [query, ...docs] = await vectors([
        o.queryPrefix + profile.trim(),
        ...withText.map((m) => o.documentPrefix + m.overview.trim()),
      ]);
      return new Map(withText.map((m, i) => [m.id, cosine01(query, docs[i])]));
    },
  };
}
