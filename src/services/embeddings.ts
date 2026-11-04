/** Embeddings through Ollama: the movie text, one batch request, and the query side (wish and avoid texts). */
import type { EmbedQuery, Movie } from "../core/types";

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

/** Query vectors: the text with the model's query instruction (qwen3-embedding wants it on the query side only). */
export function createEmbedQuery(o: { url: string; model: string; queryPrefix: string; timeoutMs: number }): EmbedQuery {
  return async (text) => Float32Array.from((await embedTexts(o.url, o.model, [o.queryPrefix + text.trim()], o.timeoutMs))[0]);
}
