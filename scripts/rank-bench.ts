/**
 * Ranking regression set: runs the real ranking (core/ranking.ts `rankPool`) on tonight's real pools for two sample
 * profiles, with hand-labelled wishes (scripts/rankBench-wishes.ts), and reports recall@10 and forbidden titles.
 * Uses TMDB, the local catalogue and local Ollama (query embeddings); no LLM calls.
 *
 *   npm run rank-bench              summary
 *   npm run rank-bench -- --verbose  plus every top 10
 */
import { authHeaders, embeddings as embCfg, services } from "../src/config/services";
import { settings } from "../src/config/settings";
import { parseIntake, type Intake } from "../src/core/intake";
import type { Pool } from "../src/core/pool";
import { rankPool, type QueryVectors, type Scored } from "../src/core/ranking";
import { initialIS } from "../src/core/state";
import type { InformationState, Movie } from "../src/core/types";
import { createNodePool } from "../src/services/catalogue";
import { createEmbedQuery } from "../src/services/embeddings";
import { createTmdb } from "../src/services/tmdb";
import family from "../profiles/family.json";
import solo from "../profiles/solo.json";
import { loadEnv } from "./env";
import { ADULT, FAMILY, type Wish } from "./rankBench-wishes";

const TOP = 10;
const verbose = process.argv.includes("--verbose");

const env = loadEnv();
const tmdb = createTmdb({ baseUrl: services.tmdb.upstream, headers: authHeaders(services.tmdb, env), ...settings.search });
const embedQuery = createEmbedQuery({
  url: services[embCfg.service].upstream + embCfg.path, model: embCfg.model, queryPrefix: embCfg.queryPrefix, timeoutMs: embCfg.timeoutMs,
});
const { pool: loadPool, catalogue } = createNodePool(tmdb, console.log);

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
  (catalogue().keywords[m.id] ?? []).some((k) => (w.badKeywords ?? []).includes(k.toLowerCase()));

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

/** The state the NLU would leave: the wish and the avoid texts. */
function stateFor(intake: Intake, w: Wish): InformationState {
  return { ...initialIS(intake), wish: w.wish, avoid: w.avoid ?? [] };
}

const vectorCache = new Map<string, Float32Array>();
async function query(text: string): Promise<Float32Array> {
  if (!vectorCache.has(text)) vectorCache.set(text, await embedQuery(text));
  return vectorCache.get(text)!;
}

async function queries(w: Wish): Promise<QueryVectors> {
  return { wish: await query(w.wish), avoid: await Promise.all((w.avoid ?? []).map(query)) };
}

const pct = (r: { hits: number; of: number }) => (r.of ? `${Math.round((r.hits / r.of) * 100)}%` : "–");
const cell = (r: Result) => `${r.hits}/${r.of}${r.bad ? ` ✗${r.bad}` : ""}`;
const titles = (w: Wish, r: Result) =>
  r.top.map((s) => `${s.movie.title}${w.good.some((l) => matches(l, s.movie)) ? " ✓" : isBad(w, s.movie) ? " ✗" : ""}`).join(" · ");

async function main() {
  const suites = [
    { label: "Family", intake: parseIntake(family), wishes: FAMILY },
    { label: "Adult", intake: parseIntake(solo), wishes: ADULT },
  ];
  const total = { hits: 0, of: 0, bad: 0 };
  const add = (t: { hits: number; of: number; bad: number }, r: Result) => ((t.hits += r.hits), (t.of += r.of), (t.bad += r.bad));

  for (const s of suites) {
    const pool = await loadPool(s.intake);
    console.log(`\n## ${s.label}: ${pool.movies.length} movies in tonight's pool\n`);
    console.log(`| wish | hits | in pool |`);
    console.log(`|---|---|---|`);
    for (const w of s.wishes) {
      const r = score(w, pool, rankPool(stateFor(s.intake, w), pool, await queries(w)));
      add(total, r);
      console.log(`| ${w.name} | ${cell(r)} | ${pool.movies.filter((m) => w.good.some((l) => matches(l, m))).length}/${w.good.length} |`);
      if (verbose) console.log(`|   | ${titles(w, r)} | |`);
    }
  }

  console.log(`\n**Wishes: recall@${TOP} ${pct(total)} (${total.hits}/${total.of}), forbidden in top ${TOP}: ${total.bad}**`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
