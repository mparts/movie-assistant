import type { InformationState, Move } from "./types";

/** Only substantive taste/constraint information counts as a meaningful turn. */
export function evidenceFromMoves(moves: Move[]): string[] {
  return moves.flatMap((move) => {
    switch (move.type) {
      case "prefer": return [move.genre || move.mood ? `prefer:${move.negated ? "not:" : ""}${(move.genre || move.mood)!.toLowerCase()}` : ""];
      case "vibe": return [`vibe:${move.text.trim().toLowerCase()}`];
      case "like": return [`like:${move.title.trim().toLowerCase()}`];
      case "constrain": return [`constraint:${move.slot}:${move.op}:${move.value}`];
      case "adjust": return [`adjust:${move.dimension}:${move.direction.toLowerCase()}`];
      default: return [];
    }
  }).filter(Boolean);
}

const PICK_NOW = /\b(just (pick|choose|recommend)|surprise me|you (pick|choose)|stop asking|give me (a|one) (movie|recommendation)|recommend (something|one|a movie) (now|already))\b/i;

export function recommendationReadiness(is: InformationState) {
  const userTurns = is.readiness.meaningfulTurns;
  const hasTaste = is.prefs.genres.length > 0 || is.prefs.seeds.length > 0 || is.vibe.length > 0;
  const distinctSignals = new Set(is.readiness.evidence).size;
  const latestUser = [...is.history].reverse().find((turn) => turn.speaker === "usr")?.text ?? "";
  const skipQuestions = PICK_NOW.test(latestUser);
  const ready = hasTaste && (skipQuestions || (userTurns >= 2 && distinctSignals >= 2));
  return { ready, hasTaste, userTurns, distinctSignals, skipQuestions };
}
