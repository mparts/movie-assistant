/** Node-only file store for TMDB runtimes (movie id → minutes). */
import { readJson, writeJsonAtomic } from "./jsonFile";
import type { RuntimeStore } from "./tmdb";

const validEntry = (e: unknown): e is [number, number] =>
  Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && e[0] > 0 && Number.isInteger(e[1]) && e[1] > 0;

/**
 * One JSON file: `{ entries: [[id, minutes], ...] }`, a list (not an object) so age order survives a reload.
 * A runtime is a fact about the movie, so nothing invalidates it. The oldest entries are dropped beyond `maxEntries`.
 */
export function createRuntimeFileStore(path: string, maxEntries: number): RuntimeStore {
  return {
    load() {
      const data = readJson(path) as { entries?: unknown } | undefined;
      return new Map(Array.isArray(data?.entries) ? data.entries.filter(validEntry) : []);
    },
    save(entries) {
      writeJsonAtomic(path, { entries: [...entries].slice(-maxEntries) }, "runtime cache");
    },
  };
}
