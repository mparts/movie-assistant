/**
 * The two cache file formats, checked the same way in Node (files) and the browser (through the dev server).
 * No I/O here, so the browser bundle can import it. Anything malformed is dropped: a bad cache is an empty cache.
 */

/** Where the dev server serves the cache files to the browser (vite.config.ts). */
export const cacheRoute = "/cache";

const validVector = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && Number.isFinite(n));

const validRuntime = (e: unknown): e is [number, number] =>
  Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && e[0] > 0 && Number.isInteger(e[1]) && e[1] > 0;

/** `{ model, entries: { key: vector } }`; vectors of another model are useless, so they count as none. */
export function embeddingsFrom(data: unknown, model: string): Map<string, number[]> {
  const d = data as { model?: unknown; entries?: unknown } | undefined;
  if (d?.model !== model || !d.entries || typeof d.entries !== "object") return new Map();
  return new Map(Object.entries(d.entries as Record<string, unknown>).filter((e): e is [string, number[]] => validVector(e[1])));
}

export const embeddingsFile = (model: string, entries: Map<string, number[]>, maxEntries: number) => ({
  model,
  entries: Object.fromEntries([...entries].slice(-maxEntries)),
});

/** `{ entries: [[id, minutes], ...] }`: a list, not an object, so age order survives a reload. */
export function runtimesFrom(data: unknown): Map<number, number> {
  const entries = (data as { entries?: unknown } | undefined)?.entries;
  return new Map(Array.isArray(entries) ? entries.filter(validRuntime) : []);
}

export const runtimesFile = (entries: Map<number, number>, maxEntries: number) => ({
  entries: [...entries].slice(-maxEntries),
});
