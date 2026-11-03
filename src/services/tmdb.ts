import type { Movie, SearchCriteria, TmdbClient } from "../core/types";
import { isDebug } from "../core/util";
import { settings } from "../config/settings";

export interface TmdbOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  language: string;
  sortBy: string;
  minVotes: number;
  /** TMDB pages (20 movies each) fetched per search batch. */
  pagesPerBatch: number;
  /** Pages of results a session may draw from, in a per-session random order. */
  pageWindow: number;
  runtimeLookupConcurrency: number;
  /** Wait after a 429, and how many times to retry it before failing. */
  retryDelayMs: number;
  rateLimitRetries: number;
  /** Where runtimes survive restarts. Without one, they are cached only in memory. */
  store?: RuntimeStore;
}

/** Persistent storage for runtimes. Both methods must never throw: a bad cache is an empty cache. */
export interface RuntimeStore {
  load(): Map<number, number>;
  save(entries: Map<number, number>): void;
}

type DiscoverOptions = Pick<TmdbOptions, "language" | "sortBy" | "minVotes">;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pure: our criteria (genre NAMES) → TMDB /discover/movie query parameters. */
export function buildDiscoverParams(
  c: SearchCriteria,
  idByName: Map<string, number>,
  o: DiscoverOptions
): Record<string, string> {
  const ids = (names: string[]) => names.flatMap((n) => (idByName.has(n) ? [idByName.get(n)!] : []));
  const p: Record<string, string> = {
    include_adult: "false",
    language: o.language,
    sort_by: o.sortBy,
    "vote_count.gte": String(o.minVotes),
    page: String(c.page),
  };
  const withIds = ids(c.genres);
  const withoutIds = ids(c.excludeGenres);
  // TMDB has no mixed AND/OR: "35,28|53" silently becomes "35,28". So one or the other.
  if (withIds.length) p.with_genres = withIds.join(c.matchAll ? "," : "|");
  if (withoutIds.length) p.without_genres = withoutIds.join(",");
  if (c.runtime.min !== undefined) p["with_runtime.gte"] = String(c.runtime.min);
  if (c.runtime.max !== undefined) p["with_runtime.lte"] = String(c.runtime.max);
  if (c.year.min !== undefined) p["primary_release_date.gte"] = `${c.year.min}-01-01`;
  if (c.year.max !== undefined) p["primary_release_date.lte"] = `${c.year.max}-12-31`;
  if (c.rating !== undefined) p["vote_average.gte"] = String(c.rating);
  if (c.language) p.with_original_language = c.language;
  if (c.certificationLte) {
    p.certification_country = "US";
    p["certification.lte"] = c.certificationLte;
  }
  if (c.watch) {
    p.watch_region = c.watch.region;
    p.with_watch_providers = c.watch.providers.join("|");
    p.with_watch_monetization_types = settings.intake.monetization;
  }
  return p;
}

export function createTmdb(o: TmdbOptions): TmdbClient {
  // Popularity-sorted discover always returns the same top titles. A random page order per session
  // (fixed for the session, so repeated searches stay consistent) varies the pool between conversations.
  const pageOrder = shuffle(Array.from({ length: o.pageWindow }, (_, i) => i + 1));
  const runtimes = new Map<number, number>();
  let runtimesLoaded = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = `${o.baseUrl}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: o.headers });
      if (res.status === 429 && attempt < o.rateLimitRetries) {
        await sleep(o.retryDelayMs); // TMDB asks clients to respect 429
        continue;
      }
      if (!res.ok) throw new Error(`TMDB ${path} HTTP ${res.status}`);
      return res.json();
    }
  }

  type GenreMaps = { byName: Map<string, number>; byId: Map<number, string> };
  let genres: Promise<GenreMaps> | undefined;
  const loadGenres = () =>
    (genres ??= get("/genre/movie/list", { language: "en" })
      .then((d) => ({
        byName: new Map<string, number>(d.genres.map((g: any) => [g.name, g.id])),
        byId: new Map<number, string>(d.genres.map((g: any) => [g.id, g.name])),
      }))
      .catch((e) => {
        genres = undefined; // retry next time
        throw e;
      }));

  const toMovie = (r: any, byId: Map<number, string>): Movie => ({
    id: r.id,
    title: r.title,
    year: r.release_date ? parseInt(String(r.release_date).slice(0, 4), 10) || undefined : undefined,
    genres: ((r.genre_ids ?? []) as number[]).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    rating: r.vote_average ?? 0,
    votes: r.vote_count ?? 0,
    overview: r.overview ?? "",
    posterPath: r.poster_path ?? undefined,
  });

  /** Discover results carry no runtime; look them up (concurrently, cached) so the assistant never has to guess. */
  async function fillRuntimes(movies: Movie[]) {
    if (!runtimesLoaded) {
      runtimesLoaded = true;
      for (const [id, minutes] of o.store?.load() ?? []) runtimes.set(id, minutes);
    }
    const todo = movies.filter((m) => !runtimes.has(m.id));
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(o.runtimeLookupConcurrency, todo.length) }, async () => {
        while (next < todo.length) {
          const m = todo[next++];
          try {
            const d = await get(`/movie/${m.id}`, { language: o.language });
            if (typeof d.runtime === "number" && d.runtime > 0) runtimes.set(m.id, d.runtime);
          } catch {
            /* runtime stays unknown */
          }
        }
      })
    );
    for (const m of movies) {
      const r = runtimes.get(m.id);
      if (r) m.runtime = r;
    }
    // Failed lookups are not in `runtimes`, so they are neither saved nor remembered: they get retried next time.
    if (o.store && todo.some((m) => runtimes.has(m.id))) o.store.save(runtimes);
    if (isDebug()) console.log(`[tmdb] runtimes: ${todo.length} looked up / ${movies.length} movies`);
  }

  return {
    async discover(criteria) {
      const g = await loadGenres();
      const params = buildDiscoverParams(criteria, g.byName, o);
      if (isDebug()) console.log(`[tmdb] discover ${new URLSearchParams(params)}`);
      // Page 1 doubles as a probe: it tells us how many pages this query really has.
      const probe = await get("/discover/movie", { ...params, page: "1" });
      const available = Math.min(probe.total_pages ?? 1, o.pageWindow);
      const start = (criteria.page - 1) * o.pagesPerBatch;
      const pages = pageOrder.filter((p) => p <= available).slice(start, start + o.pagesPerBatch);
      const responses = await Promise.all(
        pages.map((p) => (p === 1 ? probe : get("/discover/movie", { ...params, page: String(p) })))
      );
      const seen = new Set<number>();
      const movies = responses
        .flatMap((d) => d.results as any[])
        .map((r) => toMovie(r, g.byId))
        .filter((m) => !seen.has(m.id) && !!seen.add(m.id));
      await fillRuntimes(movies);
      return { movies, total: probe.total_results ?? movies.length };
    },
    async searchMovie(title) {
      const g = await loadGenres();
      const data = await get("/search/movie", { query: title, include_adult: "false", page: "1" });
      const hit = (data.results as any[])[0];
      return hit ? toMovie(hit, g.byId) : null;
    },
  };
}
