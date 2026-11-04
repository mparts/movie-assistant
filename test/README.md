# test

Vitest unit tests, run with `npm test`. They are offline: every LLM is a stub and no network is touched. Most tests exist because of a bug we actually hit, and the test name says what it guards. The NLU and ranking quality checks live in the benches in `scripts/`, not here.

- `fixtures.ts` has `freshIS`, an empty information state for an adult watching alone (`profiles/solo.json`).
- `core.test.ts` covers Phase 1. Every file in `profiles/` must pass `parseIntake`, bad input must be rejected, and `poolCriteria` must keep the no-shorts floor.
- `rules.test.ts` covers the update rules: the latest wish replaces the old one, rejecting "Hereditary" must not reject "Her", and Elisa's reply mode sets `qud`.
- `grounding.test.ts` covers the NLU checks around the LLM:
  - a bare "yes" right after a suggestion is an `accept` without calling the model
  - the accepted movie survives silence and small talk, and Elisa then wraps up without a new suggestion
  - a wish made of Elisa's words is dropped, and a person must be named in the user's words
  - a refusal in a wish ("with no princesses") is split off into an avoid, while a negation that is part of the story ("a dog who never gives up") stays
- `respond.test.ts` covers the guards on the NLG. The opening needs no LLM. Naming a candidate before Elisa may suggest is blocked and falls back to a fixed line. A title inside another word ("Up" in "supper") is not a mention. A candidate named without its id still counts as the suggestion.
- `ranking.test.ts` runs `rankPool` on a tiny pool of 3-D vectors, so the similarities are easy to read. It checks that the wish orders the pool, that a turned-down movie sinks its near twin while "already seen" sinks nothing, and that wanted people come first and avoided ones are gone.
- `services.test.ts` covers the age limit (unrated movies fit only without one), `buildDiscoverParams`, and the LLM fallback order with `prefer`.
- `servicesConfig.test.ts` checks the config itself: no proxy prefix starts with another one, and the NLU and NLG backend orders are the intended ones.
- `nluBench.test.ts` runs the NLU bench against a stub LLM. A stub that answers every case correctly must score all of them, a failing call counts as invalid without stopping the run, and the percentile and table come out right.
- `timing.test.ts` checks that `timed` returns the wrapped result and that `flushTimings` counts calls per stage.
