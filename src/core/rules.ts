/**
 * Information-state-update rules. A rule is precondition and effect in one: it returns a thunk
 * (the effect) if it applies, otherwise undefined. The dialogue manager (dialogue/dme.ts) runs them.
 */
import { settings } from "../config/settings";
import { notices } from "../config/prompts";
import { adjust, constrain, retract } from "./constraints";
import { resolvePreference, synonymGenres } from "./lexicon";
import { eligible, rank } from "./ranking";
import { evidenceFromMoves } from "./readiness";
import { criteriaFromIS, hasSignal, initialIS } from "./state";
import { Action, InformationState as IS, Move, MoveOf, Movie, TotalInformationState } from "./types";
import { addUnique, last, sameIds, without } from "./util";

type Rule = (context: TotalInformationState) => ((x: void) => IS) | undefined;

/* ---- helpers ---- */

/** Moves of one type from the latest *user* utterance. */
function usr<T extends Move["type"]>(is: IS, type: T): MoveOf<T>[] {
  const lu = is.shared.lu;
  return lu?.speaker === "usr" ? (lu.moves.filter((m) => m.type === type) as MoveOf<T>[]) : [];
}

const queryKey = (is: IS) => JSON.stringify(criteriaFromIS(is, 1));

/** Query changed → stale candidates, search again from the first batch. */
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

/**
 * Words from `prefer` moves that name no genre or mood we know ("goofy", "cozy"). They are taste all the same, so they
 * are kept as vibes instead of being dropped.
 */
function looseTaste(is: IS): string[] {
  return usr(is, "prefer").flatMap((m) =>
    m.negated
      ? []
      : [m.mood, m.genre].flatMap((t) => (t?.trim() && !resolvePreference(t).names.length ? [t.trim()] : []))
  );
}

/** A title the user names ("that one" = the movie in focus), looked up among what we know. */
function findMovie(is: IS, title?: string): Movie | undefined {
  if (!title) return last(is.recommended);
  const t = title.toLowerCase();
  return [...is.recommended, ...is.candidates, ...is.prefs.seeds].find((m) => {
    const mt = m.title.toLowerCase();
    return mt.includes(t) || t.includes(mt);
  });
}

const spokenText = (moves: Move[]) => moves.flatMap((m) => (m.type === "say" ? [m.text] : [])).join(" ");
const recommendedIds = (moves: Move[]) =>
  moves.flatMap((m) => (m.type === "say" && m.movieId !== undefined ? [m.movieId] : []));

/* ---- results of async retrieval (called from the dialogue manager, not rules) ---- */

/** A resolved (or not found) seed title: "something like X". */
export function applySeed(is: IS, movie: Movie | null): IS {
  const i = is.private.agenda.findIndex((a) => a.type === "resolve_seed");
  if (i < 0) return is;
  const title = is.private.agenda[i].title;
  const base: IS = {
    ...is,
    private: {
      agenda: is.private.agenda.filter((_, j) => j !== i),
      notices: movie ? is.private.notices : [...is.private.notices, notices.seedNotFound(title)],
    },
  };
  if (!movie) return base;
  return update(base, (s) => ({
    ...s,
    prefs: {
      ...s.prefs,
      seeds: s.prefs.seeds.some((x) => x.id === movie.id) ? s.prefs.seeds : [...s.prefs.seeds, movie],
      genres: addUnique(s.prefs.genres, movie.genres.filter((g) => !s.dislikes.genres.includes(g))),
    },
    // the user obviously knows the seed: never recommend it back
    rejected: s.rejected.some((r) => r.id === movie.id) ? s.rejected : [...s.rejected, { id: movie.id, reason: "seen" }],
  }));
}

export const applyResults = (is: IS, movies: Movie[], total: number = movies.length): IS => ({
  ...is,
  candidates: rank(is, movies),
  search: { ...is.search, status: "idle", noMore: movies.length === 0, total },
});

export const applyFailure = (is: IS): IS => ({
  ...is,
  private: {
    agenda: is.private.agenda.filter((a) => a.type !== "resolve_seed"),
    notices: [...is.private.notices, notices.dbUnreachable],
  },
  search: { ...is.search, status: "failed" },
});

/* ---- the rules ---- */

export const rules: Record<string, Rule> = {
  /** Start of each Update cycle: last turn's agenda and notices are spent. */
  clear_agenda: ({ is }) => () => ({ ...is, private: { agenda: [], notices: [] } }),

  /** Grounding: record the latest utterance (user text or system say) in the shared state and history. */
  get_latest_move: ({ is, latest_moves, latest_speaker, latest_text }) => () => {
    const moves = latest_moves ?? [];
    const speaker = latest_speaker!;
    const text = speaker === "sys" ? spokenText(moves) : latest_text || settings.dialogue.silenceMarker;
    const evidence = speaker === "usr" ? evidenceFromMoves(moves) : [];
    // "Yes, this one" is remembered until the user says anything substantive again, so a following "thanks" stays in wrap-up.
    const accepted =
      speaker !== "usr" || moves.length === 0 || moves.every((m) => m.type === "noinput")
        ? is.accepted
        : moves.some((m) => m.type === "accept")
          ? last(is.recommended)?.id
          : undefined;
    return {
      ...is,
      shared: { ...is.shared, lu: { moves, speaker } },
      history: text ? [...is.history, { speaker, text }] : is.history,
      recommendStreak:
        speaker === "usr" ? is.recommendStreak : recommendedIds(moves).length ? is.recommendStreak + 1 : 0,
      accepted,
      readiness: evidence.length
        ? {
            meaningfulTurns: is.readiness.meaningfulTurns + 1,
            evidence: [...new Set([...is.readiness.evidence, ...evidence])],
          }
        : is.readiness,
    };
  },

  /* -- integrate user moves -- */

  /** A failed search is retried on the next user turn. */
  integrate_retry_failed: ({ is }) =>
    is.shared.lu?.speaker === "usr" && is.search.status === "failed" ? () => markDirty(is) : undefined,

  integrate_restart: ({ is }) =>
    usr(is, "restart").length
      ? () => ({
          ...initialIS(),
          history: is.history,
          shared: is.shared,
          private: { agenda: [], notices: [notices.restarted] },
        })
      : undefined,

  integrate_prefer: ({ is }) => {
    const ms = usr(is, "prefer");
    if (!ms.length) return;
    return () =>
      update(is, (s) =>
        ms.reduce((acc, m) => {
          const resolved = [resolvePreference(m.mood), resolvePreference(m.genre)];
          const names = resolved.flatMap((r) => r.names);
          if (!names.length) return acc;
          const required = resolved.flatMap((r) => (r.required ? r.names : []));
          return m.negated
            ? {
                ...acc,
                prefs: {
                  ...acc.prefs,
                  genres: without(acc.prefs.genres, names),
                  required: without(acc.prefs.required, names),
                },
                dislikes: { genres: addUnique(acc.dislikes.genres, names) },
              }
            : {
                ...acc,
                prefs: {
                  ...acc.prefs,
                  genres: addUnique(acc.prefs.genres, names),
                  required: addUnique(acc.prefs.required, required),
                },
                dislikes: { genres: without(acc.dislikes.genres, names) },
              };
        }, s)
      );
  },

  integrate_constrain: ({ is }) => {
    const ms = usr(is, "constrain");
    return ms.length ? () => update(is, (s) => ms.reduce(constrain, s)) : undefined;
  },

  integrate_adjust: ({ is }) => {
    const ms = usr(is, "adjust");
    return ms.length ? () => update(is, (s) => ms.reduce(adjust, s)) : undefined;
  },

  integrate_retract: ({ is }) => {
    const ms = usr(is, "retract");
    return ms.length ? () => update(is, (s) => ms.reduce((a, m) => retract(a, m.slot), s)) : undefined;
  },

  /**
   * Loose taste ("cozy", "makes me think"): remembered, ranked against descriptions semantically. Includes words a
   * `prefer` move carried but the lexicon does not know. A word that is a synonym of a mood ("goofy" = funny) also
   * adds that mood's genres, only as alternatives to rank by (`prefs.genres`), never as required ones.
   */
  integrate_vibe: ({ is }) => {
    const texts = [...usr(is, "vibe").map((m) => m.text.trim()), ...looseTaste(is)].filter(Boolean);
    if (!texts.length) return;
    return () => {
      const next = update(is, (s) => ({
        ...s,
        vibe: addUnique(s.vibe, texts),
        prefs: { ...s.prefs, genres: addUnique(s.prefs.genres, texts.flatMap(synonymGenres)) },
      }));
      // A vibe doesn't change the TMDB query, so as the first signal it must trigger the first search itself.
      return hasSignal(is) ? next : markDirty(next);
    };
  },

  /** "Something like X": queue a TMDB lookup (done by the dialogue manager as an invoked actor). */
  integrate_like: ({ is }) => {
    const ms = usr(is, "like");
    if (!ms.length) return;
    return () => ({
      ...is,
      private: {
        ...is.private,
        agenda: [...is.private.agenda, ...ms.map((m): Action => ({ type: "resolve_seed", title: m.title }))],
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
          // keep a snapshot: the movie leaves the candidates, but later candidates are compared to it
          rejected = [...rejected, { id: target.id, reason, genres: target.genres, overview: target.overview }];
        }
      }
      // Re-rank now: with no vibe or liked movie, nothing else would re-sort until the next TMDB search.
      // Safe for semantic order too, because the semantic step re-sorts after this whenever it applies.
      return { ...is, rejected, candidates: rank({ ...is, rejected }, is.candidates) };
    };
  },

  /* -- integrate system moves -- */

  /** A spoken recommendation becomes shared. */
  integrate_recommend: ({ is }) => {
    const lu = is.shared.lu;
    if (lu?.speaker !== "sys") return;
    const shown = recommendedIds(lu.moves).flatMap((id) => is.candidates.filter((c) => c.id === id));
    if (!shown.length) return;
    return () => ({
      ...is,
      recommended: [...is.recommended, ...shown.filter((m) => !is.recommended.some((r) => r.id === m.id))],
    });
  },

  /** Keep candidates free of suggested/rejected/disliked movies. Filter only: re-sorting would undo semantic order. */
  filter_candidates: ({ is }) => {
    const kept = eligible(is, is.candidates);
    return sameIds(kept, is.candidates) ? undefined : () => ({ ...is, candidates: kept });
  },

  /* -- retrieve -- */

  /**
   * Hardly any movies have all the named genres at once ("Western" AND "Music"): search for any of them instead,
   * and tell the user. The few that have them all still rank first, since they match every wanted genre.
   */
  relax_genres: ({ is }) =>
    is.search.status === "idle" &&
    is.search.total !== undefined &&
    is.search.total < settings.search.thinPool &&
    is.prefs.required.length >= 2
      ? () => {
          const relaxed = update(is, (s) => ({ ...s, prefs: { ...s.prefs, required: [] } }));
          return {
            ...relaxed,
            private: { ...relaxed.private, notices: [...relaxed.private.notices, notices.genresRelaxed(is.prefs.required)] },
          };
        }
      : undefined,

  /** Pool exhausted but TMDB may have more → ask for the next batch of pages. */
  next_page: ({ is }) =>
    is.shared.lu?.speaker === "usr" &&
    is.search.status === "idle" &&
    is.candidates.length === 0 &&
    !is.search.noMore &&
    is.search.page < settings.search.maxBatches &&
    hasSignal(is)
      ? () => ({ ...is, search: { status: "dirty", page: is.search.page + 1, noMore: false } })
      : undefined,
};
