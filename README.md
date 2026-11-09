# E. L. I. S. A.

## Entertainment Lookup with Information-State Architecture

A spoken assistant that helps you pick a movie to watch. Built for the dialogue systems 2 course, on the information state update (ISU) approach, with xstate, speechstate and embeddings.

It works in two phases. Phase 1 is a settings form: who is watching, the youngest viewer's age, a time limit, genres to skip and your streaming services. Those are hard filters, and they decide tonight's pool of movies. Phase 2 is a spoken chat with Elisa about what you are in the mood for, and she suggests movies from that pool until you take one. English only.

The [project report](docs/report.md) covers the design and the results, and the [development history](docs/development-history.md) follows how the app changed, from the course labs to now.

Known bugs and limitations are on the [GitHub issues tab](https://github.com/mparts/movie-assistant/issues).

## First run

You need Node.js (developed on 24) and [Ollama](https://ollama.com).

1. Install the dependencies.

   ```
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the three keys: `TMDB_TOKEN` (the TMDB "API Read Access Token"), `GROQ_API_KEY`, and `VITE_AZURE_KEY` (Azure Speech). The typed chat does not need the Azure key.

3. Pull the embedding model. Ranking needs it, so Ollama must be running whenever Elisa is.

   ```
   ollama pull qwen3-embedding:4b
   ollama pull qwen2.5:7b-instruct    # optional, the last-resort LLM
   ```

   Without the second model, set `enabled: false` on the `local` backend in `src/config/services.ts`.

4. Open the SSH tunnel to the university's llama3.1, which the NLU tries first. Everything was tuned with this model, so run it. Without the tunnel the NLU falls back to Groq, which counts against the daily limit.

   ```
   ssh -f -N -L 11435:127.0.0.1:11434 mltgpu-2
   ```

5. Build the local catalogue: about 23,000 movies with their details and vectors, in `.cache/`. The first run takes a long time (it fetches details from TMDB and embeds every movie). It saves as it goes, so you can stop it and run it again. Later runs only add what is new.

   ```
   npm run embed-catalogue
   ```

6. Start Elisa, in the browser (open the URL it prints and allow the microphone) or as a typed chat in the terminal.

   ```
   npm run dev
   npm run chat
   ```

Groq allows 8,000 tokens per minute, so a live chat waits about 20 seconds between turns, and there is a daily limit as well. `npm test` and `npm run typecheck` need no services.

## The project

```
movie-assistant/
├── index.html          the page shell
├── vite.config.ts      dev server: the API proxies that add the keys, and the /pool endpoint
├── .env.example        the three keys, to copy into .env.local
├── profiles/           sample Phase 1 settings for the typed chat (solo, couple, family)
├── public/             static files (the image for a missing poster)
├── .cache/             the local catalogue and its vectors (git-ignored, built by embed-catalogue)
├── src/
│   ├── config/         prompts, tuning numbers, service URLs and models
│   ├── core/           the information state, the update rules, ranking, the Phase 1 intake
│   ├── dialogue/       the dialogue manager (DME), NLU, NLG, debug view
│   ├── services/       TMDB, the LLM backends, embeddings, the local catalogue
│   └── browser/        the top-level machine with speechstate, the settings form, the page
├── scripts/            typed chat, NLU and ranking benches, catalogue builder
├── test/               vitest unit tests
├── patches/            the local speechstate fix, applied on npm install
└── docs/               the report, the development history, the AI log, the presentation
```

Every folder in the project has a README that goes through its files, apart from `.cache/` (built locally) and `public/` (Vite would ship a README with the page).

## How a conversation runs

Phase 1, once:

1. The settings form (`browser/intakeForm.ts`) checks its answers with `parseIntake` and sends `INTAKE_DONE` to the top-level machine (`browser/dm.ts`).
2. In `FindingMovies`, `fetchPool` posts the settings to `/pool` on the dev server (`vite.config.ts`). There, `createNodePool` takes the matching movies from the local catalogue or from TMDB, makes sure each has a vector (`ensureVectors`), and sends movies and vectors back.
3. With enough movies (`poolCheck`) the machine enters `Main`, which starts the DME (`dialogue/dme.ts`) with `initialIS(intake)` and the pool. Elisa's opening line is fixed, no LLM.

Then every turn:

1. **Elisa speaks.** The DME's Select state calls `respond` and sends her `say` move up as `NEXT_MOVES`. The `Generate` region sends `SPEAK` to speechstate, and passes her move back down to the DME as `SAYS` from `sys`. Her move goes through the update rules like any other: `integrate_recommend` records a suggested movie, and `integrate_qud` notes what her turn left open.
2. **The user speaks.** On `SPEAK_COMPLETE` the `Interpret` region sends `LISTEN`. speechstate streams the audio to Azure, `RECOGNISED` carries the text, and `LISTEN_COMPLETE` ends the turn. Silence becomes a `noinput` move instead.
3. **The DME hears it.** The text arrives as `SAYS` from `usr`, and the Update state starts with `clear_notices`.
4. **Understand.** `understand` (`dialogue/nlu.ts`) makes one LLM call that turns the utterance into moves, unless it is a bare "yes" to a suggestion. The moves then pass `clean`, `repairMoves` and `ground`.
5. **Integrate.** `get_latest_move` records the turn, then the `integrate_*` rules (`core/rules.ts`) write the moves into the information state.
6. **Retrieve.** Any new wish or avoid text is embedded through Ollama (`embedQuery`). `applyRanking` scores the whole pool (`rankPool` in `core/ranking.ts`) and keeps the best `settings.dialogue.candidatesShown` movies as candidates.
7. **Select.** `replyMode` (`dialogue/respond.ts`) picks how Elisa should reply, `respond` makes one LLM call for the reply, and the code checks it. Back to step 1.

The conversation ends when Elisa wraps up after you accept a movie. She then stops listening. The typed chat (`scripts/chat.ts`) runs the same DME, with the terminal in place of speechstate.

## xstate

Two state machines. The top-level one (`browser/dm.ts`) owns the app: `Prepare` (speech warms up) => `Intake` (the form) => `FindingMovies` => `Main`, with `PoolCheck` in between when there are too few movies. `Main` runs three regions in parallel: `Interpret` (listening), `Generate` (speaking) and the DME as a child actor. They talk only through events (`SAYS`, `NEXT_MOVES`), so the DME has no idea speech exists, and the typed chat can drive it from a small machine of its own.

The DME (`dialogue/dme.ts`) alternates Select (say something) and Update (hear, integrate, retrieve), as in the SISU design. Each update rule is wired in as both a guard and an action: the guard asks whether the rule applies, the action applies it. `ruleChain` turns the list of rules into a chain of states that each fire their rule when it applies and move on either way, so several moves from one utterance are all integrated. The LLM calls and the embedding are `fromPromise` actors, and each failure has its own state: a failed reply becomes a fixed "say that again" line, a failed NLU call becomes a notice for the reply, and a failed embedding means the turn is ranked without the wish.

## speechstate

speechstate is an xstate actor around Azure Speech, for both recognition and synthesis. The top-level machine spawns it in its context with the settings from `settings.speech`: US English, the Jenny voice, a 7 second no-input timeout and no barge-in. The machine sends `PREPARE`, `SPEAK` and `LISTEN`, and reacts to `ASRTTS_READY`, `RECOGNISED`, `ASR_NOINPUT`, `LISTEN_COMPLETE` and `SPEAK_COMPLETE`. Turn-taking is strict: Elisa finishes speaking, then she listens.

Choices around it:

- The Azure key is the one secret the browser holds, because speechstate fetches its token from Azure directly. Every other key stays on the dev server.
- speechstate cannot start again after `STOP`. Going back to the settings therefore leaves speech running, and the form waits until it is idle before a new conversation starts.
- Silence is a move of its own (`noinput`), answered with a fixed line and no LLM.
- The local patch `patches/speechstate+2.17.0.patch` is applied by the `postinstall` script. It makes `asr.js` send `LISTEN_COMPLETE` on `onerror`, so a failed Azure abort no longer freezes the dialogue. See [docs/speechstate-asr-hang.md](docs/speechstate-asr-hang.md).
- Phase 1 is a form rather than speech. Hard facts like ages and streaming services are faster and safer to click than to say.

## SISU and the information state

The dialogue manager follows the SISU design: an information state, moves, and update rules that are the only thing allowed to change the state.

- **The state** (`InformationState` in `core/types.ts`) is plain JSON. Next to the usual `private`, `shared` (the latest utterance) and `next_moves`, it holds the domain: `wish` (one sentence describing the movie they want), `avoid`, `people`, `candidates`, `recommended`, `rejected`, `accepted`, and the Phase 1 `intake`, which is read only. `DEBUG=1` dumps it after every rule.
- **Moves** are the only way in. The NLU returns `wish`, `avoid`, `person`, `seen`, `reject` and `accept` moves, and the LLM never touches the state itself. Elisa's own `say` moves are integrated too, which is how a suggestion she makes becomes shared.
- **Rules** (`core/rules.ts`) return their effect when they apply and `undefined` when they do not, so a rule's precondition and effect sit in one function.
- **`qud`** records what Elisa's last turn left open: a taste question, a suggestion, or nothing. It chooses part of the NLU prompt, because "the second one" or "no" mean different things after each.
- **`notices`** in `private` carry what happened behind the scenes (a failed call, a person in none of tonight's movies) to the reply.
- **The pool is not in the state.** Tonight's movies and their vectors are a resource, like a domain database. They are large and never change during the chat.

## TMDB

TMDB is the movie database, and it is used only before the chat starts: to build the local catalogue and to load tonight's pool. No TMDB call happens during the conversation, so a turn never waits on it.

- **Hard filters** go to `/discover/movie` (`buildDiscoverParams` in `services/tmdb.ts`): genres to skip, runtime, a US rating ceiling from the youngest viewer's age, and subscription (`flatrate`) services in your country. Movies under 60 minutes or with fewer than 100 votes are always left out.
- **Every** matching movie is fetched, not a top page. TMDB stops at page 500, so the walk splits the release years in half until each range fits, and it sorts by release date so pages do not shift while being read.
- **The local catalogue** (`services/catalogue.ts`) keeps every eligible movie with its details (runtime, directors, top cast, US rating, keywords) and vector. Without streaming services, the pool comes from it plus a short TMDB walk over the movies released since the last top-up. With streaming services the pool comes from TMDB, because what is on which service changes every week. New movies are embedded on the spot and join the catalogue.
- **Runtime and rating are checked again locally**, because TMDB's runtime filter is loose and an unrated movie must never pass an age limit.
- The browser gets the pool from the dev server's `/pool` endpoint, as JSON followed by raw Float32 vectors, since the catalogue lives on disk.

## The LLMs

Two LLM calls per user turn, and neither writes the state.

- **NLU** (`understand`, temperature 0) turns an utterance into moves. It sees the last 6 turns, a summary of the state and the last suggestion. The wish is rewritten whole each time ("a light romantic comedy, but funnier"), so it can be embedded as one description. Plain code then corrects the output. `repairMoves` splits refusals out of the wish ("no princesses" becomes an avoid, because an embedding cannot tell "no princesses" from "princesses"). `ground` drops moves the user's own words do not support, which small models produce by copying Elisa's words. A bare "yes" right after a suggestion is accepted without any LLM.
- **NLG** (`respond`, temperature 0.7) writes Elisa's reply. The code, not the LLM, decides the mode (`explore`, `recommend`, `discuss`, `wrapup`) from the state, and the prompt changes with it. Candidates are shown only in recommend mode, a recommended id must be one of them, and a reply that names a movie too early is retried and then replaced by a fixed line. Elisa only gets facts from TMDB, so she cannot make up a plot.
- **Backends** (`llmBackends` in `src/config/services.ts`) are OpenAI-compatible endpoints in JSON mode, tried in order until one answers. The NLU prefers the university's llama3.1, then Groq, then a local qwen2.5:7b. The local GPU is taken by the embedding model, so the local LLM is the last resort. The NLG prefers Groq's gpt-oss-120b for its better replies. `npm run nlu-bench` compares models on cases from my own test chats, and only runs against local endpoints so it cannot spend the Groq limit.

## Embeddings and ranking

This is the retrieval side, a small RAG: the wish is embedded, the pool is ranked against it, and the best `settings.dialogue.candidatesShown` movies, with their facts, go into the NLG prompt as the only movies Elisa may suggest.

- **The model** is `qwen3-embedding:4b` on local Ollama (2,560 dimensions), the strongest of the models tried. A movie is embedded as `movieText`: title, year, genres, overview and up to 15 TMDB keywords. A query gets an instruction prefix ("Given a description of a movie someone wants to watch, retrieve movies that match it") and a document does not, as the model expects.
- **The vectors** are made ahead of time by `embed-catalogue` and stored as one flat Float32 file with a JSON index. Each vector keeps a hash of its text, so a changed text is re-embedded on the next run. During the chat only the wish and avoid texts are embedded, about 40 ms each, and cached by text.
- **Ranking is local.** The whole pool is ranked in memory on every turn, synchronously, with similarities cached per query vector.

The score of each eligible movie (`rankPool`, weights in `settings.ranking`):

```
score = 0.8·semantic + 0.1·popularity − avoid − reject + person
```

- `semantic` is the cosine similarity between the wish and the movie, as a percentile among the eligible movies.
- `popularity` is the vote count, also as a percentile.
- `avoid` is a penalty for the movies most similar to an avoid text. It is 0 below the 95th percentile and rises to 1 at the top, and with several avoid texts the largest penalty counts.
- `reject` does the same for each turned-down movie, using that movie's own vector, from the 90th percentile up to 0.4. "Not that one" sinks its near twins, while "already seen" removes only the movie itself.
- `person` adds 1 when a wanted actor or director is in the credits, which puts their movies above everything else.

Percentiles, because raw cosine similarities sit in a narrow band that moves with every query, so fixed weights on them would mean something different each turn. On percentiles every term runs from 0 to 1, and the weights compare like with like. The penalties only reach the top few percent, so "no princesses" sinks princess movies without pulling down every fairy tale. Movies already suggested, seen or turned down, and movies with an avoided person, are not eligible at all. `npm run rank-bench` is the regression set: hand-labelled wishes on two real pools, scored by recall@10 and forbidden titles in the top 10.

## Credits

Built on SISU (speechstate meets information state update) by Vladislav Maraev, described in Maraev, Berman and Larsson, [Combining Information State Update, Harel Statecharts and LLMs for controllable and flexible Conversational AI](https://aclanthology.org/2025.clasp-main.3/), CLASP 2025.

## Disclaimer

Generative AI was used during development. [docs/AI_log.md](docs/AI_log.md) lists what it was used for and how the work was split between me and AI.
