import { settings } from "../config/settings";
import { hasTaste } from "./state";
import type { InformationState, Move } from "./types";

/** Only substantive taste/constraint information counts as a meaningful turn. */
export function evidenceFromMoves(moves: Move[]): string[] {
  return moves.flatMap((m): string[] => {
    switch (m.type) {
      case "wish": return [`wish:${m.text.trim().toLowerCase()}`];
      case "avoid": return [`avoid:${m.text.trim().toLowerCase()}`];
      case "person": return [`person:${m.negated ? "not:" : ""}${m.name.toLowerCase()}`];
      default: return [];
    }
  });
}

/** May the assistant start recommending? Needs some taste, plus enough conversation (or a "just pick" request). */
export function recommendationReadiness(is: InformationState) {
  const { minTurns, minSignals } = settings.dialogue.readiness;
  const userTurns = is.readiness.meaningfulTurns;
  const distinctSignals = new Set(is.readiness.evidence).size;
  const latestUser = [...is.history].reverse().find((t) => t.speaker === "usr")?.text ?? "";
  const skipQuestions = settings.dialogue.skipQuestions.test(latestUser);
  const ready = hasTaste(is) && (skipQuestions || (userTurns >= minTurns && distinctSignals >= minSignals));
  return { ready, userTurns, distinctSignals };
}
