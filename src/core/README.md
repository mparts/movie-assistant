# core

The information state and the logic that updates it. Nothing here does I/O or knows about xstate, so the browser, the typed chat and the benches all run the same code.

- `types.ts` holds the shared types. Read these first:
  - `InformationState` is what the system believes. `wish` is one sentence that the NLU rewrites whole each time. `avoid` and `people` grow over the conversation. `recommended` and `rejected` track the movies talked about. `qud` is what Elisa's last turn left open: a taste question, a suggestion, or nothing. `accepted` is the suggestion the user took. It is plain JSON, so it can be logged and diffed.
  - `Move` is what the NLU extracts from a user turn (`wish`, `avoid`, `person`, `seen`, `reject`, `accept`), plus `noinput` for silence and `say` for Elisa's own turn.
  - `DMEContext` and `DMContext` are the xstate contexts of the dialogue manager and of the browser machine.
  - `TmdbClient` and `LlmClient` are the interfaces `services/` implements.
- `intake.ts` is Phase 1: the hard facts from the settings form or a profile file. These are name, age, country, streaming services, tonight's company, a time limit and genres to skip. `parseIntake` checks untrusted JSON and throws on the first problem, so the form and the profile files pass the same check. When watching alone or as a couple, `youngestAge` is the user's own age. `certificationFor` turns that age into a US rating ceiling. `GENRES` is the list the form offers.
- `state.ts` builds on the intake. `initialIS` is the empty state of a new conversation. `poolCriteria` turns the intake into TMDB filters. `stateSummary` is the compact view of the state that both LLM prompts get. `hasTaste` (a wish or a wanted person) decides whether Elisa may start suggesting.
- `rules.ts` holds the update rules. A rule takes the context and returns its effect when it applies, or `undefined` when it does not, so one function is both precondition and effect. The DME runs them in this order:
  - `clear_notices` at the start of every update
  - `get_latest_move` records the utterance in `shared.lu` and `history`, and keeps or clears `accepted`
  - `integrate_wish`, `integrate_avoid`, `integrate_person` and `integrate_seen_reject` read the user's moves
  - `integrate_recommend` and `integrate_qud` read Elisa's own `say` move. A suggested movie moves from `candidates` to `recommended`, and the reply's mode sets `qud`.

  `applyRanking` is not a rule. The DME calls it after the rules, once the query vectors are ready. It keeps the best `settings.dialogue.candidatesShown` movies as `candidates`, and adds a notice when the user asks for a person who is in none of tonight's movies.
- `ranking.ts` scores every eligible movie in the pool, every turn:

  ```
  score = 0.8·semantic + 0.1·popularity − avoid − reject + person
  ```

  `semantic` is the cosine similarity to the wish and `popularity` the vote count. `avoid` and `reject` only hit the movies most similar to an avoid text (the top 5%) or to a turned-down movie (the top 10%). That way "no princesses" sinks princess movies without pulling down everything loosely related. `person` is a flat bonus when a wanted actor or director is in the credits. Every term but `person` is a percentile among the eligible movies, so the weights compare like with like. Movies already suggested, seen or turned down, or with an avoided person, are not eligible. Similarities are cached per pool and query vector, so a turn computes only what is new. The weights live in `settings.ranking`.
- `pool.ts` describes tonight's movies and their vectors. The pool is a resource, like a domain database, and not part of the information state, because it is large and never changes during a conversation. `poolCheck` says whether there are enough movies. Loading happens in `services/catalogue.ts` for Node and in `browser/dm.ts` for the browser.
- `util.ts` holds small helpers. `spokenText` and `isWrapup` read Elisa's moves. `namesTitle` checks whether a text names a movie, on whole words only. `timed`, `timedSync` and `flushTimings` print one timing line per turn in debug mode. `isDebug` is true with `DEBUG=1` in Node or `globalThis.DME_DEBUG = true` in the browser.
