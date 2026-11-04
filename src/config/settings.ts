/**
 * Everything tunable about the assistant's BEHAVIOUR. Change a number here, get different results.
 */
export const settings = {
  dialogue: {
    /** What a silent turn looks like in the history. */
    silenceMarker: "(silence)",
    /** How many candidates the LLM sees (best-ranked first). */
    candidatesShown: 10,
    /** Tries when the LLM breaks a rule (unknown movie id, naming a movie too early). */
    respondAttempts: 2,
    maxSayChars: 700,
    /** Turns of conversation shown to the LLM. */
    historyForNlu: 6,
    historyForRespond: 12,
    /** Description length per movie in the prompt. */
    descriptionChars: { candidate: 220, suggested: 400 },
    /** Top-billed actors Elisa is told about per movie (the catalogue keeps `search.castShown`). */
    castInFacts: 3,
    /** Elisa suggests once there is taste and the user has spoken this many times (silence does not count). */
    minUserTurns: 3,
    /**
     * A reply that is ONLY agreement ("yes", "sounds good", "let's go with that"), judged on the lowercased text with
     * punctuation and apostrophes removed ("let's" → "lets"). Right after a suggested movie it means "I'll take it"
     * and is understood without the LLM. Anything else in the reply (e.g. "yes please do that") goes to the LLM.
     */
    affirmation: new RegExp(
      "^(?:(?:yes|yeah|yeap|yep|yup|sure|ok|okay|alright|all right|perfect|great|nice|cool|awesome|definitely|absolutely|for sure|why not|please|thanks|thank you|good|fine" +
        "|sounds (?:good|great|perfect|nice)|that (?:works|sounds (?:good|great|perfect)|one)|thats (?:good|great|perfect)|it works|this works|works for me|this one" +
        "|go for it|lets (?:go with|do|take|watch)(?: it| that| this)?(?: one)?|ill (?:take|watch)(?: it| that| this)?)(?:\\s+|$))+$"
    ),
    /** More words than this is not a bare agreement, whatever it matches. */
    affirmationMaxWords: 12,
  },

  llm: {
    /** Used when a call passes no options. */
    defaults: { temperature: 0, maxTokens: 800 },
    /**
     * Understanding is structured extraction: deterministic, and fine on a 7-8B model. University first, because the
     * local GPU is taken by the embedding model (qwen3-embedding:4b does not fit beside qwen2.5:7b). Groq comes next,
     * and the local model (not in this list) stays last, as a last resort.
     */
    understand: { temperature: 0, maxTokens: 800, purpose: "NLU", prefer: ["ollama", "groq"] as string[] | undefined },
    /**
     * Elisa's replies: no preference, so the configured order applies (Groq first, then the others as fallbacks).
     * Groq counts `maxTokens` against its tokens per minute. A reply with gpt-oss's reasoning takes about 100.
     */
    respond: { temperature: 0.7, maxTokens: 600, purpose: "NLG", prefer: undefined as string[] | undefined },
  },

  /**
   * The movie catalogue embedded ahead of time (`npm run embed-catalogue`): every movie a Phase 1 pool could hold.
   * Shorter than `intake.minMinutes` or fewer votes than `minVotes` is left out.
   */
  catalogue: {
    /**
     * What the catalogue walks (with `intake.minMinutes`). Tonight's pool uses `search.minVotes`: if that is lower,
     * the catalogue cannot answer alone and the pool comes from TMDB (lower this and run `embed-catalogue` to widen it).
     */
    minVotes: 100,
    /** Keywords per movie in its embedded text (TMDB orders them roughly by importance). */
    maxKeywords: 15,
    /** Embedding requests between saves (a crash loses at most that much work). */
    saveEvery: 25,
    keywordsPath: ".cache/keywords.json",
    /** One record per movie (title, year, genres, overview, votes, rating, poster), as TMDB last returned it. */
    recordsPath: ".cache/catalogue.json",
    /** `<model>` is replaced by the embedding model's name. `.bin` holds the vectors and `.json` the index. */
    vectorsPath: ".cache/vectors-<model>",
  },

  /** Phase 1 (the form) → TMDB filters. */
  intake: {
    /**
     * US ratings for everyone (best TMDB coverage). The first row whose `maxAge` covers the youngest viewer wins, and
     * anyone older has no limit.
     */
    certification: [
      { maxAge: 12, cert: "PG" },
      { maxAge: 15, cert: "PG-13" },
    ],
    /** Platforms count only when included in a subscription. */
    monetization: "flatrate",
    /** Shortest movie considered: keeps shorts (Bao, Feast, Destino…) out of every pool. */
    minMinutes: 60,
  },

  search: {
    language: "en-US",
    /** Keeps obscure titles out of the pool. */
    minVotes: 100,
    /** Parallel TMDB requests when walking every page of a query (the pool, the catalogue) or fetching details. */
    walkConcurrency: 20,
    /** Top-billed actors kept per movie (for "something with Keanu Reeves" and for Elisa's facts). */
    castShown: 5,
    /** TMDB answers 429 when called too fast: wait this long, then retry this many times before giving up. */
    retryDelayMs: 1000,
    rateLimitRetries: 3,
  },

  /** Tonight's movies: everything that passes the Phase 1 filters, fetched once when the form is done (no cap). */
  pool: {
    /** Fewer than this: the form says so and offers "Go anyway" or "Change them". */
    minPool: 30,
  },

  /**
   * Ranking tonight's pool, every turn. Each term is a percentile within the movies still eligible, so the weights
   * compare like with like. `npm run rank-bench` checks them.
   */
  ranking: {
    /** Similarity to the wish, and number of votes. */
    weights: { semantic: 0.8, popularity: 0.1 },
    /**
     * Penalties hit only the movies MOST similar to something unwanted: `weight` at the top, fading to 0 at
     * percentile `from`. An avoid text ("princesses") hits the top 5%, and a turned-down movie its closest 10%.
     */
    avoid: { weight: 1, from: 0.95 },
    reject: { weight: 0.4, from: 0.9 },
    /** Added for a wanted actor or director: their movies come first. */
    person: 1,
  },

  speech: {
    locale: "en-US",
    voice: "en-US-JennyNeural",
    noInputTimeoutMs: 7000,
    completeTimeoutMs: 0,
    bargeIn: false as false,
  },
};
