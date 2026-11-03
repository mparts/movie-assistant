# Jake — a spoken movie assistant

TypeScript · xstate (Information State Update dialogue manager) · speechstate (Azure) · TMDB · Groq / Ollama · Ollama embeddings.

**Language scope: English only.** Speech recognition, prompts, TMDB queries and genre names are all English.

## Where things live

| You want to change…                                              | File                               |
| ---------------------------------------------------------------- | ---------------------------------- |
| API keys (secrets only)                                          | `.env.local` (copy `.env.example`) |
| URLs, models, ports, timeouts, LLM fallback order, embeddings    | `src/config/services.ts`           |
| Everything Jake says or is told (prompts, fixed lines, notices)  | `src/config/prompts.ts`            |
| Every tunable number (ranking weights, paging, limits, voice, …) | `src/config/settings.ts`           |

```
src/
  config/     services.ts · prompts.ts · settings.ts      ← the only places to edit values/text
  core/       state, rules (ISU), ranking, constraints, readiness, lexicon, types   (pure, no I/O)
  services/   llm, tmdb, embeddings, index.ts (createClients)                      (all network I/O)
  dialogue/   dme (xstate machine), nlu, respond, nlg
  browser/    main, dm (speech wiring), style.css
scripts/      chat (typed chat), probe (check services), env
test/
```

## Run

```
cp .env.example .env.local     # fill TMDB_TOKEN, GROQ_API_KEY, VITE_AZURE_KEY
npm install
npm run dev                    # voice app; Vite proxies services, keys stay server-side
npm run chat                   # typed chat through the real pipeline (DEBUG=1 for state dumps)
npm run probe                  # checks TMDB, embeddings and the LLM backends
npm test
```

University Ollama: `ssh -f -N -L 11435:127.0.0.1:11434 mltgpu-2`. Disable a backend with `enabled: false` in `llmBackends`; turn embeddings off with `embeddings.enabled`.
`chat` and `probe` cache movie-description vectors and runtimes in `.cache/` (git-ignored; paths and sizes in `settings.embeddingCache` and `settings.runtimeCache`). Delete the files to reset them.

## Flow

Select (Jake responds) → Update: Grounding → Understand (LLM → moves) → Integrate (rule chain) → Retrieve (seed lookup / TMDB search loop) → SemanticRank (embeddings) → next turn.
The LLM only extracts moves and words the reply; rules own the state.
