/**
 * Typed chat through the REAL pipeline (LLM + TMDB + dialogue manager), no speech.
 * Run: npm run chat      (DEBUG=1 npm run chat  to dump the information state each rule)
 * It first asks for tonight's settings: one of the files in profiles/ (the same JSON the browser form produces).
 * After each reply it prints the turn as one group (moves, state, reply mode, LLM calls, top 5), the same as the
 * browser's console. Commands: /state prints that group now. /quit exits.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Intake, parseIntake } from "../src/core/intake";
import { createActor, sendTo, setup } from "xstate";
import { llmBackends } from "../src/config/services";
import { settings } from "../src/config/settings";
import { initialIS } from "../src/core/state";
import { spokenText } from "../src/core/util";
import type { DMEContext, NextMovesEvent } from "../src/core/types";
import { createTurnLog, describePool, describeTonight, logState } from "../src/dialogue/debugView";
import { dme } from "../src/dialogue/dme";
import { createClients } from "../src/services";
import { orderByPreference } from "../src/services/llm";
import { formText as T } from "../src/config/prompts";
import { poolCheck, type Pool } from "../src/core/pool";
import { createNodePool } from "../src/services/catalogue";
import { loadEnv } from "./env";

const env = loadEnv();
const turnLog = createTurnLog();
const clients = createClients("upstream", env, { onLlmAnswer: turnLog.onLlmAnswer });
const { pool: loadPool } = createNodePool(clients.tmdb, console.log);
const enabledBackends = llmBackends.filter((b) => b.enabled !== false);
const order = (prefer?: string | string[]) => orderByPreference(enabledBackends, prefer).map((b) => `${b.name}:${b.model}`).join(" → ");
console.log(`NLU backends (in order): ${order(settings.llm.understand.prefer)}`);
console.log(`NLG backends (in order): ${order(settings.llm.respond.prefer)}`);
if (!env.DEBUG) console.info = () => {}; // hide per-rule logs unless DEBUG=1

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("close", () => process.exit(0));
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

/** Phase 1 ends: pick a profile, fetch tonight's movies, and check there are enough (the same rule as the browser form). */
async function intakeAndPool(): Promise<{ intake: Intake; pool: Pool }> {
  for (;;) {
    const intake = await pickIntake();
    console.log(`Profile: ${describeTonight(intake)}`);
    console.log(T.pool.finding);
    let pool: Pool;
    try {
      pool = await loadPool(intake);
    } catch (e) {
      console.log(T.pool.failed((e as Error).message));
      continue;
    }
    console.log(`Pool: ${describePool(pool)}`);
    const check = poolCheck(pool);
    if (check === "ok") return { intake, pool };
    if (check === "empty") {
      console.log(`${T.pool.empty} ${T.pool.change}:`);
      continue;
    }
    const answer = (await rl.question(`${T.pool.small(pool.movies.length)} ${T.pool.goAnyway}? (y/n) `)).trim().toLowerCase();
    if (answer.startsWith("y")) return { intake, pool };
  }
}

const { intake, pool } = await intakeAndPool();

const machine = setup({
  types: {} as { events: NextMovesEvent | { type: "USER"; text: string } },
  actors: { dme },
}).createMachine({
  invoke: {
    src: "dme",
    id: "dme",
    input: ({ self }): DMEContext => ({ parentRef: self, ...clients, pool, vectors: new Map(), is: initialIS(intake) }),
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
          turnLog.turn(dmeContext());
          console.log(`\nassistant> ${spokenText(event.value)}   (${Date.now() - turnStart}ms)\n`);
          rl.prompt();
        },
        sendTo("dme", ({ event }) => ({ type: "SAYS", value: { speaker: "sys", moves: event.value } })),
      ],
    },
  },
});

const actor = createActor(machine).start();
const dmeContext = (): DMEContext => (actor.getSnapshot().children.dme as any).getSnapshot().context;

rl.setPrompt("you> ");
rl.on("line", (line) => {
  const text = line.trim();
  if (text === "/quit") return process.exit(0);
  if (text === "/state") {
    logState(dmeContext());
    return rl.prompt();
  }
  turnStart = Date.now();
  actor.send({ type: "USER", text });
});
