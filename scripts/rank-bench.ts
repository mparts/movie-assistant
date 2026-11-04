/**
 * Ranking regression set: runs the real ranking (core/ranking.ts `rankPool`) on tonight's real pools for two sample
 * profiles, with hand-labelled wishes (scripts/rankBench-wishes.ts), and reports recall@10 and forbidden titles.
 * Uses TMDB, the local catalogue and local Ollama (query embeddings); no LLM calls.
 *
 *   npm run rank-bench              summary
 *   npm run rank-bench -- --verbose  plus every top 10
 *
 * "like X" cases compare: the liked movie alone (what "something like X" gives), the wish alone, both (the better
 * similarity of the two, as in production), and both plus a boost for TMDB's own recommendations for X.
 */
import { authHeaders, embeddings as embCfg, services } from "../src/config/services";
import { settings } from "../src/config/settings";
import { parseIntake, type Intake } from "../src/core/intake";
import type { Pool } from "../src/core/pool";
import { rankPool, type QueryVectors, type Scored } from "../src/core/ranking";
import { initialIS } from "../src/core/state";
import type { InformationState, Movie } from "../src/core/types";
import { ensureVectors, openCatalogue } from "../src/services/catalogue";
import { createEmbedQuery } from "../src/services/embeddings";
import { loadPool } from "../src/services/pool";
import { createTmdb } from "../src/services/tmdb";
import family from "../profiles/family.json";
import solo from "../profiles/solo.json";
import { loadEnv } from "./env";
import { ADULT, FAMILY, LIKE_ADULT, LIKE_FAMILY, type Wish } from "./rankBench-wishes";

const TOP = 10;
/** Bench-only: added to movies TMDB recommends for the liked movie (the "+recs" column). */
const RECS_BOOST = 0.15;
const verbose = process.argv.includes("--verbose");

const env = loadEnv();
const tmdb = createTmdb({ baseUrl: services.tmdb.upstream, headers: authHeaders(services.tmdb, env), ...settings.search });
const embedQuery = createEmbedQuery({
  url: services[embCfg.service].upstream + embCfg.path, model: embCfg.model, queryPrefix: embCfg.queryPrefix, timeoutMs: embCfg.timeoutMs,
});
const catalogue = openCatalogue();
const vectorsFor = (movies: Movie[]) => ensureVectors(movies, catalogue, tmdb);

/* ---- labels ---- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** "Robin Hood (1973)" pins the year; a plain title matches any year. */
function matches(label: string, m: Movie): boolean {
  const y = label.match(/\((\d{4})\)\s*$/);
  const title = y ? label.slice(0, y.index).trim() : label;
  return norm(title) === norm(m.title) && (!y || Number(y[1]) === m.year);
}
const isBad = (w: Wish, m: Movie) =>
  (w.bad ?? []).some((l) => matches(l, m)) ||
  (catalogue.keywords[m.id] ?? []).some((k) => (w.badKeywords ?? []).includes(k.toLowerCase()));

/* ---- running one case ---- */

type Result = { hits: number; of: number; bad: number; top: Scored[] };

function score(w: Wish, pool: Pool, ranked: Scored[]): Result {
  const top = ranked.slice(0, TOP);
  const inPool = pool.movies.filter((m) => w.good.some((l) => matches(l, m)));
  return {
    hits: top.filter((s) => w.good.some((l) => matches(l, s.movie))).length,
    of: Math.min(TOP, inPool.length),
    bad: top.filter((s) => isBad(w, s.movie)).length,
    top,
  };
}

/** The state the NLU would leave: the wish (unless left out), named genres, avoid texts, the liked movie. */
function stateFor(intake: Intake, w: Wish, opts: { wish: boolean; seed?: Movie }): InformationState {
  return {
    ...initialIS(intake),
    wish: opts.wish ? w.wish : "",
    genres: w.genres,
    avoid: w.avoid ?? [],
    seeds: opts.seed ? [opts.seed] : [],
  };
}

const vectorCache = new Map<string, Float32Array>();
async function query(text: string): Promise<Float32Array> {
  if (!vectorCache.has(text)) vectorCache.set(text, await embedQuery(text));
  return vectorCache.get(text)!;
}

async function queries(w: Wish, opts: { wish: boolean; seedVector?: Float32Array }): Promise<QueryVectors> {
  return {
    wish: opts.wish ? await query(w.wish) : undefined,
    seeds: opts.seedVector ? [opts.seedVector] : [],
    avoid: await Promise.all((w.avoid ?? []).map(query)),
  };
}

const pct = (r: { hits: number; of: number }) => (r.of ? `${Math.round((r.hits / r.of) * 100)}%` : "–");
const cell = (r: Result) => `${r.hits}/${r.of}${r.bad ? ` ✗${r.bad}` : ""}`;
const titles = (w: Wish, r: Result) =>
  r.top.map((s) => `${s.movie.title}${w.good.some((l) => matches(l, s.movie)) ? " ✓" : isBad(w, s.movie) ? " ✗" : ""}`).join(" · ");

async function main() {
  const suites = [
    { label: "Family", intake: parseIntake(family), wishes: FAMILY, likes: LIKE_FAMILY },
    { label: "Adult", intake: parseIntake(solo), wishes: ADULT, likes: LIKE_ADULT },
  ];
  const total = { hits: 0, of: 0, bad: 0 };
  const likeTotals: Record<string, { hits: number; of: number; bad: number }> = {};
  const add = (t: { hits: number; of: number; bad: number }, r: Result) => ((t.hits += r.hits), (t.of += r.of), (t.bad += r.bad));

  for (const s of suites) {
    const pool = await loadPool(s.intake, tmdb, vectorsFor);
    console.log(`\n## ${s.label}: ${pool.movies.length} movies in tonight's pool\n`);
    console.log(`| wish | hits | in pool |`);
    console.log(`|---|---|---|`);
    for (const w of s.wishes) {
      const r = score(w, pool, rankPool(stateFor(s.intake, w, { wish: true }), pool, await queries(w, { wish: true })));
      add(total, r);
      console.log(`| ${w.name} | ${cell(r)} | ${pool.movies.filter((m) => w.good.some((l) => matches(l, m))).length}/${w.good.length} |`);
      if (verbose) console.log(`|   | ${titles(w, r)} | |`);
    }

    console.log(`\n| like X | liked movie only | wish only | both (production) | both + TMDB recs |`);
    console.log(`|---|---|---|---|---|`);
    for (const w of s.likes) {
      const hit = await tmdb.searchMovie(w.like!);
      if (!hit) {
        console.log(`| ${w.name} | "${w.like}" not found | | | |`);
        continue;
      }
      const { movies, vectors } = await vectorsFor([hit]);
      const seed = movies[0] ?? hit;
      const seedVector = vectors.get(hit.id);
      const recs = new Set<number>(
        ((await (await fetch(`${services.tmdb.upstream}/movie/${hit.id}/recommendations?page=1`, { headers: authHeaders(services.tmdb, env) })).json())
          .results ?? []).map((r: { id: number }) => r.id)
      );
      const run = async (wish: boolean, withSeed: boolean, boostRecs = false) => {
        const ranked = rankPool(stateFor(s.intake, w, { wish, seed }), pool, await queries(w, { wish, seedVector: withSeed ? seedVector : undefined }));
        if (boostRecs) for (const x of ranked) if (recs.has(x.movie.id)) x.score += RECS_BOOST;
        return score(w, pool, ranked.sort((a, b) => b.score - a.score));
      };
      const cols = { "liked movie only": await run(false, true), "wish only": await run(true, false), both: await run(true, true), "+recs": await run(true, true, true) };
      for (const [k, r] of Object.entries(cols)) add((likeTotals[k] ??= { hits: 0, of: 0, bad: 0 }), r);
      console.log(`| ${w.name} | ${Object.values(cols).map(cell).join(" | ")} |`);
      if (verbose) for (const [k, r] of Object.entries(cols)) console.log(`|   ${k} | ${titles(w, r)} | | | |`);
    }
  }

  console.log(`\n**Wishes: recall@${TOP} ${pct(total)} (${total.hits}/${total.of}), forbidden in top ${TOP}: ${total.bad}**`);
  console.log(`**Like X:** ${Object.entries(likeTotals).map(([k, t]) => `${k} ${pct(t)} (✗${t.bad})`).join(" · ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
