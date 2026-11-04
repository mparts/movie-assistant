/** The browser's side of the dev server's pool endpoints (vite.config.ts). */
import type { Intake } from "../core/intake";
import type { PoolLoader, VectorSource } from "../core/pool";
import type { Movie } from "../core/types";

/** POST movies → their catalogue copies and vectors (liked movies). */
export const poolVectorsRoute = "/pool-vectors";
/** POST an intake → tonight's pool. */
export const poolRoute = "/pool";

/** Both endpoints answer the same way: movies as JSON (x-json-bytes long), zero-padded to 4 bytes, then Float32 rows. */
async function post(route: string, body: unknown) {
  const res = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status} ${await res.text()}`);
  const dims = Number(res.headers.get("x-dims"));
  const jsonBytes = Number(res.headers.get("x-json-bytes"));
  const buf = await res.arrayBuffer();
  const movies: Movie[] = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 0, jsonBytes)));
  const start = jsonBytes + ((4 - (jsonBytes % 4)) % 4);
  if (buf.byteLength - start !== movies.length * dims * 4) throw new Error(`${route}: unexpected size`);
  const all = new Float32Array(buf, start, movies.length * dims);
  const vectors = new Map(movies.map((m, i) => [m.id, all.subarray(i * dims, (i + 1) * dims)] as const));
  return { movies, vectors, headers: res.headers };
}

export const fetchPool: PoolLoader = async (intake: Intake) => {
  const t0 = performance.now();
  const { movies, vectors, headers } = await post(poolRoute, intake);
  const source = headers.get("x-source") === "catalogue" ? "catalogue" : "tmdb";
  return { movies, vectors, embeddedNow: Number(headers.get("x-embedded")) || 0, ms: performance.now() - t0, source };
};

/** Liked movies: the catalogue's copy (with details) and vectors, embedded on the dev server if new. */
export const fetchPoolVectors: VectorSource = async (movies) => {
  const { movies: out, vectors, headers } = await post(poolVectorsRoute, movies);
  return { movies: out, vectors, embedded: Number(headers.get("x-embedded")) || 0 };
};
