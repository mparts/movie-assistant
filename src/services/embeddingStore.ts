/** The embedding cache file: `{ model, entries }`. Checking is shared; disk access is Node-only (`createFileStore`). */
import type { EmbeddingStore } from "./embeddings";
import { readJson, writeJsonAtomic } from "./jsonFile";
import { embeddingsFrom, embeddingsFile } from "./cacheFormat";

/** One JSON file. A missing, corrupt, or other-model file counts as empty. The oldest entries are dropped beyond `maxEntries`. */
export function createFileStore(path: string, maxEntries: number): EmbeddingStore {
  return {
    load: (model) => embeddingsFrom(readJson(path), model),
    save: (model, entries) => writeJsonAtomic(path, embeddingsFile(model, entries, maxEntries), "embedding cache"),
  };
}
