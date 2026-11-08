# Development history

Elisa is a spoken assistant that helps you pick a movie for tonight. You fill in a short form about who is watching and what you can watch, then you tell her what you are in the mood for, and she suggests movies until you take one. This file follows how the app got there. Commit hashes are in brackets.

## The base: the course labs

Two labs from the course fed into Elisa (fork: github.com/mparts/dialogue-systems-2-2026).

- **Lab 1, LLMs and RAG** (`main`): a spoken chat in xstate and speechstate that answers from documents through retrieval-augmented generation, calling LLMs through the OpenAI-compatible API that Groq and Ollama offer. Elisa's retrieval and her LLM backends build on the same pieces.
- **Lab 2, SISU** (`lab-2`, PR #37): the course's information-state-update code, plus my own additions, such as silence as a `noinput` move and the Azure region.

Elisa started as a copy of the Lab 2 SISU code [46b3b8c].

## First version: moods and genres

The first working version asked for a mood, mapped it to genres ("goofy" to comedy) and sent the result as a search to TMDB. The information state collected the criteria (genres, runtime, language), and the update rules decided when to search again [46b3b8c]. Soon after, the results were sorted by weighted rules [ced3dbf], moods became taste profiles with a few questions before the first suggestion [b302cbf], and the descriptions of the fetched movies were embedded live, to re-rank them by how well they matched the user's taste [cb6c1f9].

## Growing it

The next round made it sturdier: separate LLM backends for understanding and for Elisa's replies [9e43570], and a cleaner layout with every tunable number in one config [3955eec].

## Two phases

The hard facts (who is watching, the youngest viewer's age, how much time, which streaming services) then moved out of the conversation into a **form in the browser** [2a9b5e6]. These facts decide which movies are allowed at all, and one misheard filter can hide every movie the user wants, so a form is safer and faster. The form is Phase 1. The spoken chat about taste is Phase 2, and it can only narrow what Phase 1 allows.

## From moods to wishes

Moods and genres were still the weak point. Genres were a hard search filter, and only about 60 popular results were re-ranked, so a wrong genre guess hid the right movies and no ranking could bring them back.

A spike compared embedding models and score weights on hand-labelled wishes, and the design changed:

- The pool of movies is decided by Phase 1 only, and the **whole pool** is ranked by meaning.
- About 23,000 movies are embedded ahead of time into a **local catalogue**, so at chat time only the user's words are embedded [b907672].
- The NLU no longer fills slots. It rewrites what the user says into a **wish**, one short description of the movie they want, plus a list of things to **avoid** [fc1b7fd].

## Making wishes reliable

Wishes kept getting lost right after a suggestion. A replay of 60 taste changes found four causes. The main fix was a SISU one: the information state now records the **question under discussion** (QUD), and the NLU prompt is chosen by it [5ccc3c9]. On the NLU bench at the time this went from 28 to 34 of 36 cases. Refusals inside a wish ("no princesses") are now split out into the avoid list, because an embedding cannot tell "no princesses" from "princesses".

## Simplify

Each fix had added another layer, and a live chat showed the layers causing most of the new bugs, while the core (wish, embeddings, rank, suggest) worked every turn. So I went back to a simpler app [50f169e]. Most of the later additions went, such as the year and language filters, "something like X" and genres as a chat topic. What stayed was the wish, the QUD, grounding, and only a question or two before the first suggestion. The assistant, until then called Jake, became Elisa [29b00aa].

## Elisa's voice

With the dialogue simpler, the work moved to how Elisa talks. She now gets the conversation as real chat turns, not as a JSON file [ccf1cfa], with a shorter prompt [8cca22e]. A `discuss` mode keeps her on the movie she just suggested while the user asks about it [221c75a]. Later her prompt was split by the reply mode the code picks: explore, recommend, discuss or wrap-up [90b1886].

## Cleanup and finish

The last stretch was cleanup and polish:

- A module-by-module cleanup removed dead and duplicate code, and folded tiny modules into their only user [8ac0b25].
- The chat ends once a movie is agreed [b6a7e7b], and the suggested movie is shown with its poster [fa7ff66].
- A patch to speechstate stops a failed Azure abort from freezing the dialogue [fcb737f, `docs/speechstate-asr-hang.md`].

## Where it is now

Elisa is a two-phase app: a form for the hard facts, then a short spoken chat. SISU's update rules are the only thing that changes the state, xstate runs the dialogue, speechstate handles speech, and embeddings rank tonight's pool by the user's wish. The ideas that survived are the simple ones: the form, the wish, the QUD and ranking by meaning. Most of what was removed was added to patch the earlier design.

This history holds up to 8 November 2026 and the latest commit [a001ff5]. I may or may not keep it updated as the app improves.
