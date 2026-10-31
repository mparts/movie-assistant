import {
  Action,
  InformationState as IS,
  Move,
  Movie,
  SearchCriteria,
  TotalInformationState,
} from "./types";
import { initialIS } from "./is";
import {
  ADJUST,
  languageCode,
  resolveGenres,
  resolveTone,
} from "./lexicon";

/** An ISU rule: precondition and effect in one. Returns a thunk (the effect) if it applies. */
type Rule = (context: TotalInformationState) => ((x: void) => IS) | undefined;
type Rules = { [index: string]: Rule };

export const MAX_PAGES = 5;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type MoveOf<T extends Move["type"]> = Extract<Move, { type: T }>;

/** Moves of one type from the latest *user* utterance. */
function usr<T extends Move["type"]>(is: IS, type: T): MoveOf<T>[] {
  const lu = is.shared.lu;
  return lu?.speaker === "usr"
    ? (lu.moves.filter((m) => m.type === type) as MoveOf<T>[])
    : [];
}

const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];
const addUnique = (xs: string[], ys: string[]) => [
  ...xs,
  ...ys.filter((y) => !xs.includes(y)),
];
const without = (xs: string[], ys: string[]) => xs.filter((x) => !ys.includes(x));
const sameIds = (a: Movie[], b: Movie[]) =>
  a.length === b.length && a.every((m, i) => m.id === b[i].id);

export const hasSignal = (is: IS): boolean => {
  const c = is.constraints;
  return (
    is.prefs.genres.length > 0 ||
    is.prefs.seeds.length > 0 ||
    is.dislikes.genres.length > 0 ||
    c.runtime.min !== undefined ||
    c.runtime.max !== undefined ||
    c.year.min !== undefined ||
    c.year.max !== undefined ||
    c.rating !== undefined ||
    c.language !== undefined
  );
};

export function criteriaFromIS(is: IS, page: number = is.search.page): SearchCriteria {
  return {
    genres: is.prefs.genres,
    excludeGenres: is.dislikes.genres,
    runtime: is.constraints.runtime,
    year: is.constraints.year,
    rating: is.constraints.rating,
    language: is.constraints.language,
    page,
  };
}

const queryKey = (is: IS) => JSON.stringify(criteriaFromIS(is, 1));

/** Query changed → stale candidates, search again from page 1. */
const markDirty = (is: IS): IS => ({
  ...is,
  candidates: [],
  search: { status: "dirty", page: 1, noMore: false },
});

/** Apply a change; mark the search dirty only if the TMDB query actually changed. */
const update = (is: IS, f: (s: IS) => IS): IS => {
  const next = f(is);
  return queryKey(next) !== queryKey(is) ? markDirty(next) : next;
};

/** Drop recommended/rejected/disliked movies, then order by genre overlap with prefs (stable). */
export function rank(is: IS, movies: Movie[]): Movie[] {
  const out = new Set([
    ...is.recommended.map((m) => m.id),
    ...is.rejected.map((r) => r.id),
  ]);
  const score = (m: Movie) =>
    m.genres.filter((g) => is.prefs.genres.includes(g)).length;
  return movies
    .filter((m) => !out.has(m.id))
    .filter((m) => !m.genres.some((g) => is.dislikes.genres.includes(g)))
    .map((m, i) => ({ m, i, s: score(m) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.m);
}

function findMovie(is: IS, title?: string): Movie | undefined {
  if (!title) return last(is.recommended);
  const t = title.toLowerCase();
  return [...is.recommended, ...is.candidates, ...is.prefs.seeds].find((m) => {
    const mt = m.title.toLowerCase();
    return mt.includes(t) || t.includes(mt);
  });
}

function constrain(is: IS, m: MoveOf<"constrain">): IS {
  const c = is.constraints;
  const n = Number(m.value);
  const withC = (patch: Partial<IS["constraints"]>): IS => ({
    ...is,
    constraints: { ...c, ...patch },
  });
  switch (m.slot) {
    case "runtime":
      if (isNaN(n)) return is;
      if (m.op === "lte") return withC({ runtime: { ...c.runtime, max: n } });
      if (m.op === "gte") return withC({ runtime: { ...c.runtime, min: n } });
      return withC({ runtime: { min: n - 15, max: n + 15 } });
    case "year":
      if (isNaN(n)) return is;
      if (m.op === "lte") return withC({ year: { ...c.year, max: n } });
      if (m.op === "gte") return withC({ year: { ...c.year, min: n } });
      return withC({ year: { min: n, max: n } });
    case "rating":
      return isNaN(n) || m.op === "lte" ? is : withC({ rating: n });
    case "language": {
      const code = languageCode(String(m.value));
      return code ? withC({ language: code }) : is;
    }
  }
}

function adjust(is: IS, m: MoveOf<"adjust">): IS {
  const c = is.constraints;
  const dir = m.direction.toLowerCase();
  const year = new Date().getFullYear();
  switch (m.dimension) {
    case "tone": {
      const names = resolveTone(dir);
      return names.length
        ? {
            ...is,
            prefs: { ...is.prefs, genres: addUnique(is.prefs.genres, names) },
            dislikes: { genres: without(is.dislikes.genres, names) },
          }
        : is;
    }
    case "runtime": {
      if (/short|less|quick|lower/.test(dir)) {
        const max = Math.max(
          ADJUST.runtimeFloor,
          (c.runtime.max ?? ADJUST.runtimeDefaultMax) - ADJUST.runtimeStep
        );
        const min = c.runtime.min !== undefined && c.runtime.min > max ? undefined : c.runtime.min;
        return { ...is, constraints: { ...c, runtime: { min, max } } };
      }
      if (/long|more|epic/.test(dir)) {
        const min = (c.runtime.min ?? ADJUST.runtimeDefaultMin) + ADJUST.runtimeStep;
        const max = c.runtime.max !== undefined && c.runtime.max < min ? undefined : c.runtime.max;
        return { ...is, constraints: { ...c, runtime: { min, max } } };
      }
      return is;
    }
    case "era": {
      if (/new|recent|modern|latest/.test(dir)) {
        const min = Math.min(year, (c.year.min ?? ADJUST.yearDefaultMin) + ADJUST.yearStep);
        return { ...is, constraints: { ...c, year: { ...c.year, min } } };
      }
      if (/old|classic|vintage/.test(dir)) {
        const max = (c.year.max ?? year) - ADJUST.yearOlderStep;
        const min = c.year.min !== undefined && c.year.min > max ? undefined : c.year.min;
        return { ...is, constraints: { ...c, year: { min, max } } };
      }
      return is;
    }
    case "rating": {
      if (/better|higher|good|best/.test(dir)) {
        const rating = Math.min(
          ADJUST.ratingCap,
          (c.rating ?? ADJUST.ratingDefault) + ADJUST.ratingStep
        );
        return { ...is, constraints: { ...c, rating } };
      }
      return is;
    }
  }
}

function retract(is: IS, slot: string): IS {
  const c = is.constraints;
  switch (slot) {
    case "runtime": return { ...is, constraints: { ...c, runtime: {} } };
    case "year": return { ...is, constraints: { ...c, year: {} } };
    case "rating": return { ...is, constraints: { ...c, rating: undefined } };
    case "language": return { ...is, constraints: { ...c, language: undefined } };
    case "genres": return { ...is, prefs: { ...is.prefs, genres: [] } };
    case "dislikes": return { ...is, dislikes: { genres: [] } };
    case "vibe": return { ...is, vibe: [] };
    case "all":
      return {
        ...is,
        vibe: [],
        prefs: { genres: [], seeds: [] },
        constraints: { runtime: {}, year: {} },
        dislikes: { genres: [] },
      };
    default: return is;
  }
}

/* ------------------------------------------------------------------ */
/* results of async retrieval (called from dme.ts, not rules)          */
/* ------------------------------------------------------------------ */

/** A resolved (or not found) seed title: "something like X". */
export function applySeed(is: IS, movie: Movie | null): IS {
  const i = is.private.agenda.findIndex((a) => a.type === "resolve_seed");
  if (i < 0) return is;
  const title = is.private.agenda[i].title;
  const agenda = is.private.agenda.filter((_, j) => j !== i);
  const notices = movie
    ? is.private.notices
    : [...is.private.notices, `No movie called "${title}" was found in the database.`];
  const base = { ...is, private: { ...is.private, agenda, notices } };
  if (!movie) return base;
  return update(base, (s) => ({
    ...s,
    prefs: {
      seeds: s.prefs.seeds.some((x) => x.id === movie.id)
        ? s.prefs.seeds
        : [...s.prefs.seeds, movie],
      genres: addUnique(
        s.prefs.genres,
        movie.genres.filter((g) => !s.dislikes.genres.includes(g))
      ),
    },
    // the user obviously knows the seed: never recommend it back
    rejected: s.rejected.some((r) => r.id === movie.id)
      ? s.rejected
      : [...s.rejected, { id: movie.id, reason: "seen" }],
  }));
}

export function applyResults(is: IS, movies: Movie[]): IS {
  return {
    ...is,
    candidates: rank(is, movies),
    search: { ...is.search, status: "idle", noMore: movies.length === 0 },
  };
}

export function applyFailure(is: IS): IS {
  return {
    ...is,
    private: {
      ...is.private,
      agenda: is.private.agenda.filter((a) => a.type !== "resolve_seed"),
      notices: [...is.private.notices, "The movie database could not be reached."],
    },
    search: { ...is.search, status: "failed" },
  };
}

/* ------------------------------------------------------------------ */
/* the rules                                                           */
/* ------------------------------------------------------------------ */

export const rules: Rules = {
  /** Start of each Update cycle: last turn's agenda and notices are spent. */
  clear_agenda: ({ is }) => () => ({
    ...is,
    private: { ...is.private, agenda: [], notices: [] },
  }),

  /** Grounding: record the latest utterance (user text or system say) in the shared state and history. */
  get_latest_move: ({ is, latest_moves, latest_speaker, latest_text }) => () => {
    const moves = latest_moves ?? [];
    const speaker = latest_speaker!;
    const text =
      speaker === "sys"
        ? moves.flatMap((m) => (m.type === "say" ? [m.text] : [])).join(" ")
        : latest_text || "(silence)";
    return {
      ...is,
      shared: { ...is.shared, lu: { moves, speaker } },
      history: text ? [...is.history, { speaker, text }] : is.history,
    };
  },

  /** Integrate (user moves) */

  /** A failed search is retried on the next user turn. */
  integrate_retry_failed: ({ is }) => {
    if (is.shared.lu?.speaker === "usr" && is.search.status === "failed") {
      return () => markDirty(is);
    }
  },

  integrate_restart: ({ is }) => {
    if (usr(is, "restart").length) {
      return () => ({
        ...initialIS(),
        history: is.history,
        shared: is.shared,
        private: {
          agenda: [],
          notices: ["The user asked to start over, so earlier preferences are forgotten."],
        },
      });
    }
  },

  integrate_prefer: ({ is }) => {
    const ms = usr(is, "prefer");
    if (!ms.length) return;
    return () =>
      update(is, (s) =>
        ms.reduce((acc, m) => {
          const names = [...resolveGenres(m.mood), ...resolveGenres(m.genre)];
          if (!names.length) return acc;
          return m.negated
            ? {
                ...acc,
                prefs: { ...acc.prefs, genres: without(acc.prefs.genres, names) },
                dislikes: { genres: addUnique(acc.dislikes.genres, names) },
              }
            : {
                ...acc,
                prefs: { ...acc.prefs, genres: addUnique(acc.prefs.genres, names) },
                dislikes: { genres: without(acc.dislikes.genres, names) },
              };
        }, s)
      );
  },

  integrate_constrain: ({ is }) => {
    const ms = usr(is, "constrain");
    if (ms.length) return () => update(is, (s) => ms.reduce(constrain, s));
  },

  integrate_adjust: ({ is }) => {
    const ms = usr(is, "adjust");
    if (ms.length) return () => update(is, (s) => ms.reduce(adjust, s));
  },

  integrate_retract: ({ is }) => {
    const ms = usr(is, "retract");
    if (ms.length) return () => update(is, (s) => ms.reduce((a, m) => retract(a, m.slot), s));
  },

  /** Loose taste ("cozy", "makes me think"): remembered, matched against descriptions by the LLM. No new search. */
  integrate_vibe: ({ is }) => {
    const ms = usr(is, "vibe");
    if (!ms.length) return;
    return () => ({
      ...is,
      vibe: addUnique(is.vibe, ms.map((m) => m.text.trim()).filter(Boolean)),
    });
  },

  /** "Something like X": queue a TMDB lookup (done in dme.ts as an invoked actor). */
  integrate_like: ({ is }) => {
    const ms = usr(is, "like");
    if (!ms.length) return;
    return () => ({
      ...is,
      private: {
        ...is.private,
        agenda: [
          ...is.private.agenda,
          ...ms.map((m): Action => ({ type: "resolve_seed", title: m.title })),
        ],
      },
    });
  },

  integrate_seen_reject: ({ is }) => {
    const ms = [
      ...usr(is, "seen").map((m) => ({ title: m.title, reason: "seen" as const })),
      ...usr(is, "reject").map((m) => ({ title: m.title, reason: "no" as const })),
    ];
    if (!ms.length) return;
    return () => {
      let rejected = is.rejected;
      for (const { title, reason } of ms) {
        const target = findMovie(is, title);
        if (target && !rejected.some((r) => r.id === target.id)) {
          rejected = [...rejected, { id: target.id, reason }];
        }
      }
      return { ...is, rejected };
    };
  },

  /** Integrate (system moves): a spoken recommendation becomes shared. */
  integrate_recommend: ({ is }) => {
    const lu = is.shared.lu;
    if (lu?.speaker !== "sys") return;
    const ids = lu.moves.flatMap((m) => (m.type === "say" && m.movieId !== undefined ? [m.movieId] : []));
    const shown = ids.flatMap((id) => is.candidates.filter((c) => c.id === id));
    if (!shown.length) return;
    return () => ({
      ...is,
      recommended: [
        ...is.recommended,
        ...shown.filter((m) => !is.recommended.some((r) => r.id === m.id)),
      ],
    });
  },

  /** Keep candidates free of recommended/rejected/disliked movies. */
  filter_candidates: ({ is }) => {
    const ranked = rank(is, is.candidates);
    if (!sameIds(ranked, is.candidates)) return () => ({ ...is, candidates: ranked });
  },

  /** Retrieve: pool exhausted but TMDB may have more → ask for the next page. */
  next_page: ({ is }) => {
    if (
      is.shared.lu?.speaker === "usr" &&
      is.search.status === "idle" &&
      is.candidates.length === 0 &&
      !is.search.noMore &&
      is.search.page < MAX_PAGES &&
      hasSignal(is)
    ) {
      return () => ({
        ...is,
        search: { status: "dirty", page: is.search.page + 1, noMore: false },
      });
    }
  },

};
