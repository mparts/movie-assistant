/** Node-only helpers shared by the on-disk caches. Kept out of `index.ts` so the browser bundle never imports `node:fs`. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The parsed JSON file, or `undefined` if it is missing, unreadable, or not valid JSON. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Writes through a temp file + rename, so a crash never leaves half a file. Never throws: a failed save only warns. */
export function writeJsonAtomic(path: string, data: unknown, what: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
  } catch (e) {
    console.warn(`[${what} not saved]`, e);
  }
}
