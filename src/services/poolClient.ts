/** The browser's side of the dev server's pool endpoint (vite.config.ts). */
import type { Intake } from "../core/intake.ts";
import type { PoolLoader } from "../core/pool.ts";
import type { Movie } from "../core/types.ts";

/** POST an intake → tonight's pool. */
export const poolRoute = "/pool";

/** The answer: movies as JSON (x-json-bytes long), zero-padded to 4 bytes, then Float32 rows. */
export const fetchPool: PoolLoader = async (intake: Intake) => {
  const t0 = performance.now();
  const res = await fetch(poolRoute, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intake) });
  if (!res.ok) throw new Error(`${poolRoute}: HTTP ${res.status} ${await res.text()}`);
  const dims = Number(res.headers.get("x-dims"));
  const jsonBytes = Number(res.headers.get("x-json-bytes"));
  const buf = await res.arrayBuffer();
  const movies: Movie[] = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 0, jsonBytes)));
  const start = jsonBytes + ((4 - (jsonBytes % 4)) % 4);
  if (buf.byteLength - start !== movies.length * dims * 4) throw new Error(`${poolRoute}: unexpected size`);
  const all = new Float32Array(buf, start, movies.length * dims);
  const vectors = new Map(movies.map((m, i) => [m.id, all.subarray(i * dims, (i + 1) * dims)] as const));
  const source = res.headers.get("x-source") === "catalogue" ? "catalogue" : "tmdb";
  return { movies, vectors, embeddedNow: Number(res.headers.get("x-embedded")) || 0, ms: performance.now() - t0, source };
};
