import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
// Explicit .ts extensions: Vite's coming native config loader requires them.
import { authHeaders, services } from "./src/config/services.ts";
import { settings } from "./src/config/settings.ts";
import { poolRoute, poolVectorsRoute } from "./src/services/poolVectorsClient.ts";
import { createNodePool } from "./src/services/catalogue.ts";
import { parseIntake } from "./src/core/intake.ts";
import { createTmdb } from "./src/services/tmdb.ts";
import type { Movie } from "./src/core/types.ts";

/** Only well-formed movies from the browser reach the catalogue on disk. */
const cleanMovies = (d: unknown): Movie[] =>
  (Array.isArray(d) ? d : []).filter(
    (m): m is Movie =>
      Number.isInteger(m?.id) && typeof m.title === "string" && typeof m.overview === "string" &&
      Array.isArray(m.genres) && m.genres.every((g: unknown) => typeof g === "string") &&
      (m.year === undefined || Number.isInteger(m.year)) && typeof m.votes === "number" && typeof m.rating === "number"
  );

/** Read a request body as JSON. */
const jsonBody = (req: import("node:http").IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
  });

/**
 * Tonight's pool and liked movies for the browser, from the same Node code as the typed chat (src/services/catalogue.ts):
 *   POST /pool          an intake  → tonight's pool (local catalogue or TMDB, embedded on the spot if new)
 *   POST /pool-vectors  movies     → their catalogue copies and vectors
 * Answer: the movies as JSON (x-json-bytes long), zero-padded to a multiple of 4 bytes, then one Float32 row
 * (x-dims long) per movie, in the same order.
 */
function poolEndpoint(env: Record<string, string>): Plugin {
  let node: ReturnType<typeof createNodePool> | undefined;
  const nodePool = () =>
    (node ??= createNodePool(createTmdb({ baseUrl: services.tmdb.upstream, headers: authHeaders(services.tmdb, env), ...settings.search }), console.log));

  function send(res: import("node:http").ServerResponse, movies: Movie[], vectors: Map<number, Float32Array>, headers: Record<string, string>) {
    const dims = vectors.values().next().value?.length ?? 0;
    const json = Buffer.from(JSON.stringify(movies), "utf8");
    const rows = new Float32Array(movies.length * dims);
    movies.forEach((m, i) => rows.set(vectors.get(m.id)!, i * dims));
    res.setHeader("content-type", "application/octet-stream");
    for (const [k, v] of Object.entries({ ...headers, "x-dims": String(dims), "x-json-bytes": String(json.length) })) res.setHeader(k, v);
    res.end(Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4), Buffer.from(rows.buffer)]));
  }

  const handle =
    (work: (body: unknown) => Promise<void>) =>
    (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
      if (req.method !== "POST") return void ((res.statusCode = 405), res.end());
      jsonBody(req)
        .then(work)
        .catch((e) => {
          console.warn(`[${req.url}]`, e);
          res.statusCode = 500;
          res.end(String((e as Error).message));
        });
    };

  return {
    name: "pool",
    configureServer(server) {
      server.middlewares.use(poolRoute, (req, res) =>
        handle(async (body) => {
          const pool = await nodePool().pool(parseIntake(body));
          send(res, pool.movies, pool.vectors, { "x-source": pool.source, "x-embedded": String(pool.embeddedNow) });
        })(req, res)
      );
      server.middlewares.use(poolVectorsRoute, (req, res) =>
        handle(async (body) => {
          const out = await nodePool().vectorsFor(cleanMovies(body));
          send(res, out.movies, out.vectors, { "x-embedded": String(out.embedded) });
        })(req, res)
      );
    },
  };
}

/**
 * Dev-server proxy, generated from src/config/services.ts: the browser calls `proxy` prefixes,
 * this forwards them to each `upstream` and adds the secret, so keys never reach the browser.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy: Record<string, ProxyOptions> = {};
  for (const [name, s] of Object.entries(services)) {
    const url = new URL(s.upstream);
    let headers: Record<string, string> | undefined;
    try {
      headers = authHeaders(s, env);
    } catch (e) {
      console.warn(`[proxy ${name}] ${(e as Error).message}`);
    }
    proxy[s.proxy] = {
      target: url.origin,
      changeOrigin: true,
      rewrite: (p) => p.replace(new RegExp(`^${s.proxy}`), url.pathname.replace(/\/$/, "")),
      headers,
    };
  }
  return { server: { proxy }, plugins: [poolEndpoint(env)] };
});
