import type { Movie, SearchCriteria, TmdbClient } from "../core/types";
import { isDebug } from "../core/util";
import { settings } from "../config/settings";

export interface TmdbOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  language: string;
  minVotes: number;
  /** Parallel requests when walking every page of a query. */
  walkConcurrency: number;
  /** Top-billed cast kept per movie. */
  castShown: number;
  /** Wait after a 429, and how many times to retry it before failing. */
  retryDelayMs: number;
  rateLimitRetries: number;
}

/** TMDB returns nothing past page 500 of any query. */
const MAX_PAGES = 500;

/** Pure: our filters (genre NAMES) → TMDB /discover/movie query parameters, in a stable order (release date). */
export function buildDiscoverParams(
  c: SearchCriteria,
  idByName: Map<string, number>,
  o: Pick<TmdbOptions, "language" | "minVotes">
): Record<string, string> {
  const withoutIds = c.excludeGenres.flatMap((n) => (idByName.has(n) ? [idByName.get(n)!] : []));
  const p: Record<string, string> = {
    include_adult: "false",
    include_video: "false",
    language: o.language,
    // Popularity would shift while we page through it, skipping or repeating movies.
    sort_by: "primary_release_date.asc",
    "vote_count.gte": String(o.minVotes),
  };
  if (withoutIds.length) p.without_genres = withoutIds.join(",");
  if (c.runtime.min !== undefined) p["with_runtime.gte"] = String(c.runtime.min);
  if (c.runtime.max !== undefined) p["with_runtime.lte"] = String(c.runtime.max);
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
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Runs `f` over `xs`, `walkConcurrency` at a time. */
  async function pooled<T, R>(xs: T[], f: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < xs.length; i += o.walkConcurrency) out.push(...(await Promise.all(xs.slice(i, i + o.walkConcurrency).map(f))));
    return out;
  }

  async function get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = `${o.baseUrl}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: o.headers });
      if (res.status === 429 && attempt < o.rateLimitRetries) {
        await sleep(o.retryDelayMs); // TMDB asks clients to respect 429
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`TMDB ${path} HTTP ${res.status}`), { status: res.status });
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
    language: r.original_language ?? undefined,
  });

  return {
    async pool(criteria) {
      const g = await loadGenres();
      const params = buildDiscoverParams(criteria, g.byName, o);
      const found = new Map<number, any>();
      let pages = 0;
      async function walk(from: number, to: number): Promise<void> {
        const p = { ...params, "primary_release_date.gte": `${from}-01-01`, "primary_release_date.lte": `${to}-12-31` };
        const first = await get("/discover/movie", { ...p, page: "1" });
        const total: number = first.total_pages ?? 1;
        if (total > MAX_PAGES && from < to) {
          const mid = Math.floor((from + to) / 2);
          await walk(from, mid);
          return walk(mid + 1, to);
        }
        if (total > MAX_PAGES) console.warn(`[tmdb] ${from}: ${total} pages, only the first ${MAX_PAGES} are reachable`);
        const rest = await pooled(Array.from({ length: Math.min(total, MAX_PAGES) - 1 }, (_, i) => String(i + 2)), (page) =>
          get("/discover/movie", { ...p, page })
        );
        for (const d of [first, ...rest]) for (const r of d.results ?? []) found.set(r.id, r);
        pages += 1 + rest.length;
      }
      await walk(criteria.year.min ?? 1900, criteria.year.max ?? new Date().getFullYear() + 1);
      if (isDebug()) console.log(`[tmdb] pool: ${found.size} movies in ${pages} pages`);
      return [...found.values()].map((r) => toMovie(r, g.byId));
    },
    async details(id) {
      const d = await get(`/movie/${id}`, { language: o.language, append_to_response: "credits,keywords" });
      const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
      return {
        runtime: typeof d.runtime === "number" && d.runtime > 0 ? d.runtime : undefined,
        directors: ((d.credits?.crew ?? []) as any[]).filter((c) => c.job === "Director").map((c) => String(c.name)),
        cast: ((d.credits?.cast ?? []) as any[]).slice(0, o.castShown).map((c) => String(c.name)),
        collection: str(d.belongs_to_collection?.name),
        tagline: str(d.tagline),
        keywords: ((d.keywords?.keywords ?? []) as any[]).map((k) => String(k.name)),
      };
    },
    async searchMovie(title) {
      const g = await loadGenres();
      const data = await get("/search/movie", { query: title, include_adult: "false", page: "1" });
      const hit = (data.results as any[])[0];
      return hit ? toMovie(hit, g.byId) : null;
    },
  };
}
