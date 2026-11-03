/**
 * Typed chat through the REAL pipeline (LLM + TMDB + dialogue manager), no speech.
 * Run: npm run chat      (DEBUG=1 npm run chat  to dump the information state each rule)
 * Commands: /state shows what the assistant has noted about you; /quit exits.
 */
import { createInterface } from "node:readline";
import { createActor, sendTo, setup } from "xstate";
import { llmBackends } from "../src/config/services";
import { settings } from "../src/config/settings";
import { initialIS, stateSummary } from "../src/core/state";
import type { DMEContext, Movie, NextMovesEvent } from "../src/core/types";
import { dme } from "../src/dialogue/dme";
import { nlg } from "../src/dialogue/nlg";
import { createClients } from "../src/services";
import { createFileStore } from "../src/services/embeddingStore";
import { createRuntimeFileStore } from "../src/services/runtimeStore";
import { loadEnv } from "./env";

const env = loadEnv();
const clients = createClients("upstream", env, {
  embeddingStore: createFileStore(settings.embeddingCache.path, settings.embeddingCache.maxEntries),
  runtimeStore: createRuntimeFileStore(settings.runtimeCache.path, settings.runtimeCache.maxEntries),
});
console.log(`LLM backends (in order): ${llmBackends.filter((b) => b.enabled !== false).map((b) => `${b.name}:${b.model}`).join(" → ")}`);
if (!env.DEBUG) console.info = () => {}; // hide per-rule logs unless DEBUG=1

const rl = createInterface({ input: process.stdin, output: process.stdout });
let turnStart = Date.now();

const machine = setup({
  types: {} as { events: NextMovesEvent | { type: "USER"; text: string } },
  actors: { dme },
}).createMachine({
  invoke: {
    src: "dme",
    id: "dme",
    input: ({ self }): DMEContext => ({ parentRef: self, ...clients, is: initialIS() }),
  },
  on: {
    USER: {
      actions: sendTo("dme", ({ event }) => ({
        type: "SAYS",
        value: event.text.trim() ? { speaker: "usr", text: event.text } : { speaker: "usr", moves: [{ type: "noinput" }] },
      })),
    },
    NEXT_MOVES: {
      actions: [
        ({ event }) => {
          console.log(`\nassistant> ${nlg(event.value)}   (${Date.now() - turnStart}ms)\n`);
          rl.prompt();
        },
        sendTo("dme", ({ event }) => ({ type: "SAYS", value: { speaker: "sys", moves: event.value } })),
      ],
    },
  },
});

const actor = createActor(machine).start();
const currentIS = () => (actor.getSnapshot().children.dme as any).getSnapshot().context.is;

rl.setPrompt("you> ");
rl.on("line", (line) => {
  const text = line.trim();
  if (text === "/quit") return process.exit(0);
  if (text === "/state") {
    const is = currentIS();
    console.log(
      JSON.stringify(
        { ...stateSummary(is), candidates: is.candidates.map((m: Movie) => m.title), suggested: is.recommended.map((m: Movie) => m.title) },
        null,
        2
      )
    );
    return rl.prompt();
  }
  turnStart = Date.now();
  actor.send({ type: "USER", text });
});
rl.on("close", () => process.exit(0));
