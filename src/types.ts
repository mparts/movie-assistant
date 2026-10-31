import { SpeechStateExternalEvent } from "speechstate";

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

  /** soft: used for ranking */
  prefs: { genres: string[]; seeds: Movie[] };
  /** loose taste descriptors, matched against movie descriptions by the LLM */
  vibe: string[];
  /** hard: sent to TMDB */
  constraints: { runtime: Range; year: Range; rating?: number; language?: string };
  /** hard: excluded */
  dislikes: { genres: string[] };

  candidates: Movie[]; // filtered + ranked, best first
  recommended: Movie[]; // in order shown; last = focus
  rejected: { id: number; reason: "seen" | "no" }[];

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

export interface LlmClient {
  /** One chat completion that must return a JSON object; rejects on failure. */
  json(
    messages: ChatMessage[],
    opts?: { temperature?: number; maxTokens?: number }
  ): Promise<unknown>;
}

export interface TotalInformationState {
  latest_speaker?: Speaker;
  latest_moves?: Move[];
  latest_text?: string;
  is: InformationState;
}

export interface DMContext extends TotalInformationState {
  ssRef: any;
  tmdb: TmdbClient;
  llm: LlmClient;
  lastUtterance?: string;
}

export interface DMEContext extends TotalInformationState {
  parentRef: any;
  tmdb: TmdbClient;
  llm: LlmClient;
}

export type DMEvent =
  | { type: "CLICK" }
  | SpeechStateExternalEvent
  | NextMovesEvent;

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
