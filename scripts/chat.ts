/**
 * Typed chat through the REAL pipeline (LLM + TMDB + dialogue manager), no speech.
 * Run: npm run chat      (DEBUG=1 npm run chat  to dump the information state each rule)
 * It first asks for tonight's settings: one of the files in profiles/ (the same JSON the browser form produces).
 * Commands: /state shows what the assistant has noted about you; /quit exits.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { certificationFor, Intake, parseIntake } from "../src/core/intake";
import { createActor, sendTo, setup } from "xstate";
import { llmBackends } from "../src/config/services";
import { settings } from "../src/config/settings";
import { initialIS, stateSummary } from "../src/core/state";
import type { DMEContext, Movie, NextMovesEvent } from "../src/core/types";
import { dme } from "../src/dialogue/dme";
import { nlg } from "../src/dialogue/nlg";
import { createClients } from "../src/services";
import { orderByPreference } from "../src/services/llm";
import { createFileStore } from "../src/services/embeddingStore";
import { createRuntimeFileStore } from "../src/services/runtimeStore";
import { loadEnv } from "./env";

const env = loadEnv();
const clients = createClients("upstream", env, {
  // After every LLM call: what it was for, who answered, how long, and who failed first.
  onLlmAnswer: (a) =>
    console.log(`  [${a.purpose ?? "LLM"}] ${a.backend} (${a.model}) ${Math.round(a.ms)}ms${a.failed.length ? `, after ${a.failed.join(", ")} failed` : ""}`),
  embeddingStore: createFileStore(settings.embeddingCache.path, settings.embeddingCache.maxEntries),
  runtimeStore: createRuntimeFileStore(settings.runtimeCache.path, settings.runtimeCache.maxEntries),
});
const enabledBackends = llmBackends.filter((b) => b.enabled !== false);
const order = (prefer?: string | string[]) => orderByPreference(enabledBackends, prefer).map((b) => `${b.name}:${b.model}`).join(" → ");
console.log(`NLU backends (in order): ${order(settings.llm.understand.prefer)}`);
console.log(`NLG backends (in order): ${order(settings.llm.respond.prefer)}`);
if (!env.DEBUG) console.info = () => {}; // hide per-rule logs unless DEBUG=1

const rl = createInterface({ input: process.stdin, output: process.stdout });
let turnStart = Date.now();

/** Phase 1 in the terminal: pick a settings file from profiles/ (stands in for the browser form). Asks again on a bad file. */
async function pickIntake(): Promise<Intake> {
  const dir = "profiles";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No profiles in ${dir}/`);
  files.forEach((f, i) => console.log(`  ${i + 1}. ${f.replace(/\.json$/, "")}`));
  for (;;) {
    const answer = (await rl.question("Who is watching tonight? (number) ")).trim();
    const file = files[Number(answer) - 1];
    if (!file) continue;
    try {
      return parseIntake(JSON.parse(readFileSync(join(dir, file), "utf8")));
    } catch (e) {
      console.log(`  ${file}: ${(e as Error).message}`);
    }
  }
}

const intake = await pickIntake();
const { profile, tonight } = intake;
const cert = certificationFor(tonight.youngestAge);
console.log(
  `Profile: ${profile.name ?? "Guest"} · ${profile.country} · ${tonight.company}, youngest ${tonight.youngestAge}${cert ? ` → ${cert}` : ""}` +
    ` · ${tonight.maxMinutes ? `≤${tonight.maxMinutes} min` : "no time limit"}` +
    ` · ${profile.platforms.length ? `platforms ${profile.platforms.join("|")}` : "any platform"}` +
    (tonight.avoidGenres.length ? ` · avoid ${tonight.avoidGenres.join(", ")}` : "")
);

const machine = setup({
  types: {} as { events: NextMovesEvent | { type: "USER"; text: string } },
  actors: { dme },
}).createMachine({
  invoke: {
    src: "dme",
    id: "dme",
    input: ({ self }): DMEContext => ({ parentRef: self, ...clients, is: initialIS(intake) }),
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
