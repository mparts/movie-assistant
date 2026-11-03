/**
 * Browser versions of the disk caches: the same `.cache/*.json` files as `npm run chat`, through the dev server
 * (`/cache/*`, see vite.config.ts). Fetched once at page start, because the stores' `load()` is synchronous.
 * Without the dev server (or on any error) the caches simply live in memory, as before.
 */
import { settings } from "../config/settings";
import type { EmbeddingStore } from "./embeddings";
import type { RuntimeStore } from "./tmdb";
import { cacheRoute, embeddingsFile, embeddingsFrom, runtimesFile, runtimesFrom } from "./cacheFormat";

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
