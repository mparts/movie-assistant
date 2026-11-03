/** Node-only file store for description vectors. */
import type { EmbeddingStore } from "./embeddings";
import { readJson, writeJsonAtomic } from "./jsonFile";

const validVector = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * One JSON file: `{ model, entries }`. A missing, corrupt, or other-model file counts as empty.
 * The oldest entries are dropped beyond `maxEntries`.
 */
export function createFileStore(path: string, maxEntries: number): EmbeddingStore {
  return {
    load(model) {
      const data = readJson(path) as { model?: unknown; entries?: unknown } | undefined;
      if (data?.model !== model || !data.entries || typeof data.entries !== "object") return new Map();
      return new Map(Object.entries(data.entries as Record<string, unknown>).filter((e): e is [string, number[]] => validVector(e[1])));
    },
    save(model, entries) {
      writeJsonAtomic(path, { model, entries: Object.fromEntries([...entries].slice(-maxEntries)) }, "embedding cache");
    },
  };
}
