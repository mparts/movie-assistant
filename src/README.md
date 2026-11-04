# src

The app's source. The browser page and the Node scripts share all of it, except `browser/` (browser only) and `services/catalogue.ts` (Node only).

The folders, from the bottom up:

- `config/` holds wording, tuning numbers and service URLs. No logic, so changing a prompt or a weight never means touching code.
- `core/` holds the information state and everything that changes it without I/O: the update rules, the ranking and the Phase 1 intake.
- `dialogue/` holds the dialogue manager (an xstate machine) and the two LLM calls it makes, one to understand the user and one to write Elisa's reply.
- `services/` holds the clients for the outside world: TMDB, the LLM backends, Ollama embeddings and the local movie catalogue on disk.
- `browser/` holds the page: the settings form, speechstate, and the top-level machine that runs the dialogue manager.

`vite-env.d.ts` tells TypeScript about `import.meta.env`. It declares `VITE_AZURE_KEY`, the Azure speech key. It is the only secret the browser holds, because speechstate talks to Azure directly. Every other key stays on the dev server, which proxies the requests.

One user turn, through the folders:

1. speechstate hears the user (`browser/dm.ts`)
2. the NLU turns the text into moves (`dialogue/nlu.ts`)
3. the update rules write the moves into the information state (`core/rules.ts`)
4. tonight's movies are ranked again (`core/ranking.ts`)
5. the NLG writes Elisa's reply from the best candidates (`dialogue/respond.ts`)
6. speechstate speaks it

In the typed chat (`npm run chat`), `scripts/chat.ts` takes the place of `browser/`.
