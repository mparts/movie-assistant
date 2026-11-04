import { SpeechStateExternalEvent } from "speechstate";
import type { Intake } from "./intake";
import type { Pool } from "./pool";

/** A movie as the dialogue sees it. Genres are TMDB genre *names*; only the TMDB client knows ids. */
export interface Movie {
  id: number;
  title: string;
  year?: number;
  genres: string[];
  rating: number;
  votes: number;
  runtime?: number; // minutes, from the catalogue
  overview: string;
  posterPath?: string;
  /** Original language (ISO 639-1, "en"). */
  language?: string;
  /** From the catalogue's details: directors, the top-billed cast, the franchise, the tagline. */
  directors?: string[];
  cast?: string[];
  collection?: string;
  tagline?: string;
  /** US rating ("PG-13"); "" when TMDB has none. Lets the pool be filtered locally. */
  certification?: string;
}

/** What one TMDB details call adds to a movie (with its keywords, which only go into the embedded text). */
export interface MovieDetails {
  runtime?: number;
  directors: string[];
  cast: string[];
  collection?: string;
  tagline?: string;
  /** US rating, "" when there is none. */
  certification: string;
  keywords: string[];
}

export type Speaker = "usr" | "sys";
export type Turn = { speaker: Speaker; text: string };

/**
 * What the LLM extracts from an utterance ("notes"), plus the one thing the system says.
 * The LLM never edits the information state directly: rules do, from these moves.
 */
export type Move =
  /** The WHOLE updated wish, as a short description of the movie they want; never contains negations. */
  | { type: "wish"; text: string }
  /** Something they don't want ("horror", "princesses", "anything too sad"). */
  | { type: "avoid"; text: string }
  /** An actor or director: wanted (their movies first), or with `negated` avoided (excluded). */
  | { type: "person"; name: string; negated?: boolean }
  | { type: "seen"; title?: string } // no title = the movie in focus
  | { type: "reject"; title?: string }
  | { type: "accept" } // "yes, this one": they take the movie the assistant just suggested
  | { type: "noinput" }
  | { type: "say"; text: string; movieId?: number; mode?: NlgMode }; // system utterance (+ the movie it recommends)

export type MoveOf<T extends Move["type"]> = Extract<Move, { type: T }>;

/** How Elisa was told to reply this turn (prompts.ts `respondModes`). */
export type NlgMode = "explore" | "recommend" | "wrapup";

/** What Elisa's last turn left open: a taste question, the movie Elisa suggested, or nothing. */
export type Qud = "taste" | "suggestion" | "none";

/** What the system says in one turn. No mode for scripted turns that leave the question open as it was. */
export interface Reply {
  say: string;
  movieId?: number;
  mode?: NlgMode;
}

export type Range = { min?: number; max?: number };

/** Plain JSON on purpose: loggable and diffable. Tonight's movies (the pool) are a resource, not part of it. */
export interface InformationState {
  next_moves: Move[];
  private: {
    /** things that happened behind the scenes this turn, for the LLM to mention if relevant */
    notices: string[];
  };
  shared: { lu?: { speaker: Speaker; moves: Move[] } };
  history: Turn[];

  /** What they want, as a short movie description (rewritten by the NLU whenever taste changes). Ranked semantically. */
  wish: string;
  /** Things they don't want: a narrow penalty on the movies most similar to them. */
  avoid: string[];
  /** Actors and directors: wanted ones rank first, avoided ones are excluded. */
  people: { name: string; negated: boolean }[];

  /** The best-ranked movies of the pool right now (the LLM sees these), best first. */
  candidates: Movie[];
  recommended: Movie[]; // in order shown; last = focus
  /** "no" = turned down (similar movies sink); "seen" = already watched (only removed). */
  rejected: { id: number; reason: "seen" | "no" }[];
  /** What Elisa's last turn left open. */
  qud: Qud;
  /** Id of the suggested movie the user accepted. Cleared when they say anything substantive afterwards. */
  accepted?: number;
  /** Phase 1 facts, set once at the start; no move changes them. */
  intake: Intake;
}

/** TMDB discover filters: what Phase 1 decides (and the catalogue's own limits). */
export interface SearchCriteria {
  excludeGenres: string[];
  runtime: Range;
  year: Range;
  /** US certification ceiling ("PG"), from the youngest viewer. */
  certificationLte?: string;
  /** Subscription platforms (TMDB provider ids) in `region`; any of them will do. */
  watch?: { region: string; providers: number[] };
}

export interface TmdbClient {
  /** EVERY movie matching the criteria, walked in release-year ranges under TMDB's 500-page limit. */
  pool(criteria: SearchCriteria): Promise<Movie[]>;
  /** Runtime, credits and keywords of one movie (one request). Throws on errors. */
  details(id: number): Promise<MovieDetails>;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  /** Backend name(s) to try first, in this order; the others follow in their configured order as fallbacks. */
  prefer?: string | string[];
  /** What the call is for ("NLU", "NLG"): shown when reporting which backend answered. */
  purpose?: string;
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

/** Turns a wish or avoid text into a query vector (with the embedding model's query instruction). */
export type EmbedQuery = (text: string) => Promise<Float32Array>;

/** What the DME works with besides the information state: services and resources. */
export interface DMEContext extends TotalInformationState {
  parentRef: any;
  tmdb: TmdbClient;
  llm: LlmClient;
  embedQuery: EmbedQuery;
  /** Tonight's movies, loaded when Phase 1 ended: what gets ranked. */
  pool: Pool;
  /** Query vectors by text. Outside the IS: not plain JSON. */
  vectors: Map<string, Float32Array>;
}

/** Browser top level. `is` exists once the settings form is done; `elisaSaid` is Elisa's last line, shown on screen. */
export interface DMContext {
  ssRef: any;
  embedQuery: EmbedQuery;
  tmdb: TmdbClient;
  llm: LlmClient;
  is?: InformationState;
  pool?: Pool;
  /** Why loading tonight's movies failed, shown on the pool-check screen. */
  poolError?: string;
  lastUtterance?: string;
  elisaSaid?: string;
}

export type DMEvent =
  | { type: "INTAKE_DONE"; intake: Intake }
  | { type: "CHANGE_SETTINGS" }
  | { type: "GO_ANYWAY" }
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
