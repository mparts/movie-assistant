import type { Movie } from "./types";

export interface Embedder {
  /** Returns a 0..1 semantic relevance score per candidate ID. */
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

/** One client instance keeps an in-memory cache across conversation turns. */
export function createOllamaEmbedder(options: {
  url: string;
  model?: string;
  timeoutMs?: number;
  batchSize?: number;
}): Embedder {
  const model = options.model ?? "nomic-embed-text";
  // nomic-embed-text is trained with task prefixes; without them query/document similarity is much weaker.
  const nomic = /nomic/i.test(model);
  const qPrefix = nomic ? "search_query: " : "";
  const dPrefix = nomic ? "search_document: " : "";
  const cache = new Map<string, number[]>();
  const batchSize = Math.max(1, options.batchSize ?? 16);

  async function embed(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Ollama embeddings HTTP ${response.status}`);
      const json: any = await response.json();
      if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length ||
          !json.embeddings.every((v: unknown) => Array.isArray(v) && v.length > 0 && v.every((n: unknown) => typeof n === "number" && Number.isFinite(n)))) {
        throw new Error("Ollama returned invalid embeddings");
      }
      return json.embeddings as number[][];
    } finally {
      clearTimeout(timer);
    }
  }

  async function vectors(texts: string[]): Promise<number[][]> {
    const missing = [...new Set(texts)].filter((t) => !cache.has(t));
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const result = await embed(batch);
      result.forEach((v, j) => cache.set(batch[j], v));
    }
    return texts.map((t) => cache.get(t)!);
  }

  return {
    async score(profile, movies) {
      const eligible = movies.filter((m) => m.overview.trim());
      if (!profile.trim() || !eligible.length) return new Map();
      const texts = [qPrefix + profile.trim(), ...eligible.map((m) => dPrefix + m.overview.trim())];
      const t0 = Date.now();
      const fresh = new Set(texts).size - [...new Set(texts)].filter((t) => cache.has(t)).length;
      const [query, ...descriptions] = await vectors(texts);
      const scores = new Map(eligible.map((m, i) => [m.id, cosine01(query, descriptions[i])]));
      if (typeof process === "undefined" || process.env?.DEBUG) {
        const top = [...scores].sort((a, b) => b[1] - a[1]).map(([id, v]) => `${eligible.find((m) => m.id === id)!.title}=${v.toFixed(3)}`);
        console.log(`[embed] ${fresh} new / ${texts.length} total, dim ${query.length}, ${Date.now() - t0}ms; best→worst: ${top.slice(0, 3)} … ${top.slice(-2)}`);
      }
      return scores;
    },
  };
}

