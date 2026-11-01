/** Top-level machine for the browser: speech in/out (speechstate) around the dialogue manager. */
import { createActor, setup, assign, sendTo, type AnyMachineSnapshot } from "xstate";
import { speechstate, type Settings } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { azure } from "../config/services";
import { settings } from "../config/settings";
import { initialIS } from "../core/state";
import type { DMContext, DMEvent, NextMovesEvent } from "../core/types";
import { createClients } from "../services";
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
  actors: { dme },
  actions: {
    speak: ({ context, event }) =>
      context.ssRef.send({ type: "SPEAK", value: { utterance: nlg((event as NextMovesEvent).value) } }),
    listen: ({ context }) => context.ssRef.send({ type: "LISTEN" }),
  },
  types: {} as { context: DMContext; events: DMEvent },
}).createMachine({
  context: ({ spawn }) => ({ ssRef: spawn(speechstate, { input: speechSettings }), ...clients, is: initialIS() }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.ssRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: { on: { CLICK: "Main" } },
    Main: {
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
                  actions: sendTo("dmeID", ({ event }) => ({ type: "SAYS", value: { speaker: "sys", moves: event.value } })),
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
              embedder: context.embedder,
              is: context.is,
            }),
          },
        },
      },
    },
  },
});

export const dmActor = createActor(dmMachine, { inspect: createBrowserInspector().inspect }).start();

dmActor.subscribe((s: AnyMachineSnapshot) => console.log("%cState value:", "background-color: #056dff", s.value));

/** Wires the start button to the machine and mirrors speechstate's view into it. */
export function setupButton(button: HTMLElement) {
  button.addEventListener("click", () => dmActor.send({ type: "CLICK" }));
  dmActor.getSnapshot().context.ssRef.subscribe((s: AnyMachineSnapshot) => {
    button.innerHTML = `${Object.values(s.getMeta())[0]["view"]}`;
  });
}
