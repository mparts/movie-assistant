import { respondModes, respondSystem, utterances } from "../config/prompts";
import { settings } from "../config/settings";
import { hasTaste, stateSummary } from "../core/state";
import type { ChatMessage, InformationState, LlmClient, Movie, NlgMode as Mode, Reply } from "../core/types";
import { last, namesTitle } from "../core/util";

const { dialogue: d } = settings;

/** What Elisa may say about a movie: only these facts (the prompt forbids anything else). Missing facts are left out. */
const facts = (m: Movie, descriptionChars: number) => ({
  title: m.title,
  year: m.year,
  genres: m.genres,
  rating: m.rating,
  runtimeMinutes: m.runtime,
  directors: m.directors?.length ? m.directors : undefined,
  cast: m.cast?.length ? m.cast.slice(0, d.castInFacts) : undefined,
  tagline: m.tagline,
  description: m.overview.slice(0, descriptionChars),
});

/**
 * How Elisa replies to this state, and why: wrap-up once a suggestion was accepted, recommend once there is taste and
 * the user has spoken `minUserTurns` times (silence does not count), explore before that.
 */
export function replyMode(is: InformationState): { mode: Mode; accepted?: Movie; why: string } {
  const userTurns = is.history.filter((t) => t.speaker === "usr" && t.text !== d.silenceMarker).length;
  const accepted = is.accepted === undefined ? undefined : is.recommended.find((m) => m.id === is.accepted);
  if (accepted) return { mode: "wrapup", accepted, why: `accepted ${accepted.title}` };
  const taste = hasTaste(is);
  const mode: Mode = taste && userTurns >= d.minUserTurns ? "recommend" : "explore";
  return { mode, why: `taste ${taste ? "yes" : "no"}, user turns ${userTurns} of ${d.minUserTurns}` };
}

/** One LLM call: conversation + state + real TMDB candidates → what to say (and which candidate, if any). */
export async function respond(llm: LlmClient, is: InformationState): Promise<Reply> {
  // Scripted turns: no LLM needed.
  if (is.history.length === 0) return { say: utterances.opening(is.intake), mode: "explore" };
  const lastUser = [...is.history].reverse().find((t) => t.speaker === "usr");
  if (lastUser?.text === d.silenceMarker) return { say: utterances.noInput };

  const { mode, accepted } = replyMode(is);
  // Candidates are withheld unless we're in recommend mode: the LLM cannot pick one early.
  const pool = mode === "recommend" ? is.candidates.slice(0, d.candidatesShown) : [];
  // Suggested movies leave "candidates", so the one a question or the wrap-up is about gets its facts here.
  const focus = accepted ?? last(is.recommended);

  const state = JSON.stringify({
    whatWeKnow: stateSummary(is),
    alreadySuggested: is.recommended.map((m) => m.title),
    suggestedMovie: focus && facts(focus, d.descriptionChars.suggested),
    acceptedMovie: accepted?.title,
    ...(mode === "recommend" && { candidates: pool.map((m) => ({ id: m.id, ...facts(m, d.descriptionChars.candidate) })) }),
    notices: is.private.notices,
  });
  // The state is the last line of the system message, and the conversation follows as chat turns. Elisa's own turns
  // are written as the JSON she replies with, so the model keeps answering in JSON.
  const messages: ChatMessage[] = [
    { role: "system", content: `${respondSystem}\n${respondModes[mode]}\n\nWhat you know now:\n${state}` },
    ...is.history
      .slice(-d.historyForRespond)
      .map((t): ChatMessage => (t.speaker === "usr" ? { role: "user", content: t.text } : { role: "assistant", content: JSON.stringify({ say: t.text }) })),
  ];

  // In explore mode the LLM must not name movies. Wrap-up may name the accepted movie, even if another candidate has
  // the same title (e.g. two films called "Solaris").
  const forbiddenTitles = (mode === "wrapup"
    ? is.candidates.filter((m) => m.title !== accepted?.title)
    : [...is.candidates, ...is.recommended])
    .map((m) => m.title)
    .filter((t) => t.length >= 4);

  for (let attempt = 0; attempt < d.respondAttempts; attempt++) {
    const out: any = await llm.json(messages, settings.llm.respond);
    const say = typeof out?.say === "string" ? out.say.trim().slice(0, d.maxSayChars) : "";
    if (!say) throw new Error("LLM returned no 'say'");
    const id = typeof out?.recommend === "number" ? out.recommend : undefined;

    if (mode === "recommend") {
      if (id !== undefined && !pool.some((m) => m.id === id)) {
        console.warn(`[respond] LLM recommended id ${id}, which is not a candidate; retrying`);
        continue;
      }
      // The LLM sometimes names a candidate but leaves "recommend" empty. Without the id the suggestion is never
      // recorded, so a "yes" to it cannot be accepted. Take the one candidate it named.
      const named = id === undefined ? pool.filter((m) => m.title.length >= 4 && namesTitle(say, m.title)) : [];
      return { say, movieId: named.length === 1 ? named[0].id : id, mode };
    }
    if ((mode !== "wrapup" && id !== undefined) || forbiddenTitles.some((t) => namesTitle(say, t))) {
      console.warn("[respond] Premature recommendation blocked; retrying");
      continue;
    }
    return { say, mode };
  }

  if (mode === "wrapup") return { say: utterances.wrapupFallback, mode };
  if (mode === "explore") return { say: utterances.exploreFallback, mode };
  throw new Error("LLM kept recommending a movie outside the candidates");
}
