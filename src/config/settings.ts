/**
 * Everything tunable about the assistant's BEHAVIOUR. Change a number here, get different results.
 * (Outside services: services.ts. Words the assistant says: prompts.ts.)
 */
export const settings = {
  dialogue: {
    /** What a silent turn looks like in the history. */
    silenceMarker: "(silence)",
    /** How many candidates the LLM sees (best-ranked first). */
    candidatesShown: 8,
    /** After this many recommendations in a row, stop suggesting and ask what is missing. */
    maxRecommendStreak: 2,
    /** Tries when the LLM breaks a rule (unknown movie id, naming a movie too early). */
    respondAttempts: 2,
    maxSayChars: 700,
    /** Turns of conversation shown to the LLM. */
    historyForNlu: 6,
    historyForRespond: 12,
    /** How many suggested movies keep their full facts in the prompt (for "what is it about?"). */
    suggestedDetails: 5,
    /** Description length per movie in the prompt, and for liked movies in the taste profile. */
    descriptionChars: { candidate: 220, suggested: 400, seed: 400 },
    /** Recommendations start after this many informative user turns AND distinct signals... */
    readiness: { minTurns: 2, minSignals: 2 },
    /** ...unless the user asks us to stop asking questions. */
    skipQuestions:
      /\b(just (pick|choose|recommend)|surprise me|you (pick|choose)|stop asking|give me (a|one) (movie|recommendation)|recommend (something|one|a movie) (now|already))\b/i,
  },

  llm: {
    /** Used when a call passes no options. */
    defaults: { temperature: 0, maxTokens: 800 },
    /** Understanding is structured extraction: deterministic, and fine on a small local model. */
    understand: { temperature: 0, maxTokens: 800, prefer: "ollama" as string | undefined },
    respond: { temperature: 0.7, maxTokens: 1200, prefer: undefined as string | undefined },
  },

  /** On-disk cache of movie-description vectors (Node scripts only; the browser keeps them in memory). */
  embeddingCache: {
    path: ".cache/embeddings.json",
    /** Oldest vectors are dropped beyond this (about 6-8 KB each as JSON). */
    maxEntries: 5000,
  },

  /** On-disk cache of movie runtimes (Node scripts only). About 15 bytes per entry. */
  runtimeCache: {
    path: ".cache/runtimes.json",
    maxEntries: 20000,
  },

  search: {
    language: "en-US",
    sortBy: "popularity.desc",
    /** Keeps obscure titles out. */
    minVotes: 100,
    /** TMDB pages (20 movies each) fetched per batch; more = bigger pool but slower. */
    pagesPerBatch: 3,
    /** Pages of results a session may draw from, visited in a per-session random order. */
    pageWindow: 12,
    /** How many batches to try when the pool runs dry. */
    maxBatches: 5,
    runtimeLookupConcurrency: 10,
    /** TMDB answers 429 when called too fast: wait this long, then retry this many times before giving up. */
    retryDelayMs: 1000,
    rateLimitRetries: 1,
  },

  ranking: {
    /** Weighted baseline; weights sum to 1. */
    weights: { genres: 0.4, similarity: 0.3, rating: 0.2, runtime: 0.1 },
    /** Share of the final score taken by embeddings when they are available. */
    semanticWeight: 0.55,
    /** Bayesian shrinkage: a 9/10 with 3 votes shouldn't outrank an 8/10 with 10,000 votes. */
    ratingPrior: { votes: 250, mean: 6.5 },
    /** Similarity to a liked movie: genre overlap vs. description overlap. */
    similarityMix: { genres: 0.6, text: 0.4 },
    /** Score for "no information" (unknown runtime, no preference, all-equal semantic scores). */
    neutral: 0.5,
    /** Soft runtime fit: smallest half-width (minutes) of the target band, and minutes over which the fit ramps up/down. */
    runtimeFit: { minHalfBand: 30, rampMinutes: 60 },
  },

  /** Step sizes for relative requests ("shorter", "newer", "better") and exact ones ("about 90 minutes"). */
  adjust: {
    runtimeStep: 20,
    runtimeDefaultMax: 130,
    runtimeDefaultMin: 100,
    runtimeFloor: 60,
    runtimeExactTolerance: 15,
    yearStep: 10,
    yearOlderStep: 15,
    yearDefaultMin: 2000,
    ratingStep: 0.5,
    ratingDefault: 6.5,
    ratingCap: 8.5,
  },

  speech: {
    locale: "en-US",
    voice: "en-US-DavisNeural",
    noInputTimeoutMs: 7000,
    completeTimeoutMs: 0,
    bargeIn: false as false,
  },
};
