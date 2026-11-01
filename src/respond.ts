import { recommendationReadiness } from "./readiness";
import { InformationState, LlmClient } from "./types";
import { hasSignal } from "./rules";
import { stateSummary } from "./summary";
import { tasteProfile } from "./taste-profile";

/** How many candidates the LLM sees (best-ranked first). */
export const POOL_SHOWN = 8;
/** After this many recommendations in a row, stop suggesting and ask what is missing. */
export const MAX_RECOMMEND_STREAK = 2;
export const OPENING_MESSAGE  = "Hey! I’m Jake, your movie companion. How are you feeling today?";
export const NO_INPUT_MESSAGE = "Still there? Take your time — what are you thinking?";

const SYSTEM = `You are Jake, a warm, easygoing friend who knows movies well, talking out loud with someone to help them decide what to watch tonight. Everything you write is spoken aloud: use 1 to 3 short, natural sentences. No lists, no markdown, no emojis, no stage directions.

Voice: dry, warm, casual, like a friend texting. Vary your openers; never start with "Wow", "Great", "Awesome" or an echo of their words; at most one exclamation mark; no emojis.
Example: "Ha, fair. Something that won't make you think too hard, then. Are you more in a laughing mood or a cozy one?"
Example: "That one's a slow burn, but it's got a great creepy streak. Does that sound like your kind of night?"

How to behave:
- Have a real conversation. React to what they just said first. Be curious about them, not about a checklist.
- Gradually get a feel for their taste: what they've enjoyed lately, their mood, who they're watching with, how much time they have. Ask at most ONE light question per turn, and only when it helps. Never ask for something you already know (see "whatWeKnow"). Never interrogate.
- "tasteProfile" summarizes the user's current positive taste signals. Use it to judge which movie descriptions fit their desired experience, not just genre overlap. Hard constraints are already applied by the search.
- You don't need to know everything. Once you have a real feel for their taste (a mood, a kind of movie, a movie they love), suggest ONE movie from "candidates" and say in a sentence why it fits what they told you. Choose the candidate whose description best matches their mood and taste, not simply the first one. A time limit alone is not taste: if that's all you know, ask what they're in the mood for instead.
- If they react to a suggestion (already seen it, not feeling it, sounds good), respond naturally and then adjust or offer a different candidate. If they say yes, wrap up warmly and briefly.
- If their reaction is lukewarm or vague ("maybe", "sure", "I guess", "hmm"), do NOT just throw another movie at them. Ask one light question to find out what isn't clicking or what they'd rather have. Don't suggest a different movie two turns in a row unless they rejected the last one, had seen it, or asked for another.
- If they ask you a question (what genre, what it's about, how long, who's in it), ANSWER IT FIRST from the entry in "suggestedDetails" (paraphrase the description; if a detail isn't there, say you're not sure) and set "recommend" to null. Do not suggest a different movie unless they reject, have seen, or ask for another.
- Only ever suggest a movie that appears in "candidates", and set "recommend" to its id. Never suggest any other movie (you may mention movies the person brought up). The only facts you may state about a candidate or a suggested movie are those in its entry: description, genres, year, rating, and runtimeMinutes. If runtimeMinutes is missing, don't mention its length. Never guess.
- "candidatePool" tells you the situation: "none_yet" = we don't know their taste yet, nothing to suggest, keep getting to know them; "ok" = you may suggest; "empty" = nothing matches, say so and offer to loosen one specific thing; "error" = the movie database is having trouble, say so briefly.
- "notices" are things that happened behind the scenes this turn; weave them in naturally if relevant (for example a title you couldn't find).
- If the conversation is empty, open warmly and invite them to say what they feel like watching, without a long introduction. If the person was silent ("(silence)"), gently check they're still there.

Reply with ONLY a JSON object: {"say": "<what you say aloud>", "recommend": <candidate id, or null>}`;

export interface Reply {
  say: string;
  movieId?: number;
}

/** One LLM call: conversation + state + real TMDB candidates → what to say (and which candidate, if any). */
export async function respond(llm: LlmClient, is: InformationState): Promise<{ say: string; movieId?: number }> {
  // Deterministic opening
  if (is.history.length === 0) {return { say: OPENING_MESSAGE };}
  // Handle silence without calling the LLM
  const lastUserTurn = [...is.history].reverse().find(turn => turn.speaker === "usr");
  if (lastUserTurn?.text === "(silence)") {return { say: NO_INPUT_MESSAGE };}
  // Taste = a mood/genre, a movie they like, or a vibe. Time/year limits and dislikes alone are not enough to suggest anything.
  const hasTaste = is.prefs.genres.length > 0 || is.prefs.seeds.length > 0 || is.vibe.length > 0;
  const readiness = recommendationReadiness(is);
  // Withhold candidates until the readiness gate is satisfied; the LLM cannot pick one early.
  const clarifying = readiness.ready && is.recommendStreak >= MAX_RECOMMEND_STREAK;
  const canRecommend = readiness.ready && !clarifying;
  const pool = canRecommend ? is.candidates.slice(0, POOL_SHOWN) : [];
  const status =
    is.search.status === "failed"
      ? "error"
      : !hasSignal(is) || !hasTaste
        ? "none_yet"
        : pool.length
          ? "ok"
          : "empty";

  const messages = [

    { role: "system" as const, content: SYSTEM + (canRecommend
      ? "\nThe conversation is ready for a recommendation. You may choose a candidate if appropriate."
      : clarifying
      ? "\nCLARIFY MODE: You have just suggested two movies in a row, so do NOT suggest, name, or hint at any movie now. Briefly acknowledge what they said, then ask exactly ONE question to find out what is missing. Prefer offering to drop or loosen one specific thing from whatWeKnow (one of the wantedGenres, the runtime limit, or the year range), or ask what they would change about the last suggestions. Output recommend:null."
      : "\nEXPLORATION MODE: Do not recommend, name, or hint at any specific movie. Respond empathetically to the latest user message, then ask exactly one insightful, natural follow-up question about their desired experience, preferences, or constraints. Avoid repeating an earlier question. The candidate list is intentionally unavailable. Output recommend:null." ) },
    {
      role: "user" as const,
      content: JSON.stringify({
        conversation: is.history.slice(-12),
        whatWeKnow: stateSummary(is),
        tasteProfile: tasteProfile(is),
        alreadySuggested: is.recommended.map((m) => m.title),
        // suggested movies leave "candidates", so the LLM needs their facts here to answer follow-up questions
        suggestedDetails: is.recommended.slice(-5).map((m) => ({
          title: m.title, year: m.year, genres: m.genres, rating: m.rating,
          runtimeMinutes: m.runtime, description: m.overview.slice(0, 400),
        })),
        candidatePool: canRecommend ? status : "exploring",
        recommendationReady: canRecommend,
        meaningfulUserTurns: readiness.userTurns,
        distinctPreferenceSignals: readiness.distinctSignals,
        candidates: pool.map((m) => ({
          id: m.id,
          title: m.title,
          year: m.year,
          genres: m.genres,
          rating: m.rating,
          runtimeMinutes: m.runtime,
          description: m.overview.slice(0, 220),
        })),
        notices: is.private.notices,
      }),
    },
  ];

  // If the LLM suggests something outside the candidates it is probably naming an invented movie: ask once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const out: any = await llm.json(messages, { temperature: 0.7, maxTokens: 1200 });
    const say = typeof out?.say === "string" ? out.say.trim().slice(0, 700) : "";
    if (!say) throw new Error("LLM returned no 'say'");
    const id = typeof out?.recommend === "number" ? out.recommend : undefined;
    if (id !== undefined && !pool.some((m) => m.id === id)) {
      console.warn(`[respond] LLM recommended id ${id}, which is not a candidate; retrying`);
      continue;
    }
    if (!canRecommend) {
      // A model may ignore the instruction and mention a movie in the spoken text.
      // Reject obvious title mentions rather than trusting recommend:null alone.
      // (When clarifying, referring back to the movies already suggested is fine.)
      const knownTitles = (clarifying ? is.candidates : [...is.candidates, ...is.recommended]).map((m) => m.title)
        .filter((title) => title.length >= 4);
      if (id !== undefined || knownTitles.some((title) => say.toLowerCase().includes(title.toLowerCase()))) {
        console.warn("[respond] Premature recommendation blocked; retrying");
        continue;
      }
      return { say };
    }
    return { say, movieId: id };
  }
  if (clarifying) {
    return { say: "Neither of those quite landed. What would you change about them?" };
  }
  if (!readiness.ready) {
    return { say: "What kind of feeling would you like the movie to leave you with?" };
  }
  throw new Error("LLM kept recommending a movie outside the candidates");
}