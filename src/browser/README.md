# browser

The page. It runs only under the Vite dev server (`npm run dev`), which also serves the `/pool` endpoint and the API proxies from `vite.config.ts`.

- `main.ts` writes the page's HTML once, then shows the form, the pool check or the chat, depending on the machine's state. It also fills the movie card (poster, director, cast, runtime) for the latest suggestion. The wording comes from `formText` and `movieCardText` in `config/prompts.ts`.
- `dm.ts` is the top-level xstate machine: Prepare (speech warms up) => Intake (the form) => FindingMovies (load the pool) => Main (the chat). PoolCheck comes in between when there are too few movies or loading failed. Main runs three regions in parallel:
  - Interpret listens through speechstate and sends the text to the DME as `SAYS`. Silence is sent as a `noinput` move.
  - Generate speaks Elisa's `NEXT_MOVES` and passes them back to the DME as `SAYS`.
  - DME runs the dialogue manager from `dialogue/dme.ts`.

  `fetchPool` reads the dev server's answer: the movies as JSON, followed by their vectors as raw Float32 rows. `elisa.state()` in the console prints the current state.

- `intakeForm.ts` is the settings form for Phase 1, with the screens name, welcome back (for a saved name), profile and tonight. Profiles are saved in `localStorage` by name, and a guest is never saved. The countries and streaming services come from TMDB through the proxy, with the top 12 services of the region shown. The result goes through `parseIntake`, the same check the profile files get.
- `style.css` is the page's look: dark surfaces, Bebas Neue headings, IBM Plex Mono text, and a status dot that shows what speechstate is doing.
