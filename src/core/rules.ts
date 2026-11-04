/**
 * Information-state-update rules. A rule is precondition and effect in one: it returns a thunk
 * (the effect) if it applies, otherwise undefined. The dialogue manager (dialogue/dme.ts) runs them.
 * Retrieval is local: after every user turn the DME ranks tonight's pool (`applyRanking`); no rule searches TMDB.
 */
import { settings } from "../config/settings";
import { notices } from "../config/prompts";
import { constrain, retract } from "./constraints";
import { resolveGenres } from "./lexicon";
import type { Pool } from "./pool";
import { featuresPerson, rankPool, type QueryVectors } from "./ranking";
import { evidenceFromMoves } from "./readiness";
import { Action, InformationState as IS, Move, MoveOf, Movie, TotalInformationState } from "./types";
import { addUnique, last, without } from "./util";

type Rule = (context: TotalInformationState) => ((x: void) => IS) | undefined;

/* ---- helpers ---- */

/** Moves of one type from the latest *user* utterance. */
function usr<T extends Move["type"]>(is: IS, type: T): MoveOf<T>[] {
  const lu = is.shared.lu;
  return lu?.speaker === "usr" ? (lu.moves.filter((m) => m.type === type) as MoveOf<T>[]) : [];
}

/** Add a notice for the LLM to mention (what happened behind the scenes this turn), once. */
export const withNotice = (is: IS, notice: string): IS =>
  is.private.notices.includes(notice) ? is : { ...is, private: { ...is.private, notices: [...is.private.notices, notice] } };

/** A title the user names ("that one" = the movie in focus), looked up among what we know. */
/** Lowercased, punctuation as single spaces, padded, so a match is always on whole words. */
const wordsOf = (s: string) => {
  const norm = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return ` ${norm || s.toLowerCase()} `;
};

function findMovie(is: IS, title?: string): Movie | undefined {
  if (!title) return last(is.recommended);
  const t = wordsOf(title);
  return [...is.recommended, ...is.candidates, ...is.seeds].find((m) => {
    const mt = wordsOf(m.title);
    return mt.includes(t) || t.includes(mt);
  });
}

const spokenText = (moves: Move[]) => moves.flatMap((m) => (m.type === "say" ? [m.text] : [])).join(" ");
const recommendedIds = (moves: Move[]) =>
  moves.flatMap((m) => (m.type === "say" && m.movieId !== undefined ? [m.movieId] : []));
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* ---- results of async work (called from the dialogue manager, not rules) ---- */

/** A resolved (or not found) liked movie: "something like X". It is never suggested back. */
export function applySeed(is: IS, movie: Movie | null): IS {
  const i = is.private.agenda.findIndex((a) => a.type === "resolve_seed");
  if (i < 0) return is;
  const title = is.private.agenda[i].title;
  const base: IS = { ...is, private: { ...is.private, agenda: is.private.agenda.filter((_, j) => j !== i) } };
  if (!movie) return withNotice(base, notices.seedNotFound(title));
  return base.seeds.some((x) => x.id === movie.id) ? base : { ...base, seeds: [...base.seeds, movie] };
}

/** A liked movie could not be looked up: drop pending lookups and tell Jake. */
export const applyFailure = (is: IS): IS =>
  withNotice({ ...is, private: { ...is.private, agenda: is.private.agenda.filter((a) => a.type !== "resolve_seed") } }, notices.dbUnreachable);

/**
 * Ranks tonight's pool for the current state: the best `candidatesShown` become the candidates. A person the user
 * just asked for who is in none of tonight's movies is a notice (the ranking can do nothing for them).
 */
export function applyRanking(is: IS, pool: Pool, q: QueryVectors): IS {
  const ranked = rankPool(is, pool, q);
  let next: IS = { ...is, candidates: ranked.slice(0, settings.dialogue.candidatesShown).map((s) => s.movie) };
  for (const p of usr(is, "person")) {
    if (!p.negated && !pool.movies.some((m) => featuresPerson(m, p.name))) next = withNotice(next, notices.personNotInPool(p.name));
  }
  return next;
}

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
      // Any feedback from the user ("seen it", "not that one", a new wish) ends a run of suggestions; silence or a
      // vague reply keeps it, which is what leads to a clarifying question.
      recommendStreak:
        speaker === "usr"
          ? moves.some((m) => m.type !== "noinput") ? 0 : is.recommendStreak
          : recommendedIds(moves).length ? is.recommendStreak + 1 : 0,
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

  /** The NLU rewrites the whole wish each time taste changes: the latest one replaces the old. */
  integrate_wish: ({ is }) => {
    const text = last(usr(is, "wish"))?.text.trim();
    return text && text !== is.wish ? () => ({ ...is, wish: text }) : undefined;
  },

  integrate_avoid: ({ is }) => {
    const texts = usr(is, "avoid").map((m) => m.text.trim()).filter((t) => t && !is.avoid.includes(t));
    return texts.length ? () => ({ ...is, avoid: [...is.avoid, ...texts] }) : undefined;
  },

  /** A named genre: a soft want, or (negated) a hard avoid. Saying one undoes the other. */
  integrate_prefer: ({ is }) => {
    const ms = usr(is, "prefer").filter((m) => resolveGenres(m.genre).length);
    if (!ms.length) return;
    return () =>
      ms.reduce((acc, m) => {
        const names = resolveGenres(m.genre);
        return m.negated
          ? { ...acc, genres: without(acc.genres, names), avoidGenres: addUnique(acc.avoidGenres, names) }
          : { ...acc, genres: addUnique(acc.genres, names), avoidGenres: without(acc.avoidGenres, names) };
      }, is);
  },

  /** An actor or director, wanted or not; the latest word on a name wins. */
  integrate_person: ({ is }) => {
    const ms = usr(is, "person");
    if (!ms.length) return;
    return () =>
      ms.reduce(
        (acc, m) => ({
          ...acc,
          people: [...acc.people.filter((p) => !sameName(p.name, m.name)), { name: m.name.trim(), negated: !!m.negated }],
        }),
        is
      );
  },

  /** Year and language narrow the pool; time is tonight's setting, so a runtime request only gets a notice. */
  integrate_constrain: ({ is }) => {
    const ms = usr(is, "constrain");
    if (!ms.length) return;
    return () => {
      const next = ms.reduce(constrain, is);
      return ms.some((m) => m.slot === "runtime") ? withNotice(next, notices.timeInSettings) : next;
    };
  },

  integrate_retract: ({ is }) => {
    const ms = usr(is, "retract");
    return ms.length ? () => ms.reduce((a, m) => retract(a, m.slot), is) : undefined;
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
        if (target && !rejected.some((r) => r.id === target.id)) rejected = [...rejected, { id: target.id, reason }];
      }
      return { ...is, rejected };
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
      // A suggested movie leaves the candidates at once (the next ranking happens only after the user's turn).
      candidates: is.candidates.filter((c) => !shown.some((m) => m.id === c.id)),
    });
  },
};
