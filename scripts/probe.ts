/** Checks the real services and prints what came back. Run: npm run probe */
import { embeddings as embCfg, llmBackends, services, authHeaders } from "../src/config/services";
import { initialIS } from "../src/core/state";
import { rank } from "../src/core/ranking";
import { understand } from "../src/dialogue/nlu";
import { respond } from "../src/dialogue/respond";
import { createClients } from "../src/services";
import { loadEnv } from "./env";

const env = loadEnv();
const { tmdb, llm, embedder } = createClients("upstream", env);
const section = (s: string) => console.log(`\n=== ${s}`);

async function main() {
  section("TMDB");
  const headers = authHeaders(services.tmdb, env);
  const res = await fetch(`${services.tmdb.upstream}/genre/movie/list?language=en`, { headers });
  console.log(`genres: HTTP ${res.status}`);
  for (const t of ["Knives Out", "asdkjh qwe"]) {
    const m = await tmdb.searchMovie(t);
    console.log(`search "${t}" ->`, m ? `${m.title} (${m.year}) id=${m.id}` : null);
  }
  const pool = await tmdb.discover({ genres: ["Comedy"], excludeGenres: ["Horror"], runtime: { max: 110 }, year: {}, page: 1 });
  console.log(`discover Comedy ≤110min: ${pool.length} movies, e.g.`, pool.slice(0, 4).map((m) => `${m.title} (${m.runtime ?? "?"}min)`).join(" | "));

  section("Embeddings");
  if (embedder) {
    const t = Date.now();
    const s = await embedder.score("light, funny", pool.slice(0, 20));
    console.log(`${embCfg.model}: ${s.size} scores in ${Date.now() - t}ms`);
  } else console.log("disabled");

  section(`LLM (${llmBackends.map((b) => b.name).join(" → ")})`);
  const is = initialIS();
  is.prefs.genres = ["Comedy"];
  is.constraints.runtime = { max: 110 };
  is.vibe = ["light"];
  is.candidates = rank(is, pool);
  is.history = [
    { speaker: "sys", text: "Hey! What are you in the mood to watch tonight?" },
    { speaker: "usr", text: "Something funny and light, I only have about an hour and a half." },
  ];
  for (const u of ["I loved Knives Out, something like that but funnier", "no horror please, and I've already seen that one", "hi, how's it going?"]) {
    const t = Date.now();
    console.log(`understand ${Date.now() - t}ms "${u}" ->`, JSON.stringify(await understand(llm, u, is)));
  }
  const r = await respond(llm, is);
  console.log("respond:", r.say, "| recommends:", is.candidates.find((m) => m.id === r.movieId)?.title ?? null);
}

main().catch((e) => {
  console.error("\nPROBE FAILED:", e);
  process.exit(1);
});
