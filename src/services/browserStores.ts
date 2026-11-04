/**
 * Browser versions of the disk caches: the same `.cache/*.json` files as `npm run chat`, through the dev server
 * (`/cache/*`, see vite.config.ts). Fetched once at page start, because the stores' `load()` is synchronous.
 * Without the dev server (or on any error) the caches simply live in memory, as before.
 */
import { settings } from "../config/settings";
import type { EmbeddingStore } from "./embeddings";
import type { RuntimeStore } from "./tmdb";
import { cacheRoute, embeddingsFile, embeddingsFrom, poolVectorsRoute, runtimesFile, runtimesFrom } from "./cacheFormat";
import type { VectorSource } from "./pool";

async function get(name: string): Promise<unknown> {
  try {
    const res = await fetch(`${cacheRoute}/${name}`);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Saves of one file go out one after another, so an older, smaller file never lands after a newer one. */
function saver(name: string) {
  let queue = Promise.resolve();
  return (body: unknown) => {
    queue = queue
      .then(() => fetch(`${cacheRoute}/${name}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
      .then(() => undefined, () => undefined); // a failed save only means re-embedding later
  };
}

export async function loadBrowserStores(): Promise<{ embeddingStore: EmbeddingStore; runtimeStore: RuntimeStore }> {
  const [embeddings, runtimes] = await Promise.all([get("embeddings"), get("runtimes")]);
  const saveEmbeddings = saver("embeddings");
  const saveRuntimes = saver("runtimes");
  return {
    embeddingStore: {
      load: (model) => embeddingsFrom(embeddings, model),
      save: (model, entries) => saveEmbeddings(embeddingsFile(model, entries, settings.embeddingCache.maxEntries)),
    },
    runtimeStore: {
      load: () => runtimesFrom(runtimes),
      save: (entries) => saveRuntimes(runtimesFile(entries, settings.runtimeCache.maxEntries)),
    },
  };
}

/** Tonight's vectors from the dev server, which reads the local catalogue and embeds anything missing. */
export const fetchPoolVectors: VectorSource = async (movies) => {
  const res = await fetch(poolVectorsRoute, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(movies),
  });
  if (!res.ok) throw new Error(`vectors HTTP ${res.status}`);
  const dims = Number(res.headers.get("x-dims"));
  const all = new Float32Array(await res.arrayBuffer());
  if (!dims && !all.length) return { vectors: new Map(), embedded: 0 }; // an empty pool, or nothing with a vector
  if (all.length !== movies.length * dims) throw new Error("vectors: unexpected size");
  const vectors = new Map<number, Float32Array>();
  movies.forEach((m, i) => {
    const v = all.subarray(i * dims, (i + 1) * dims);
    if (v.some((x) => x !== 0)) vectors.set(m.id, v); // a row of zeros = no vector
  });
  return { vectors, embedded: Number(res.headers.get("x-embedded")) || 0 };
};
