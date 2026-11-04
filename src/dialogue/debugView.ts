/**
 * The console view of a conversation, the same in the browser (F12) and the typed chat: one line for tonight's
 * settings and pool, one group per turn, and the same group on demand (`elisa.state()`, `/state`).
 * The full information state is printed only with `DME_DEBUG` / `DEBUG=1` (dme.ts).
 */
import { certificationFor, type Intake } from "../core/intake";
import type { Pool } from "../core/pool";
import { rankPool } from "../core/ranking";
import type { DMEContext, Move } from "../core/types";
import { last } from "../core/util";
import type { LlmAnswer } from "../services/llm";
import { queryVectors } from "./dme";
import { replyMode } from "./respond";

/** Tonight's settings in one line. */
export function describeTonight({ profile, tonight }: Intake): string {
  const cert = certificationFor(tonight.youngestAge);
  return [
    profile.name ?? "Guest",
    profile.country,
    `${tonight.company}, youngest ${tonight.youngestAge}${cert ? ` → ${cert}` : ""}`,
    tonight.maxMinutes ? `≤${tonight.maxMinutes} min` : "no time limit",
    profile.platforms.length ? `platforms ${profile.platforms.join("|")}` : "any platform",
    ...(tonight.avoidGenres.length ? [`avoid ${tonight.avoidGenres.join(", ")}`] : []),
  ].join(" · ");
}

export const describePool = (pool: Pool): string =>
  `${pool.movies.length} movies from ${pool.source === "catalogue" ? "the local catalogue" : "TMDB"}` +
  ` (${pool.embeddedNow} embedded now) in ${(pool.ms / 1000).toFixed(1)}s`;

/** "NLG: groq 429, then ollama (llama3.1:latest), 2.3 s" */
const describeAnswer = (a: LlmAnswer): string =>
  `${a.purpose ?? "LLM"}: ${[...a.failed, `${a.backend} (${a.model})`].join(", then ")}, ${(a.ms / 1000).toFixed(1)} s`;

const brief = ({ type, ...rest }: Move) => (Object.keys(rest).length ? `${type} ${JSON.stringify(rest)}` : type);
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Prints what the dialogue manager believes as one console group: the last user turn and its moves, the state, the
 * reply mode and why, the LLM calls, and the top 5 of tonight's pool with the terms of their score.
 */
export function logState(
  c: DMEContext,
  opts: { title?: string; confidence?: number; llm?: string[] } = {}
): void {
  const { is } = c;
  const heard = last(is.history.filter((t) => t.speaker === "usr"))?.text;
  const { mode, why } = replyMode(is);
  const fields: Record<string, string | string[] | undefined> = {
    heard: heard && opts.confidence !== undefined ? `${heard} (confidence ${opts.confidence.toFixed(2)})` : heard,
    moves: c.understood?.moves.map(brief),
    dropped: c.understood?.dropped.map(brief),
    wish: is.wish,
    avoid: is.avoid,
    people: is.people.map((p) => (p.negated ? `not ${p.name}` : p.name)),
    qud: is.qud,
    accepted: is.recommended.find((m) => m.id === is.accepted)?.title,
    suggested: is.recommended.map((m) => m.title),
    mode: `${mode} (${why})`,
  };
  const top = rankPool(is, c.pool, queryVectors(c))
    .slice(0, 5)
    .map((s) => ({
      title: s.movie.year ? `${s.movie.title} (${s.movie.year})` : s.movie.title,
      score: r2(s.score),
      semantic: r2(s.semantic),
      popularity: r2(s.popularity),
      avoid: r2(s.avoid),
      reject: r2(s.reject),
      person: r2(s.person),
    }));

  console.group(opts.title ?? "Elisa's state");
  for (const [k, v] of Object.entries(fields)) {
    const text = Array.isArray(v) ? v.join(" · ") : v;
    console.log(`${k}: ${text || "none"}`);
  }
  for (const line of opts.llm ?? []) console.log(line);
  console.table(top);
  console.groupEnd();
}

/**
 * One group per turn. `onLlmAnswer` goes to `createClients`, so the group lists the LLM calls made during
 * the turn. Call `turn` when Elisa's reply is ready (NEXT_MOVES). Her opening line, before any user turn, prints nothing.
 */
export function createTurnLog() {
  let calls: string[] = [];
  return {
    onLlmAnswer: (a: LlmAnswer) => {
      calls.push(describeAnswer(a));
    },
    turn(c: DMEContext, confidence?: number) {
      const userTurns = c.is.history.filter((t) => t.speaker === "usr");
      const title = `turn ${userTurns.length} · "${last(userTurns)?.text}"`;
      if (userTurns.length) logState(c, { title, confidence, llm: calls });
      calls = [];
    },
  };
}
