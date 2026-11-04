import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
// Explicit .ts extensions: Vite's coming native config loader requires them.
import { authHeaders, services } from "./src/config/services.ts";
import { settings } from "./src/config/settings.ts";
import { poolVectorsRoute } from "./src/services/poolVectorsClient.ts";
import { nodeVectorSource } from "./src/services/catalogue.ts";
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

function poolEndpoint(env: Record<string, string>): Plugin {
  return {
    name: "pool-vectors",
    configureServer(server) {
      /**
       * Tonight's pool from the browser (POST, JSON movies) → the catalogue's copy of those movies (with details) and
       * their vectors, from the local catalogue; movies missing from it are embedded here (same code as the typed chat).
       * Body: the movies as JSON (x-json-bytes long), zero-padded to a multiple of 4 bytes, then one Float32 row
       * (x-dims long) per movie, in the same order. Movies without a vector are left out.
       */
      let vectorsFor: ReturnType<typeof nodeVectorSource> | undefined;
      server.middlewares.use(poolVectorsRoute, (req, res) => {
        if (req.method !== "POST") return void ((res.statusCode = 405), res.end());
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", async () => {
          try {
            const movies = cleanMovies(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            vectorsFor ??= nodeVectorSource(
              createTmdb({ baseUrl: services.tmdb.upstream, headers: authHeaders(services.tmdb, env), ...settings.search })
            );
            const out = await vectorsFor(movies);
            const dims = out.vectors.values().next().value?.length ?? 0;
            const json = Buffer.from(JSON.stringify(out.movies), "utf8");
            const pad = (4 - (json.length % 4)) % 4;
            const rows = new Float32Array(out.movies.length * dims);
            out.movies.forEach((m, i) => rows.set(out.vectors.get(m.id)!, i * dims));
            res.setHeader("content-type", "application/octet-stream");
            res.setHeader("x-dims", String(dims));
            res.setHeader("x-json-bytes", String(json.length));
            res.setHeader("x-embedded", String(out.embedded));
            res.end(Buffer.concat([json, Buffer.alloc(pad), Buffer.from(rows.buffer)]));
          } catch (e) {
            console.warn("[pool-vectors]", e);
            res.statusCode = 500;
            res.end(String((e as Error).message));
          }
        });
      });
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
