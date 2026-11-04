/**
 * Embeds the movie catalogue ahead of time: every TMDB movie with at least `catalogue.minVotes` votes and at least
 * `intake.minMinutes` minutes, so any Phase 1 pool is (nearly) all embedded already. Run again to top up: only new
 * movies get keywords fetched, and only new or changed texts get embedded. No LLM calls.
 *
 *   npm run embed-catalogue
 */
import { authHeaders, embeddings as embCfg, services } from "../src/config/services";
import { settings } from "../src/config/settings";
import { embedTexts, hash53, movieText } from "../src/services/embeddings";
import { readJson, writeJsonAtomic } from "../src/services/jsonFile";
import { loadVectorStore, vectorStorePath } from "../src/services/vectorStore";
import { loadEnv } from "./env";

const cat = settings.catalogue;
const headers = authHeaders(services.tmdb, loadEnv());
const t0 = Date.now();
const secs = (t = t0) => `${((Date.now() - t) / 1000).toFixed(0)}s`;

async function tmdb(path: string, params: Record<string, string> = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${services.tmdb.upstream}${path}?${new URLSearchParams(params)}`, { headers });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`TMDB ${path} HTTP ${res.status}`), { status: res.status });
    return res.json();
  }
}

/** Runs `f` over `xs`, `n` at a time. */
async function pooled<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(f))));
  return out;
}

/* ---- 1. walk TMDB, split by release years so no query passes TMDB's 500-page limit ---- */

const MAX_PAGES = 500;
const base = {
  include_adult: "false",
  include_video: "false",
  language: settings.search.language,
  // A stable order: popularity would shift while we page through it, skipping or repeating movies.
  sort_by: "primary_release_date.asc",
  "vote_count.gte": String(cat.minVotes),
  "with_runtime.gte": String(settings.intake.minMinutes),
};
const found = new Map<number, any>();
let pagesRead = 0;

async function walk(from: number, to: number): Promise<void> {
  const params = { ...base, "primary_release_date.gte": `${from}-01-01`, "primary_release_date.lte": `${to}-12-31` };
  const first = await tmdb("/discover/movie", { ...params, page: "1" });
  const total = first.total_pages ?? 1;
  if (total > MAX_PAGES && from < to) {
    const mid = Math.floor((from + to) / 2);
    await walk(from, mid);
    await walk(mid + 1, to);
    return;
  }
  if (total > MAX_PAGES) console.warn(`  ${from}: ${total} pages, only the first ${MAX_PAGES} are reachable`);
  const pages = Array.from({ length: Math.min(total, MAX_PAGES) - 1 }, (_, i) => String(i + 2));
  const rest = await pooled(pages, cat.concurrency, (page) => tmdb("/discover/movie", { ...params, page }));
  for (const d of [first, ...rest]) for (const r of d.results ?? []) found.set(r.id, r);
  pagesRead += 1 + pages.length;
}

const genres = await tmdb("/genre/movie/list", { language: "en" });
const genreName = new Map<number, string>((genres.genres as any[]).map((g) => [g.id, g.name]));
await walk(1900, new Date().getFullYear() + 1);
const movies = [...found.values()]
  .filter((r) => r.overview?.trim())
  .map((r) => ({
    id: r.id as number,
    title: r.title as string,
    year: r.release_date ? Number(String(r.release_date).slice(0, 4)) || undefined : undefined,
    genres: ((r.genre_ids ?? []) as number[]).flatMap((id) => (genreName.has(id) ? [genreName.get(id)!] : [])),
    overview: r.overview as string,
  }));
console.log(`TMDB: ${found.size} movies in ${pagesRead} pages (${found.size - movies.length} without an overview, skipped) · ${secs()}`);

/* ---- 2. keywords, only for movies not seen before ---- */

let t = Date.now();
const keywords = (readJson(cat.keywordsPath) ?? {}) as Record<string, string[]>;
const needKeywords = movies.filter((m) => !Array.isArray(keywords[m.id]));
const saveKeywords = () => writeJsonAtomic(cat.keywordsPath, keywords, "keyword cache");
for (let i = 0; i < needKeywords.length; i += 1000) {
  await pooled(needKeywords.slice(i, i + 1000), cat.concurrency, async (m) => {
    try {
      const d = await tmdb(`/movie/${m.id}/keywords`);
      keywords[m.id] = ((d.keywords ?? []) as any[]).map((k) => k.name);
    } catch (e) {
      if ((e as { status?: number }).status === 404) keywords[m.id] = []; // no keyword record: no keywords
      // anything else: left out, retried next run
    }
  });
  saveKeywords();
  console.log(`Keywords: ${Math.min(i + 1000, needKeywords.length)} / ${needKeywords.length} fetched · ${secs(t)}`);
}
if (!needKeywords.length) console.log("Keywords: all cached");

/* ---- 3. embed new or changed texts ---- */

t = Date.now();
const store = loadVectorStore(vectorStorePath(cat.vectorsPath, embCfg.model), embCfg.model);
const todo = movies
  .map((m) => {
    const text = embCfg.documentPrefix + movieText(m, keywords[m.id] ?? [], cat.maxKeywords);
    return { id: m.id, text, hash: hash53(text) };
  })
  .filter((x) => store.hash(x.id) !== x.hash);
console.log(`Vectors (${embCfg.model}): ${store.size} stored, ${todo.length} to embed`);

const url = services[embCfg.service].upstream + embCfg.path;
const batches = Math.ceil(todo.length / embCfg.batchSize);
for (let b = 0; b < batches; b++) {
  const batch = todo.slice(b * embCfg.batchSize, (b + 1) * embCfg.batchSize);
  const vecs = await embedTexts(url, embCfg.model, batch.map((x) => x.text), embCfg.timeoutMs);
  batch.forEach((x, i) => store.put(x.id, x.hash, vecs[i]));
  const done = b + 1;
  if (done % cat.saveEvery === 0 || done === batches) {
    store.save();
    const eta = ((Date.now() - t) / done) * (batches - done);
    console.log(`  ${Math.min(done * embCfg.batchSize, todo.length)} / ${todo.length} embedded · ${secs(t)} · about ${Math.ceil(eta / 60000)} min left`);
  }
}

console.log(`Done: ${store.size} vectors of ${store.dims || "?"} dims (${todo.length} new or changed) in ${secs()}`);
