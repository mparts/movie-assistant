/**
 * Top-level machine for the browser: Phase 1 (the settings form) and then the spoken chat, with speechstate
 * around the dialogue manager.  Prepare → Intake (form; INTAKE_DONE) → FindingMovies (tonight's pool) → Main (chat;
 * CHANGE_SETTINGS goes back). Too few movies (or none, or an error) → PoolCheck: GO_ANYWAY or CHANGE_SETTINGS.
 */
import { createActor, setup, assign, sendTo, fromPromise, type AnyMachineSnapshot } from "xstate";
import { speechstate, type Settings } from "speechstate";
import { azure } from "../config/services";
import { settings } from "../config/settings";
import type { Intake } from "../core/intake";
import { poolCheck, type Pool } from "../core/pool";
import { initialIS } from "../core/state";
import type { DMContext, DMEvent, NextMovesEvent } from "../core/types";
import { createClients } from "../services";
import { fetchPool } from "../services/poolVectorsClient";
import { dme } from "../dialogue/dme";
import { nlg } from "../dialogue/nlg";

const clients = createClients("proxy");

const speechSettings: Settings = {
  azureCredentials: { endpoint: azure.tokenEndpoint, key: import.meta.env.VITE_AZURE_KEY },
  azureRegion: azure.region,
  locale: settings.speech.locale,
  ttsDefaultVoice: settings.speech.voice,
  asrDefaultNoInputTimeout: settings.speech.noInputTimeoutMs,
  asrDefaultCompleteTimeout: settings.speech.completeTimeoutMs,
  bargeIn: settings.speech.bargeIn,
};

const dmMachine = setup({
  actors: {
    dme,
    /** The dev server loads it (local catalogue or TMDB) with the same code as the typed chat. */
    loadPool: fromPromise(({ input }: { input: { intake: Intake } }): Promise<Pool> => fetchPool(input.intake)),
  },
  actions: {
    speak: ({ context }) => context.ssRef.send({ type: "SPEAK", value: { utterance: context.jakeSaid ?? "" } }),
    listen: ({ context }) => context.ssRef.send({ type: "LISTEN" }),
  },
  types: {} as { context: DMContext; events: DMEvent },
}).createMachine({
  context: ({ spawn }) => ({ ssRef: spawn(speechstate, { input: speechSettings }), ...clients }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.ssRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "Intake" },
    },
    /** The form is on screen. A new conversation starts from its answers; nothing from an earlier one is kept. */
    Intake: {
      on: {
        INTAKE_DONE: {
          target: "FindingMovies",
          actions: assign(({ event }) => ({
            is: initialIS(event.intake), pool: undefined, poolError: undefined, jakeSaid: undefined, lastUtterance: undefined,
          })),
        },
      },
    },
    /** Tonight's pool: the movies that pass the settings, with their vectors. */
    FindingMovies: {
      invoke: {
        src: "loadPool",
        input: ({ context }) => ({ intake: context.is!.intake }),
        onDone: [
          {
            guard: ({ event }) => poolCheck(event.output) === "ok",
            target: "Main",
            actions: assign(({ event }) => ({ pool: event.output })),
          },
          { target: "PoolCheck", actions: assign(({ event }) => ({ pool: event.output })) },
        ],
        onError: { target: "PoolCheck", actions: assign(({ event }) => ({ poolError: (event.error as Error).message })) },
      },
    },
    /** Too few movies, none, or an error: the page says so. Going anyway needs at least one movie. */
    PoolCheck: {
      on: {
        GO_ANYWAY: { guard: ({ context }) => !!context.pool?.movies.length, target: "Main" },
        CHANGE_SETTINGS: "Intake",
      },
    },
    Main: {
      // Leaving Main stops the DME. Speech is not stopped (speechstate cannot restart after STOP): the form waits
      // until speech is idle before it lets a new conversation start.
      on: { CHANGE_SETTINGS: "Intake" },
      type: "parallel",
      states: {
        Interpret: {
          initial: "Idle",
          states: {
            Idle: {
              on: { SPEAK_COMPLETE: { target: "Recognising", actions: [assign({ lastUtterance: () => "" }), "listen"] } },
            },
            Recognising: {
              on: {
                LISTEN_COMPLETE: {
                  target: "Idle",
                  // raw text goes to the DME, which asks the LLM what it means; silence is a noinput move
                  actions: sendTo("dmeID", ({ context }) => ({
                    type: "SAYS",
                    value: context.lastUtterance
                      ? { speaker: "usr", text: context.lastUtterance }
                      : { speaker: "usr", moves: [{ type: "noinput" }] },
                  })),
                },
                RECOGNISED: { actions: assign(({ event }) => ({ lastUtterance: event.value[0].utterance })) },
                ASR_NOINPUT: { actions: assign({ lastUtterance: () => "" }) },
              },
            },
          },
        },
        Generate: {
          initial: "Idle",
          states: {
            Idle: {
              on: {
                NEXT_MOVES: {
                  target: "Speaking",
                  actions: [
                    assign(({ event }) => ({ jakeSaid: nlg((event as NextMovesEvent).value) })),
                    sendTo("dmeID", ({ event }) => ({ type: "SAYS", value: { speaker: "sys", moves: event.value } })),
                  ],
                },
              },
            },
            Speaking: { entry: "speak", on: { SPEAK_COMPLETE: { target: "Idle" } } },
          },
        },
        DME: {
          invoke: {
            src: "dme",
            id: "dmeID",
            input: ({ context, self }) => ({
              parentRef: self,
              tmdb: context.tmdb,
              llm: context.llm,
              embedQuery: context.embedQuery,
              pool: context.pool as Pool, // set by FindingMovies, the only way into Main
              vectors: new Map(),
              is: context.is!, // set by INTAKE_DONE
            }),
          },
        },
      },
    },
  },
});

export const dmActor = createActor(dmMachine).start();

/** speechstate's own view of itself: "not-ready", "idle", "speaking", "recognising", ... */
export const speechView = (): string =>
  (Object.values(dmActor.getSnapshot().context.ssRef.getSnapshot().getMeta())[0] as { view?: string } | undefined)?.view ?? "";

/** Calls `f` whenever the machine or speechstate changes. */
export function onChange(f: () => void) {
  dmActor.subscribe(f);
  dmActor.getSnapshot().context.ssRef.subscribe((_: AnyMachineSnapshot) => f());
}
