import { SpeechStateExternalEvent } from "speechstate";
import type { Embedder } from "../services/embeddings";

/** A movie as the dialogue sees it. Genres are TMDB genre *names*; only the TMDB client knows ids. */
export interface Movie {
  id: number;
  title: string;
  year?: number;
  genres: string[];
  rating: number;
  votes: number;
  runtime?: number; // minutes; filled by a detail lookup for discover results
  overview: string;
  posterPath?: string;
}

export type Speaker = "usr" | "sys";
export type Turn = { speaker: Speaker; text: string };

/**
 * What the LLM extracts from an utterance ("notes"), plus the one thing the system says.
 * The LLM never edits the information state directly: rules do, from these moves.
 */
export type Move =
  | { type: "prefer"; genre?: string; mood?: string; negated?: boolean }
  | {
      type: "constrain";
      slot: "runtime" | "year" | "rating" | "language";
      op: "lte" | "gte" | "eq";
      value: number | string;
    }
  | {
      type: "adjust";
      dimension: "tone" | "runtime" | "era" | "rating";
      direction: string;
    }
  | { type: "like"; title: string } // "something like Knives Out"
  | { type: "seen"; title?: string } // no title = the movie in focus
  | { type: "reject"; title?: string }
  | { type: "retract"; slot: string }
  | { type: "vibe"; text: string } // loose taste that isn't a genre: "cozy", "makes me think"
  | { type: "restart" }
  | { type: "noinput" }
  | { type: "say"; text: string; movieId?: number }; // system utterance (+ the movie it recommends)

export type MoveOf<T extends Move["type"]> = Extract<Move, { type: T }>;

/** What the system says in one turn. */
export interface Reply {
  say: string;
  movieId?: number;
}

/** Pending internal work: look a title up in TMDB. */
export type Action = { type: "resolve_seed"; title: string };

export type Range = { min?: number; max?: number };

/** Plain JSON on purpose: loggable and diffable. */
export interface InformationState {
  next_moves: Move[];
  private: {
    agenda: Action[];
    /** things that happened behind the scenes this turn, for the LLM to mention if relevant */
    notices: string[];
  };
  shared: { lu?: { speaker: Speaker; moves: Move[] } };
  history: Turn[];
  /** Recommendation gate: substantive user turns and distinct pieces of information. */
  readiness: { meaningfulTurns: number; evidence: string[] };

  /** soft: used for ranking */
  prefs: { genres: string[]; seeds: Movie[] };
  /** loose taste descriptors, matched against movie descriptions semantically */
  vibe: string[];
  /** hard: sent to TMDB */
  constraints: { runtime: Range; year: Range; rating?: number; language?: string };
  /** hard: excluded */
  dislikes: { genres: string[] };

  candidates: Movie[]; // filtered + ranked, best first
  recommended: Movie[]; // in order shown; last = focus
  /** `genres`/`overview` are a snapshot of the movie, so later candidates can be compared to ones the user turned down. */
  rejected: { id: number; reason: "seen" | "no"; genres?: string[]; overview?: string }[];
  /** consecutive system turns that recommended a movie; reset by any turn that didn't */
  recommendStreak: number;

  /** `page` counts batches of TMDB pages, not single pages. */
  search: { status: "idle" | "dirty" | "failed"; page: number; noMore: boolean };
}

export interface SearchCriteria {
  genres: string[]; // OR-ed
  excludeGenres: string[];
  runtime: Range;
  year: Range;
  rating?: number;
  language?: string;
  page: number;
}

export interface TmdbClient {
  discover(criteria: SearchCriteria): Promise<Movie[]>;
  searchMovie(title: string): Promise<Movie | null>;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  /** Name of the backend to try first for this call; the others stay as fallbacks. */
  prefer?: string;
}

export interface LlmClient {
  /** One chat completion that must return a JSON object; rejects on failure. */
  json(messages: ChatMessage[], opts?: LlmOptions): Promise<unknown>;
}

/* ---- dialogue manager (DME) and top-level machine contexts/events ---- */

export interface TotalInformationState {
  latest_speaker?: Speaker;
  latest_moves?: Move[];
  latest_text?: string;
  is: InformationState;
}

export interface DMEContext extends TotalInformationState {
  embedder?: Embedder;
  parentRef: any;
  tmdb: TmdbClient;
  llm: LlmClient;
}

export interface DMContext extends TotalInformationState {
  embedder?: Embedder;
  ssRef: any;
  tmdb: TmdbClient;
  llm: LlmClient;
  lastUtterance?: string;
}

export type DMEvent = { type: "CLICK" } | SpeechStateExternalEvent | NextMovesEvent;

export type DMEEvent = SaysMovesEvent;

/** User speech arrives as raw `text` (the DME asks the LLM to understand it); silence as a noinput move. */
export type SaysMovesEvent = {
  type: "SAYS";
  value: { speaker: Speaker; moves?: Move[]; text?: string };
};

export type NextMovesEvent = {
  type: "NEXT_MOVES";
  value: Move[];
};
