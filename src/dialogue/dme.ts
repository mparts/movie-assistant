/**
 * Dialogue Manager Engine (xstate). One turn = Select (say something) → Update (hear + integrate + retrieve).
 *   Select:  respond() → one `say` move, sent to the parent.
 *   Update:  Init → Grounding (wait for SAYS) → Understand (LLM) → Integrate (rule chain)
 *            → Retrieve (seed lookup / TMDB search loop) → SemanticRank (optional) → Done.
 */
import { AnyTransitionConfig, assign, fromPromise, sendTo, setup } from "xstate";
import { notices, utterances } from "../config/prompts";
import { settings } from "../config/settings";
import { rankWithSemantics } from "../core/ranking";
import { applyFailure, applyResults, applySeed, rules } from "../core/rules";
import { criteriaFromIS, hasSignal, tasteProfile } from "../core/state";
import type {
  DMEContext, DMEEvent, InformationState, LlmClient, Move, Movie, Reply, SaysMovesEvent, SearchCriteria, TmdbClient,
} from "../core/types";
import { isDebug, last } from "../core/util";
import { respond } from "./respond";
import { understand } from "./nlu";


const logIS = (what: string, is: InformationState) => {
  console.info(`[ISU ${what}]`);
  if (isDebug()) console.dir(is, { depth: null, colors: true });
};

/** Transition guarded by an ISU rule: the rule is both the precondition and the effect. */
const isuTransition = (target: string, rule: string): AnyTransitionConfig => ({
  target,
  guard: { type: "isu", params: { name: rule } },
  actions: [{ type: "isu", params: { name: rule } }],
});

/** Optional rules in sequence: each fires if it applies, then we move on (several moves can arrive at once). */
function ruleChain(names: string[]) {
  const states: Record<string, object> = {};
  names.forEach((name, i) => {
    const next = i + 1 < names.length ? names[i + 1] : "Done";
    states[name] = { always: [isuTransition(next, name), { target: next }] };
  });
  states.Done = { type: "final" };
  return { initial: names[0], states } as any;
}

/** Add a notice for the LLM to mention (what happened behind the scenes this turn). */
const withNotice = (is: InformationState, text: string): InformationState => ({
  ...is,
  private: { ...is.private, notices: [...is.private.notices, text] },
});

const INTEGRATE_RULES = [
  "integrate_retry_failed",
  "integrate_restart",
  "integrate_prefer",
  "integrate_constrain",
  "integrate_adjust",
  "integrate_retract",
  "integrate_vibe",
  "integrate_like",
  "integrate_seen_reject",
  "integrate_recommend",
  "filter_candidates",
];

export const dme = setup({
  types: {} as { input: DMEContext; context: DMEContext; events: DMEEvent },
  guards: {
    isu: ({ context }, params: { name: string }) => !!rules[params.name](context),
    isUserSpeech: ({ event }) => {
      const v = (event as SaysMovesEvent).value;
      return v.speaker === "usr" && !!v.text?.trim();
    },
    latestSpeakerIsUsr: ({ context }) => context.latest_speaker === "usr",
    latestSpeakerIsSys: ({ context }) => context.latest_speaker === "sys",
    seedPending: ({ context }) => context.is.private.agenda.some((a) => a.type === "resolve_seed"),
    // Genres alone are handled by TMDB + the weighted score; embed only with a vibe or a liked movie.
    canSemanticRank: ({ context: c }) =>
      !!c.embedder &&
      (c.is.vibe.length > 0 || c.is.prefs.seeds.length > 0) &&
      !!tasteProfile(c.is) &&
      c.is.candidates.length > 0 &&
      c.latest_speaker === "usr" &&
      last(c.is.history)?.text !== settings.dialogue.silenceMarker,
    needSearch: ({ context }) => context.is.search.status === "dirty" && hasSignal(context.is),
  },
  actions: {
    sendBackNextMoves: sendTo(
      ({ context }) => context.parentRef,
      ({ context }) => ({ type: "NEXT_MOVES", value: context.is.next_moves })
    ),
    isu: assign(({ context }, params: { name: string }) => {
      const is = rules[params.name](context)!(); // never called without its guard
      logIS(params.name, is);
      return { is };
    }),
    updateLatestMoves: assign(({ context, event }) => {
      const v = (event as SaysMovesEvent).value;
      return {
        latest_moves: v.moves ?? [],
        latest_speaker: v.speaker,
        latest_text: v.text,
        is: { ...context.is, next_moves: [] },
      };
    }),
  },
  actors: {
    /** LLM: what did the user just express? (utterance → moves) */
    understand: fromPromise(async ({ input }: { input: { llm: LlmClient; text: string; is: InformationState } }) =>
      understand(input.llm, input.text, input.is)
    ),
    /** LLM: what do we say, and which candidate (if any) do we suggest? */
    respond: fromPromise(async ({ input }: { input: { llm: LlmClient; is: InformationState } }) =>
      respond(input.llm, input.is)
    ),
    semanticRank: fromPromise(
      async ({ input }: { input: { embedder: NonNullable<DMEContext["embedder"]>; profile: string; movies: Movie[] } }) =>
        input.embedder.score(input.profile, input.movies)
    ),
    /** TMDB title lookup for "something like X". */
    resolveSeed: fromPromise(async ({ input }: { input: { tmdb: TmdbClient; title: string } }) =>
      input.tmdb.searchMovie(input.title)
    ),
    /** TMDB discover with the current constraints. */
    search: fromPromise(async ({ input }: { input: { tmdb: TmdbClient; criteria: SearchCriteria } }) =>
      input.tmdb.discover(input.criteria)
    ),
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "Select",
  states: {
    Select: {
      initial: "Respond",
      states: {
        Respond: {
          invoke: {
            src: "respond",
            input: ({ context }) => ({ llm: context.llm, is: context.is }),
            onDone: {
              target: "SelectionDone",
              actions: assign(({ context, event }) => {
                const r = event.output as Reply;
                const move: Move = { type: "say", text: r.say, movieId: r.movieId };
                return { is: { ...context.is, next_moves: [move] } };
              }),
            },
            onError: {
              target: "SelectionDone",
              actions: assign(({ context, event }) => {
                console.error("[LLM respond failed]", event.error);
                const move: Move = { type: "say", text: utterances.systemError };
                return { is: { ...context.is, next_moves: [move] } };
              }),
            },
          },
        },
        SelectionDone: { always: [{ actions: [{ type: "sendBackNextMoves" }] }], type: "final" },
      },
      onDone: "Update",
    },
    Update: {
      initial: "Init",
      states: {
        Init: { always: isuTransition("Grounding", "clear_agenda") },
        Grounding: {
          on: {
            SAYS: [
              {
                // user speech: ask the LLM what it means
                guard: "isUserSpeech",
                target: "Understand",
                actions: assign(({ event }) => ({
                  latest_speaker: "usr" as const,
                  latest_text: (event as SaysMovesEvent).value.text,
                })),
              },
              {
                // system speech, or user silence (a noinput move)
                target: "Integrate",
                actions: [{ type: "updateLatestMoves" }, { type: "isu", params: { name: "get_latest_move" } }],
              },
            ],
          },
        },
        Understand: {
          invoke: {
            src: "understand",
            input: ({ context }) => ({ llm: context.llm, text: context.latest_text ?? "", is: context.is }),
            onDone: {
              target: "Integrate",
              actions: [
                assign(({ context, event }) => ({
                  latest_moves: event.output as Move[],
                  is: { ...context.is, next_moves: [] },
                })),
                { type: "isu", params: { name: "get_latest_move" } },
              ],
            },
            onError: {
              target: "Integrate",
              actions: [
                assign(({ context, event }) => {
                  console.error("[LLM understand failed]", event.error);
                  return {
                    latest_moves: [] as Move[],
                    is: withNotice({ ...context.is, next_moves: [] }, notices.understandFailed),
                  };
                }),
                { type: "isu", params: { name: "get_latest_move" } },
              ],
            },
          },
        },
        Integrate: { ...ruleChain(INTEGRATE_RULES), onDone: "Retrieve" },
        /** Only after a user turn. Loop: resolve pending seed titles → search if dirty → next page if the pool ran dry. */
        Retrieve: {
          initial: "Check",
          states: {
            Check: {
              always: [
                { guard: "latestSpeakerIsSys", target: "Done" },
                { guard: "seedPending", target: "ResolveSeed" },
                { guard: "needSearch", target: "Search" },
                isuTransition("Check", "next_page"),
                { target: "Done" },
              ],
            },
            ResolveSeed: {
              invoke: {
                src: "resolveSeed",
                input: ({ context }) => ({
                  tmdb: context.tmdb,
                  title: context.is.private.agenda.find((a) => a.type === "resolve_seed")?.title ?? "",
                }),
                onDone: {
                  target: "Check",
                  actions: assign(({ context, event }) => {
                    const is = applySeed(context.is, event.output as Movie | null);
                    logIS("resolve_seed", is);
                    return { is };
                  }),
                },
                onError: {
                  target: "Check",
                  actions: assign(({ context, event }) => {
                    console.error("[TMDB resolveSeed failed]", event.error);
                    return { is: applyFailure(context.is) };
                  }),
                },
              },
            },
            Search: {
              invoke: {
                src: "search",
                input: ({ context }) => ({ tmdb: context.tmdb, criteria: criteriaFromIS(context.is) }),
                onDone: {
                  target: "Check",
                  actions: assign(({ context, event }) => {
                    const is = applyResults(context.is, event.output as Movie[]);
                    logIS("search_result", is);
                    return { is };
                  }),
                },
                onError: {
                  target: "Check",
                  actions: assign(({ context, event }) => {
                    console.error("[TMDB search failed]", event.error);
                    return { is: applyFailure(context.is) };
                  }),
                },
              },
            },
            Done: { type: "final" },
          },
          onDone: "SemanticGate",
        },
        SemanticGate: { always: [{ guard: "canSemanticRank", target: "SemanticRank" }, { target: "Done" }] },
        SemanticRank: {
          invoke: {
            src: "semanticRank",
            input: ({ context }) => ({
              embedder: context.embedder!,
              profile: tasteProfile(context.is)!,
              movies: context.is.candidates,
            }),
            onDone: {
              target: "Done",
              actions: assign(({ context, event }) => ({
                is: {
                  ...context.is,
                  candidates: rankWithSemantics(context.is, context.is.candidates, event.output as Map<number, number>),
                },
              })),
            },
            onError: {
              target: "Done",
              actions: ({ event }) => console.warn("[semantic ranking unavailable; keeping weighted order]", event.error),
            },
          },
        },
        Done: { type: "final" },
      },
      onDone: [{ target: "Select", guard: "latestSpeakerIsUsr" }, { target: "Update" }],
    },
  },
});
