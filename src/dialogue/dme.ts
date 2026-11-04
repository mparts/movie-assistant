/**
 * Dialogue Manager Engine (xstate). One turn = Select (say something) → Update (hear + integrate + retrieve).
 *   Select:  respond() → one `say` move, sent to the parent.
 *   Update:  Init → Grounding (wait for SAYS) → Understand (LLM) → Integrate (rule chain)
 *            → Retrieve (embed new wish/avoid texts → rank tonight's pool) → Done.
 * Ranking is local and synchronous (core/ranking.ts): no TMDB search during the chat.
 */
import { AnyTransitionConfig, assign, fromPromise, sendTo, setup } from "xstate";
import { notices, utterances } from "../config/prompts";
import { applyRanking, rules, withNotice } from "../core/rules";
import type { DMEContext, DMEEvent, EmbedQuery, InformationState, LlmClient, Move, Reply, SaysMovesEvent } from "../core/types";
import { flushTimings, isDebug, timed, timedSync } from "../core/util";
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


const INTEGRATE_RULES = [
  "integrate_wish",
  "integrate_avoid",
  "integrate_person",
  "integrate_seen_reject",
  "integrate_recommend",
  "integrate_qud",
];

/** Cache keys in `context.vectors`: a query text (wish or avoid). */
const textKey = (text: string) => `q:${text}`;

/** Wish and avoid texts that have no query vector yet. */
const unembedded = (c: DMEContext) => [c.is.wish, ...c.is.avoid].filter((t) => t && !c.vectors.has(textKey(t)));

/** The query side of the ranking, from the cache (anything missing is simply left out). */
const queryVectors = (c: DMEContext) => ({
  wish: c.is.wish ? c.vectors.get(textKey(c.is.wish)) : undefined,
  avoid: c.is.avoid.flatMap((t) => c.vectors.get(textKey(t)) ?? []),
});

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
    needVectors: ({ context }) => unembedded(context).length > 0,
  },
  actions: {
    sendBackNextMoves: sendTo(
      ({ context }) => context.parentRef,
      ({ context }) => ({ type: "NEXT_MOVES", value: context.is.next_moves })
    ),
    flushTimings: () => {
      flushTimings();
    },
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
      timed("NLU", () => understand(input.llm, input.text, input.is))
    ),
    /** LLM: what do we say, and which candidate (if any) do we suggest? */
    respond: fromPromise(async ({ input }: { input: { llm: LlmClient; is: InformationState } }) =>
      timed("respond", () => respond(input.llm, input.is))
    ),
    /** Query vectors for new wish and avoid texts (about 40 ms each). */
    embed: fromPromise(async ({ input }: { input: { embedQuery: EmbedQuery; texts: string[] } }) =>
      timed("embeddings", async () => {
        const out = new Map<string, Float32Array>();
        for (const t of input.texts) out.set(t, await input.embedQuery(t));
        return out;
      })
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
                const move: Move = { type: "say", text: r.say, movieId: r.movieId, mode: r.mode };
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
        SelectionDone: { always: [{ actions: [{ type: "sendBackNextMoves" }, { type: "flushTimings" }] }], type: "final" },
      },
      onDone: "Update",
    },
    Update: {
      initial: "Init",
      states: {
        Init: { always: isuTransition("Grounding", "clear_notices") },
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
        /** Only after a user turn. Loop: embed new texts → rank tonight's pool. */
        Retrieve: {
          initial: "Check",
          states: {
            Check: {
              always: [
                { guard: "latestSpeakerIsSys", target: "Done" },
                { guard: "needVectors", target: "Embed" },
                { target: "Rank" },
              ],
            },
            Embed: {
              invoke: {
                src: "embed",
                input: ({ context }) => ({ embedQuery: context.embedQuery, texts: unembedded(context) }),
                onDone: {
                  target: "Check",
                  actions: assign(({ context, event }) => {
                    const vectors = new Map(context.vectors);
                    for (const [t, v] of event.output as Map<string, Float32Array>) vectors.set(textKey(t), v);
                    return { vectors };
                  }),
                },
                // Without the vectors the ranking still works (people, popularity); try again next turn.
                onError: {
                  target: "Rank",
                  actions: ({ event }) => console.warn("[embeddings unavailable; ranking without the wish this turn]", event.error),
                },
              },
            },
            Rank: {
              always: {
                target: "Done",
                actions: assign(({ context }) => {
                  const is = timedSync("rank", () => applyRanking(context.is, context.pool, queryVectors(context)));
                  logIS("rank_pool", is);
                  return { is };
                }),
              },
            },
            Done: { type: "final" },
          },
          onDone: "Done",
        },
        Done: { type: "final" },
      },
      onDone: [{ target: "Select", guard: "latestSpeakerIsUsr" }, { target: "Update" }],
    },
  },
});
