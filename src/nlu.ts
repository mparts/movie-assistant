import { GENRES } from "./lexicon";
import { InformationState, LlmClient, Move } from "./types";
import { lastSuggested, stateSummary } from "./summary";

const SYSTEM = `You turn ONE spoken utterance from a person who is choosing a movie into structured notes. Output ONLY a JSON object: {"moves":[...]}.

Record only what the person actually expressed. Greetings, small talk, or questions to the assistant give {"moves":[]}.

Move types:
{"type":"prefer","genre":"<genre>"}  they want this genre; add "negated":true if they do NOT want it ("no horror")
{"type":"prefer","mood":"<word>"}  a mood word when no single genre fits: exciting, funny, scary, romantic, feel-good, dark, mind-bending, family
{"type":"constrain","slot":"runtime|year|rating|language","op":"lte|gte|eq","value":<number, or language name>}  runtime in minutes, year as a 4-digit number, rating 0-10
{"type":"adjust","dimension":"tone|runtime|era|rating","direction":"<word>"}  a relative request about what was just suggested: funnier, scarier, shorter, longer, newer, older, better
{"type":"like","title":"<movie title>"}  they name a movie they love or want something similar to
{"type":"seen","title":"<optional>"}  they already watched a movie; omit title if they mean the one just suggested
{"type":"reject","title":"<optional>"}  they don't want that particular movie; omit title if they mean the one just suggested
{"type":"retract","slot":"runtime|year|rating|language|genres|dislikes|vibe|all"}  they drop an earlier requirement
{"type":"vibe","text":"<short phrase>"}  a loose taste or feeling that is not a genre, in their own sense: "cozy", "makes me think", "watching with my dad", "slow burn", "nothing too heavy"
{"type":"restart"}  they want to start over

Genres are exactly: ${GENRES.join(", ")}.
Use the conversation and the known state to resolve "that", "it", "the first one". Several moves per utterance are fine. Speech recognition may mishear titles: if a title looks like a misheard movie, write the most likely real title.

Examples:
"I only have about ninety minutes" -> {"moves":[{"type":"constrain","slot":"runtime","op":"lte","value":90}]}
"something cozy to watch with my girlfriend" -> {"moves":[{"type":"vibe","text":"cozy"},{"type":"vibe","text":"date night"}]}
"no horror please, and something recent" -> {"moves":[{"type":"prefer","genre":"Horror","negated":true},{"type":"constrain","slot":"year","op":"gte","value":2015}]}
"I loved Knives Out" -> {"moves":[{"type":"like","title":"Knives Out"}]}
"something quick" -> {"moves":[{"type":"constrain","slot":"runtime","op":"lte","value":100}]}
"I've already seen that one" -> {"moves":[{"type":"seen"}]}
"nah, not feeling that one" -> {"moves":[{"type":"reject"}]}
"it isn't even christmas" (after a christmas movie was suggested) -> {"moves":[{"type":"reject"},{"type":"vibe","text":"not christmassy"}]}
"hmm, can it be funnier?" -> {"moves":[{"type":"adjust","dimension":"tone","direction":"funnier"}]}
"hi, how are you?" -> {"moves":[]}`;

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

/** Accept only well-formed moves; anything else the LLM produced is dropped. */
function clean(m: any): Move | null {
  if (!m || typeof m !== "object") return null;
  switch (m.type) {
    case "prefer": {
      const genre = str(m.genre);
      const mood = str(m.mood);
      return genre || mood ? { type: "prefer", genre, mood, negated: m.negated === true } : null;
    }
    case "constrain": {
      if (!["runtime", "year", "rating", "language"].includes(m.slot)) return null;
      if (!["lte", "gte", "eq"].includes(m.op)) return null;
      const value = typeof m.value === "number" ? m.value : str(m.value);
      return value === undefined ? null : { type: "constrain", slot: m.slot, op: m.op, value };
    }
    case "adjust": {
      const direction = str(m.direction);
      return direction && ["tone", "runtime", "era", "rating"].includes(m.dimension)
        ? { type: "adjust", dimension: m.dimension, direction }
        : null;
    }
    case "like": {
      const title = str(m.title);
      return title ? { type: "like", title } : null;
    }
    case "seen":
    case "reject":
      return { type: m.type, title: str(m.title) };
    case "retract": {
      const slot = str(m.slot);
      return slot ? { type: "retract", slot } : null;
    }
    case "vibe": {
      const text = str(m.text);
      return text ? { type: "vibe", text } : null;
    }
    case "restart":
      return { type: "restart" };
    default:
      return null;
  }
}

/** One LLM call: utterance (+ short history and known state) → moves. */
export async function understand(
  llm: LlmClient,
  text: string,
  is: InformationState
): Promise<Move[]> {
  const out: any = await llm.json(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          conversation: is.history.slice(-6),
          whatWeKnow: stateSummary(is),
          lastSuggestedMovie: lastSuggested(is),
          utterance: text,
        }),
      },
    ],
    { temperature: 0, maxTokens: 800, prefer: "ollama" } // extraction is fine on a small local model; saves Groq tokens for Jake
  );
  const raw: unknown[] = Array.isArray(out?.moves) ? out.moves : [];
  return raw.map(clean).filter((m): m is Move => m !== null);
}