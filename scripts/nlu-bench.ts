/**
 * Runs the NLU cases against local (or tunnelled) Ollama models and prints one comparison table.
 *
 *   npm run nlu-bench -- --model qwen2.5:3b-instruct --model llama3.2:3b
 *   npm run nlu-bench -- --model llama3.1:latest --url http://localhost:11435/v1     (university, via the SSH tunnel)
 *   npm run nlu-bench -- --backend local                          (a backend from llmBackends, even a disabled one)
 *
 * Options: --model <name> (repeatable), --url <OpenAI-compatible base URL> (default: local Ollama /v1),
 *          --backend <name> (repeatable; resolved exactly like production does), --verbose (show failing moves).
 * Never calls Groq: remote hosts other than localhost are refused, so a typo cannot spend the daily limit.
 */
import { llmBackends } from "../src/config/services";
import { settings } from "../src/config/settings";
import { resolveBackend } from "../src/services";
import { createLlm, type LlmBackend } from "../src/services/llm";
import { formatTable, runBench } from "./nluBench";

const DEFAULT_URL = "http://localhost:11434/v1";

function parseArgs(argv: string[]) {
  const models: string[] = [];
  const names: string[] = [];
  let url = DEFAULT_URL;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") models.push(argv[++i]);
    else if (a === "--backend") names.push(argv[++i]);
    else if (a === "--url") url = argv[++i];
    else if (a === "--verbose") verbose = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { models: models.filter(Boolean), names: names.filter(Boolean), url, verbose };
}

const isLocal = (u: string) => ["localhost", "127.0.0.1"].includes(new URL(u).hostname);

async function main() {
  const { models, names, url, verbose } = parseArgs(process.argv.slice(2));
  const targets: LlmBackend[] = [
    ...names.map((n) => {
      const cfg = llmBackends.find((b) => b.name === n);
      if (!cfg) throw new Error(`No backend "${n}" in llmBackends (have: ${llmBackends.map((b) => b.name).join(", ")})`);
      return resolveBackend(cfg, "upstream");
    }),
    ...models.map((model) => ({ name: model, baseUrl: url, model, timeoutMs: 120_000 })),
  ];
  if (!targets.length) {
    console.error("Give a model or a backend:  npm run nlu-bench -- --model <ollama model>  |  --backend local");
    process.exit(1);
  }
  const remote = targets.find((t) => !isLocal(t.baseUrl));
  if (remote) {
    console.error(`Refusing ${new URL(remote.baseUrl).hostname}: this bench is for local Ollama only (use an SSH tunnel on localhost for the university one).`);
    process.exit(1);
  }

  const rows = [];
  for (const t of targets) {
    const label = t.name === t.model ? t.model : `${t.name} (${t.model})`;
    console.log(`\n>>> ${label}`);
    const { warmupMs, results, summary } = await runBench(createLlm([{ ...t, timeoutMs: Math.max(t.timeoutMs, 120_000) }]));
    rows.push({ model: label, warmupMs, summary });
    for (const r of results.filter((r) => r.status !== "ok")) {
      console.log(`  ${r.status.toUpperCase()}  ${r.name}: ${r.why}${verbose && r.moves ? `\n      moves: ${JSON.stringify(r.moves)}` : ""}`);
    }
  }
  console.log(`\n${formatTable(rows)}`);
  console.log(`\nSettings used: understand temperature ${settings.llm.understand.temperature}, max tokens ${settings.llm.understand.maxTokens}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
