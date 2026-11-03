/** The runtime cache file (movie id → minutes). Checking is shared; disk access is Node-only (`createRuntimeFileStore`). */
import { readJson, writeJsonAtomic } from "./jsonFile";
import type { RuntimeStore } from "./tmdb";
import { runtimesFrom, runtimesFile } from "./cacheFormat";

/**
 * One JSON file. A runtime is a fact about the movie, so nothing invalidates it.
 * The oldest entries are dropped beyond `maxEntries`.
 */
export function createRuntimeFileStore(path: string, maxEntries: number): RuntimeStore {
  return {
    load: () => runtimesFrom(readJson(path)),
    save: (entries) => writeJsonAtomic(path, runtimesFile(entries, maxEntries), "runtime cache"),
  };
}
