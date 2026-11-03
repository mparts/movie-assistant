/** Node-only file store for description vectors. Kept apart from `index.ts` so the browser bundle never imports `node:fs`. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EmbeddingStore } from "./embeddings";

const validVector = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * One JSON file: `{ model, entries }`. A missing, corrupt, or other-model file counts as empty.
 * Saves go through a temp file + rename, so a crash never leaves half a cache. The oldest entries are dropped
 * beyond `maxEntries`.
 */
export function createFileStore(path: string, maxEntries: number): EmbeddingStore {
  return {
    load(model) {
      try {
        const data = JSON.parse(readFileSync(path, "utf8"));
        if (data?.model !== model || !data.entries || typeof data.entries !== "object") return new Map();
        return new Map(Object.entries<unknown>(data.entries).filter((e): e is [string, number[]] => validVector(e[1])));
      } catch {
        return new Map();
      }
    },
    save(model, entries) {
      try {
        const kept = [...entries].slice(-maxEntries);
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ model, entries: Object.fromEntries(kept) }));
        renameSync(tmp, path);
      } catch (e) {
        console.warn("[embedding cache not saved]", e);
      }
    },
  };
}
