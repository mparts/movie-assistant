/**
 * Embeds the movie catalogue ahead of time: every TMDB movie with at least `catalogue.minVotes` votes and at least
 * `intake.minMinutes` minutes, so any Phase 1 pool is (nearly) all embedded already. Saves a record (with runtime,
 * directors and cast), keywords and a vector per movie in `.cache/`. Run again to top up: only new movies get details
 * fetched, and only new or changed texts get embedded. No LLM calls.
 *
 *   npm run embed-catalogue
 */
import { authHeaders, embeddings as embCfg, services } from "../src/config/services";
import { settings } from "../src/config/settings";
import { ensureVectors, openCatalogue, saveRecords } from "../src/services/catalogue";
import { createTmdb } from "../src/services/tmdb";
import { loadEnv } from "./env";

const t0 = Date.now();
const secs = (t = t0) => `${((Date.now() - t) / 1000).toFixed(0)}s`;
const tmdb = createTmdb({
  baseUrl: services.tmdb.upstream,
  headers: authHeaders(services.tmdb, loadEnv()),
  ...settings.search,
  minVotes: settings.catalogue.minVotes,
});

const coverage = { minVotes: settings.catalogue.minVotes, minMinutes: settings.intake.minMinutes, updated: new Date().toISOString().slice(0, 10) };
const movies = await tmdb.pool({ excludeGenres: [], runtime: { min: coverage.minMinutes }, year: {} });
const withText = movies.filter((m) => m.overview.trim()).length;
console.log(`TMDB: ${movies.length} movies (${movies.length - withText} without an overview, skipped) · ${secs()}`);

const catalogue = openCatalogue();
console.log(`Catalogue: ${catalogue.records.size} records, ${catalogue.store.size} vectors (${embCfg.model})`);
let t = Date.now();
const { vectors, embedded } = await ensureVectors(movies, catalogue, tmdb, {
  onDetails: (done, total) => console.log(`  details: ${done} / ${total} fetched · ${secs(t)}`),
  onProgress: (done, total) => {
    const eta = ((Date.now() - t) / done) * (total - done);
    console.log(`  ${done} / ${total} embedded · ${secs(t)} · about ${Math.ceil(eta / 60000)} min left`);
  },
});
// What this walk covered: tonight's pool may come from the copy only when its filters fall inside it.
catalogue.coverage = coverage;
saveRecords(catalogue);
console.log(`Done: ${vectors.size} movies with vectors of ${catalogue.store.dims || "?"} dims (${embedded} new or changed), ` +
  `${catalogue.records.size} records, in ${secs()}`);
