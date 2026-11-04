/**
 * Movie vectors embedded ahead of time (`npm run embed-catalogue`), one pair of files per embedding model:
 *   `<base>.bin`  the vectors, Float32 rows back to back, in index order
 *   `<base>.json` the index: `{ model, dims, ids, hashes }` (hash of the embedded text, to notice changed texts)
 * Node only. Loaded whole into memory; saved whole, through temp files + rename. A missing, corrupt or other-model
 * pair counts as empty.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson } from "./jsonFile";

export interface VectorStore {
  readonly model: string;
  /** 0 until the first vector is added to an empty store. */
  readonly dims: number;
  readonly size: number;
  get(id: number): Float32Array | undefined;
  /** Hash of the text the stored vector was made from. */
  hash(id: number): string | undefined;
  put(id: number, hash: string, vector: number[]): void;
  save(): void;
}

/** `vectorsPath` from settings with the model filled in (`:` and `/` are not safe in file names). */
export const vectorStorePath = (pattern: string, model: string) => pattern.replace("<model>", model.replace(/[^a-z0-9.-]/gi, "_"));

export function loadVectorStore(base: string, model: string): VectorStore {
  const rows = new Map<number, { hash: string; vec: Float32Array }>();
  let dims = 0;

  const index = readJson(`${base}.json`) as { model?: unknown; dims?: unknown; ids?: unknown; hashes?: unknown } | undefined;
  try {
    if (index?.model === model && Number.isInteger(index.dims) && Array.isArray(index.ids) && Array.isArray(index.hashes)) {
      const d = index.dims as number;
      const ids = index.ids as number[];
      const buf = readFileSync(`${base}.bin`);
      if (index.hashes.length === ids.length && buf.byteLength >= ids.length * d * 4) {
        // Float32Array needs a 4-byte-aligned offset; small Buffers can come from a shared pool at any offset.
        const bytes = buf.byteOffset % 4 ? new Uint8Array(buf) : buf;
        const all = new Float32Array(bytes.buffer, bytes.byteOffset, ids.length * d);
        ids.forEach((id, i) => rows.set(id, { hash: String((index.hashes as unknown[])[i]), vec: all.subarray(i * d, (i + 1) * d) }));
        dims = d;
      }
    }
  } catch {
    /* no .bin: empty store */
  }

  return {
    model,
    get dims() {
      return dims;
    },
    get size() {
      return rows.size;
    },
    get: (id) => rows.get(id)?.vec,
    hash: (id) => rows.get(id)?.hash,
    put(id, hash, vector) {
      if (!dims) dims = vector.length;
      if (vector.length !== dims) throw new Error(`Vector of ${vector.length} dims in a ${dims}-dim store`);
      rows.set(id, { hash, vec: Float32Array.from(vector) });
    },
    save() {
      const ids = [...rows.keys()];
      const bin = new Float32Array(ids.length * dims);
      ids.forEach((id, i) => bin.set(rows.get(id)!.vec, i * dims));
      mkdirSync(dirname(base), { recursive: true });
      // Rows only ever append (a re-put id keeps its place), and the .bin is renamed first: after a crash between the
      // two renames the old index still describes a prefix of the new .bin, and a re-put row just gets re-embedded.
      const tmp = `.${process.pid}.tmp`;
      writeFileSync(`${base}.bin${tmp}`, new Uint8Array(bin.buffer));
      writeFileSync(`${base}.json${tmp}`, JSON.stringify({ model, dims, ids, hashes: ids.map((id) => rows.get(id)!.hash) }));
      renameSync(`${base}.bin${tmp}`, `${base}.bin`);
      renameSync(`${base}.json${tmp}`, `${base}.json`);
    },
  };
}
