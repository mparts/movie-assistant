import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
// Explicit .ts extensions: Vite's coming native config loader requires them.
import { authHeaders, services } from "./src/config/services.ts";
import { settings } from "./src/config/settings.ts";
import { readJson, writeJsonAtomic } from "./src/services/jsonFile.ts";
import { cacheRoute, embeddingsFile, embeddingsFrom, poolVectorsRoute, runtimesFile, runtimesFrom } from "./src/services/cacheFormat.ts";
import { nodeVectorSource } from "./src/services/catalogue.ts";
import { createTmdb } from "./src/services/tmdb.ts";
import type { Movie } from "./src/core/types.ts";

/**
 * The browser's view of the on-disk caches in `.cache/` (the same files `npm run chat` uses).
 * GET returns a file, PUT replaces it. Only these two names; a PUT is re-checked with the same rules as a load,
 * so whatever the browser sends, the file stays well-formed.
 */
const caches: Record<string, { path: string; clean(data: unknown): unknown }> = {
  embeddings: {
    path: settings.embeddingCache.path,
    clean: (d) => {
      const model = (d as { model?: unknown })?.model;
      if (typeof model !== "string") throw new Error("no model");
      return embeddingsFile(model, embeddingsFrom(d, model), settings.embeddingCache.maxEntries);
    },
  },
  runtimes: {
    path: settings.runtimeCache.path,
    clean: (d) => runtimesFile(runtimesFrom(d), settings.runtimeCache.maxEntries),
  },
};

/** Only well-formed movies from the browser reach the catalogue on disk. */
const cleanMovies = (d: unknown): Movie[] =>
  (Array.isArray(d) ? d : []).filter(
    (m): m is Movie =>
      Number.isInteger(m?.id) && typeof m.title === "string" && typeof m.overview === "string" &&
      Array.isArray(m.genres) && m.genres.every((g: unknown) => typeof g === "string") &&
      (m.year === undefined || Number.isInteger(m.year)) && typeof m.votes === "number" && typeof m.rating === "number"
  );

function cacheEndpoint(env: Record<string, string>): Plugin {
  return {
    name: "disk-caches",
    configureServer(server) {
      /**
       * Tonight's pool from the browser (POST, JSON movies) → their vectors as Float32 rows, in the order sent, from
       * the local catalogue; movies missing from it are embedded here (same code as the typed chat). A movie without
       * a vector gets a row of zeros. Headers: x-dims, x-embedded.
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
            const { vectors, embedded } = await vectorsFor(movies);
            const dims = vectors.values().next().value?.length ?? 0;
            const out = new Float32Array(movies.length * dims);
            movies.forEach((m, i) => {
              const v = vectors.get(m.id);
              if (v) out.set(v, i * dims);
            });
            res.setHeader("content-type", "application/octet-stream");
            res.setHeader("x-dims", String(dims));
            res.setHeader("x-embedded", String(embedded));
            res.end(Buffer.from(out.buffer));
          } catch (e) {
            console.warn("[pool-vectors]", e);
            res.statusCode = 500;
            res.end(String((e as Error).message));
          }
        });
      });
      server.middlewares.use(cacheRoute, (req, res) => {
        const cache = caches[(req.url ?? "").replace(/^\//, "")];
        if (!cache) return void ((res.statusCode = 404), res.end());
        if (req.method === "GET") {
          const data = readJson(cache.path);
          if (data === undefined) return void ((res.statusCode = 404), res.end());
          res.setHeader("content-type", "application/json");
          return void res.end(JSON.stringify(data));
        }
        if (req.method !== "PUT") return void ((res.statusCode = 405), res.end());
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          try {
            writeJsonAtomic(cache.path, cache.clean(JSON.parse(Buffer.concat(chunks).toString("utf8"))), `${cache.path} (browser)`);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400; // file left untouched
          }
          res.end();
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
  return { server: { proxy }, plugins: [cacheEndpoint(env)] };
});
