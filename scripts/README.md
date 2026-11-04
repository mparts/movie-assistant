# scripts

Node tools run with `tsx`, one per npm command. They use the same code as the browser, from `src/`, with real URLs and keys (`createClients("upstream")`).

- `env.ts` has `loadEnv`, which returns `process.env` with `.env.local` laid over it. Every script below that needs a key uses it.

## npm run chat

- `chat.ts` is the typed chat: the full pipeline (dialogue manager, LLMs, embeddings, TMDB) without speech. This is where NLU and NLG changes get tried out. It asks you to pick a profile from `profiles/`, the same JSON the browser form produces, then loads tonight's pool with `createNodePool` and checks it is large enough. After each reply it prints the turn's debug group, the same as the browser console. `/state` prints that group again, `/quit` exits, and `DEBUG=1` also dumps the full information state after every rule. Every turn costs one NLU call and one NLG call.

## npm run nlu-bench

- `nlu-bench.ts` runs the cases against one or more models and prints one table: correct, wrong, invalid, and the p50 and p95 call times. `--model` takes an Ollama model name and `--url` its OpenAI-compatible base URL (local Ollama by default). `--backend` takes a name from `llmBackends`, resolved exactly as the app does, so it works for disabled backends too. `--verbose` prints the moves of each failing case. Any host other than localhost is refused, so the bench can never spend Groq's daily limit. The university server is reached through the SSH tunnel on localhost.
- `nluBench.ts` holds the cases and the scoring, with no I/O of its own, so `test/nluBench.test.ts` can run it against a stub LLM. A case is a state (history, last suggestion, `qud`, wish) plus an utterance and a check on the moves `understand` returns. The checks are loose on purpose: a model should fail for misreading the user, not for different wording. Many cases are taken from real chats that went wrong, such as the `real-*` ones. One warm-up call loads the model before the timed runs.

## npm run rank-bench

- `rank-bench.ts` is the ranking regression set. It loads tonight's real pool for `profiles/family.json` and `profiles/solo.json`, embeds each labelled wish, ranks with the real `rankPool` and reports recall@10 and the number of forbidden titles in the top 10. `--verbose` also prints each top 10, with ✓ for a good title and ✗ for a bad one. It uses TMDB, the local catalogue and local Ollama, with no LLM calls.
- `rankBench-wishes.ts` holds the labelled wishes, `FAMILY` and `ADULT`. Each has `said` (the user's words), `wish` (the same as the NLU would rewrite it), optional `avoid` texts, `good` titles that should reach the top 10, and `bad` titles or `badKeywords` (TMDB keywords) that must not. "Robin Hood (1973)" pins one version of a title. The labels were picked by hand, not taken from the ranking's output.

## npm run embed-catalogue

- `embed-catalogue.ts` builds or tops up the local catalogue in `.cache/`. It walks every TMDB movie with at least `settings.catalogue.minVotes` votes and `settings.intake.minMinutes` minutes, and hands them to `ensureVectors`. Only new movies get details fetched, and only new or changed texts get embedded. At the end it records what the walk covered and when, which tells `createNodePool` whether the local copy can answer a pool on its own. It makes no LLM calls, but a first run takes a while.
