/** The browser's side of the dev server's pool endpoint (vite.config.ts). */
import type { VectorSource } from "../core/pool";
import type { Movie } from "../core/types";

/** Where the dev server answers with tonight's vectors. */
export const poolVectorsRoute = "/pool-vectors";

/** Tonight's movies (the catalogue's copy, with details) and their vectors, from the dev server (format: vite.config.ts). */
export const fetchPoolVectors: VectorSource = async (movies) => {
  const res = await fetch(poolVectorsRoute, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(movies),
  });
  if (!res.ok) throw new Error(`vectors HTTP ${res.status}`);
  const dims = Number(res.headers.get("x-dims"));
  const jsonBytes = Number(res.headers.get("x-json-bytes"));
  const buf = await res.arrayBuffer();
  const out: Movie[] = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 0, jsonBytes)));
  const start = jsonBytes + ((4 - (jsonBytes % 4)) % 4);
  if (buf.byteLength - start !== out.length * dims * 4) throw new Error("vectors: unexpected size");
  const all = new Float32Array(buf, start, out.length * dims);
  const vectors = new Map(out.map((m, i) => [m.id, all.subarray(i * dims, (i + 1) * dims)] as const));
  return { movies: out, vectors, embedded: Number(res.headers.get("x-embedded")) || 0 };
};
