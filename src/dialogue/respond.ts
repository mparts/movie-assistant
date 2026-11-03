import { respondModes, respondSystem, utterances } from "../config/prompts";
import { settings } from "../config/settings";
import { hasSignal, hasTaste, stateSummary, tasteProfile } from "../core/state";
import { recommendationReadiness } from "../core/readiness";
import type { InformationState, LlmClient, Reply } from "../core/types";

const { dialogue: d } = settings;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive: "Up" must not match "supper". */
const mentions = (text: string, title: string) => new RegExp(`(^|\\W)${escape(title)}(\\W|$)`, "i").test(text);

type Mode = "explore" | "clarify" | "recommend" | "wrapup";

/** One LLM call: conversation + state + real TMDB candidates → what to say (and which candidate, if any). */
export async function respond(llm: LlmClient, is: InformationState): Promise<Reply> {
  // Scripted turns: no LLM needed.
  if (is.history.length === 0) return { say: utterances.opening(is.intake) };
  const lastUser = [...is.history].reverse().find((t) => t.speaker === "usr");
  if (lastUser?.text === d.silenceMarker) return { say: utterances.noInput };

  const readiness = recommendationReadiness(is);
  const accepted = is.accepted === undefined ? undefined : is.recommended.find((m) => m.id === is.accepted);
  const mode: Mode = accepted
    ? "wrapup"
    : !readiness.ready
      ? "explore"
      : is.recommendStreak >= d.maxRecommendStreak
        ? "clarify"
        : "recommend";
  // Candidates are withheld unless we're in recommend mode: the LLM cannot pick one early.
  const pool = mode === "recommend" ? is.candidates.slice(0, d.candidatesShown) : [];
  const status =
    is.search.status === "failed" ? "error" : !hasSignal(is) || !hasTaste(is) ? "none_yet" : pool.length ? "ok" : "empty";

  const messages = [
    { role: "system" as const, content: `${respondSystem}\n${respondModes[mode]}` },
    {
      role: "user" as const,
      content: JSON.stringify({
        conversation: is.history.slice(-d.historyForRespond),
        whatWeKnow: stateSummary(is),
        tasteProfile: tasteProfile(is),
        alreadySuggested: is.recommended.map((m) => m.title),
        // suggested movies leave "candidates", so the LLM needs their facts here to answer follow-up questions
        suggestedDetails: is.recommended.slice(-d.suggestedDetails).map((m) => ({
          title: m.title,
          year: m.year,
          genres: m.genres,
          rating: m.rating,
          runtimeMinutes: m.runtime,
          description: m.overview.slice(0, d.descriptionChars.suggested),
        })),
        acceptedMovie: accepted?.title,
        candidatePool: mode === "recommend" ? status : "exploring",
        recommendationReady: mode === "recommend",
        meaningfulUserTurns: readiness.userTurns,
        distinctPreferenceSignals: readiness.distinctSignals,
        candidates: pool.map((m) => ({
          id: m.id,
          title: m.title,
          year: m.year,
          genres: m.genres,
          rating: m.rating,
          runtimeMinutes: m.runtime,
          description: m.overview.slice(0, d.descriptionChars.candidate),
        })),
        notices: is.private.notices,
      }),
    },
  ];

  // In explore/clarify mode the LLM must not name movies; clarifying may refer back to what was already suggested.
  // (Wrap-up may name the accepted movie, even if another candidate has the same title, e.g. two films called "Solaris".)
  const forbiddenTitles = (mode === "wrapup"
    ? is.candidates.filter((m) => m.title !== accepted?.title)
    : mode === "clarify" ? is.candidates : [...is.candidates, ...is.recommended])
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
      return { say, movieId: id };
    }
    if ((mode !== "wrapup" && id !== undefined) || forbiddenTitles.some((t) => mentions(say, t))) {
      console.warn("[respond] Premature recommendation blocked; retrying");
      continue;
    }
    return { say };
  }

  if (mode === "wrapup") return { say: utterances.wrapupFallback };
  if (mode === "clarify") return { say: utterances.clarifyFallback };
  if (mode === "explore") return { say: utterances.exploreFallback };
  throw new Error("LLM kept recommending a movie outside the candidates");
}
