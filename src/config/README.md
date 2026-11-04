# config

Everything you can change without changing logic. These modules import nothing from the rest of `src` except types.

- `prompts.ts` holds every word Elisa or the page shows.
  - `understandCore` and `understandByQud` make the NLU prompt. The second part depends on what Elisa's last turn left open (`qud`).
  - `respondSystem` and one of `respondModes` make the NLG prompt.
  - `utterances` are the lines spoken without an LLM: the opening, the reply to silence, and the fallbacks for when the LLM keeps breaking the rules.
  - `notices` are things that happened behind the scenes, handed to the NLG to mention.
  - `formText` and `movieCardText` are the page's labels.
- `settings.ts` holds the numbers that change behaviour, grouped by who reads them. The ones you will touch most:
  - `dialogue.minUserTurns`: how many user turns before Elisa may suggest a movie
  - `dialogue.candidatesShown`: how many of the best-ranked movies the NLG sees
  - `dialogue.affirmation`: the regex for a bare "yes" that accepts a suggestion without the NLU
  - `llm.understand` and `llm.respond`: temperature, token limit and preferred backend for each LLM call
  - `ranking`: the weights of the score, checked by `npm run rank-bench`
  - `intake.certification`: the youngest viewer's age mapped to a US rating
  - `catalogue` and `search`: what the local catalogue and the TMDB walks include
- `services.ts` holds the URLs, models and timeouts of the outside services, and the names of their secrets. The values live in `.env.local`. Each HTTP service has an `upstream` URL for Node and a `proxy` prefix for the browser, which the Vite dev server forwards with the key added. `llmBackends` is the fallback order for LLM calls. `embeddings` is the embedding model with its query instruction. `authHeaders` builds the bearer header and throws when a key is missing.
