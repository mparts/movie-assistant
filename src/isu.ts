import { createActor, setup, AnyMachineSnapshot, sendTo, assign } from "xstate";
import { Settings, speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY } from "./azure";
import { DMContext, DMEvent, NextMovesEvent } from "./types";
import { nlg } from "./nlg";
import { llm, tmdb } from "./services";
import { dme } from "./dme";
import { initialIS } from "./is";

const inspector = createBrowserInspector();

const azureCredentials = {
  endpoint:
    "https://germanywestcentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 7000,
  locale: "en-US",
  azureRegion: "germanywestcentral",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

const dmMachine = setup({
  actors: {
    dme: dme,
  },
  actions: {
    speak_next_moves: ({ context, event }) =>
      context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance: nlg((event as NextMovesEvent).value),
        },
      }),
    listen: ({ context }) =>
      context.ssRef.send({
        type: "LISTEN",
      }),
  },
  types: {} as {
    context: DMContext;
    events: DMEvent;
  },
}).createMachine({
  context: ({ spawn }) => {
    return {
      ssRef: spawn(speechstate, { input: settings }),
      tmdb,
      llm,
      is: initialIS(),
    };
  },
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.ssRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: {
        CLICK: "Main",
      },
    },
    Main: {
      type: "parallel",
      states: {
        Interpret: {
          initial: "Idle",
          states: {
            Idle: {
              on: {
                SPEAK_COMPLETE: {
                  target: "Recognising",
                  actions: [assign({ lastUtterance: () => "" }), "listen"],
                },
              },
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
                RECOGNISED: {
                  actions: assign(({ event }) => ({
                    lastUtterance: event.value[0].utterance,
                  })),
                },
                ASR_NOINPUT: {
                  actions: assign({ lastUtterance: () => "" }),
                },
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
                  actions: sendTo("dmeID", ({ event }) => ({
                    type: "SAYS",
                    value: {
                      speaker: "sys",
                      moves: event.value,
                    },
                  })),
                },
              },
            },
            Speaking: {
              entry: "speak_next_moves",
              on: {
                SPEAK_COMPLETE: {
                  target: "Idle",
                },
              },
            },
          },
        },
        DME: {
          invoke: {
            src: "dme",
            id: "dmeID",
            input: ({ context, self }) => {
              return {
                parentRef: self,
                tmdb: context.tmdb,
                llm: context.llm,
                is: context.is,
              };
            },
          },
        },
      },
    },
  },
});

export const dmActor = createActor(dmMachine, {
  inspect: inspector.inspect,
}).start();

dmActor.subscribe((snapshot: AnyMachineSnapshot) => {
  console.log("%cState value:", "background-color: #056dff", snapshot.value);
});

export function setupButton(element: HTMLElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor
    .getSnapshot()
    .context.ssRef.subscribe((snapshot: AnyMachineSnapshot) => {
      element.innerHTML = `${Object.values(snapshot.getMeta())[0]["view"]}`;
    });
}
