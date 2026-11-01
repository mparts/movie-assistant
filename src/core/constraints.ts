/** Pure state updates for the user's hard requirements: constrain (absolute), adjust (relative), retract (drop). */
import { settings } from "../config/settings";
import { languageCode, resolveTone } from "./lexicon";
import { InformationState as IS, MoveOf } from "./types";
import { addUnique, without } from "./util";

const A = settings.adjust;

export function constrain(is: IS, m: MoveOf<"constrain">): IS {
  const c = is.constraints;
  const n = Number(m.value);
  const withC = (patch: Partial<IS["constraints"]>): IS => ({ ...is, constraints: { ...c, ...patch } });
  switch (m.slot) {
    case "runtime":
      if (isNaN(n)) return is;
      if (m.op === "lte") return withC({ runtime: { ...c.runtime, max: n } });
      if (m.op === "gte") return withC({ runtime: { ...c.runtime, min: n } });
      return withC({ runtime: { min: n - A.runtimeExactTolerance, max: n + A.runtimeExactTolerance } });
    case "year":
      if (isNaN(n)) return is;
      if (m.op === "lte") return withC({ year: { ...c.year, max: n } });
      if (m.op === "gte") return withC({ year: { ...c.year, min: n } });
      return withC({ year: { min: n, max: n } });
    case "rating":
      return isNaN(n) || m.op === "lte" ? is : withC({ rating: n });
    case "language": {
      const code = languageCode(String(m.value));
      return code ? withC({ language: code }) : is;
    }
  }
}

export function adjust(is: IS, m: MoveOf<"adjust">): IS {
  const c = is.constraints;
  const dir = m.direction.toLowerCase();
  const thisYear = new Date().getFullYear();
  const withC = (patch: Partial<IS["constraints"]>): IS => ({ ...is, constraints: { ...c, ...patch } });
  switch (m.dimension) {
    case "tone": {
      const names = resolveTone(dir);
      if (!names.length) return is;
      return {
        ...is,
        prefs: { ...is.prefs, genres: addUnique(is.prefs.genres, names) },
        dislikes: { genres: without(is.dislikes.genres, names) },
      };
    }
    case "runtime": {
      if (/short|less|quick|lower/.test(dir)) {
        const max = Math.max(A.runtimeFloor, (c.runtime.max ?? A.runtimeDefaultMax) - A.runtimeStep);
        const min = c.runtime.min !== undefined && c.runtime.min > max ? undefined : c.runtime.min;
        return withC({ runtime: { min, max } });
      }
      if (/long|more|epic/.test(dir)) {
        const min = (c.runtime.min ?? A.runtimeDefaultMin) + A.runtimeStep;
        const max = c.runtime.max !== undefined && c.runtime.max < min ? undefined : c.runtime.max;
        return withC({ runtime: { min, max } });
      }
      return is;
    }
    case "era": {
      if (/new|recent|modern|latest/.test(dir)) {
        const min = Math.min(thisYear, (c.year.min ?? A.yearDefaultMin) + A.yearStep);
        return withC({ year: { ...c.year, min } });
      }
      if (/old|classic|vintage/.test(dir)) {
        const max = (c.year.max ?? thisYear) - A.yearOlderStep;
        const min = c.year.min !== undefined && c.year.min > max ? undefined : c.year.min;
        return withC({ year: { min, max } });
      }
      return is;
    }
    case "rating": {
      if (/better|higher|good|best/.test(dir)) {
        return withC({ rating: Math.min(A.ratingCap, (c.rating ?? A.ratingDefault) + A.ratingStep) });
      }
      return is;
    }
  }
}

export function retract(is: IS, slot: string): IS {
  const c = is.constraints;
  switch (slot) {
    case "runtime": return { ...is, constraints: { ...c, runtime: {} } };
    case "year": return { ...is, constraints: { ...c, year: {} } };
    case "rating": return { ...is, constraints: { ...c, rating: undefined } };
    case "language": return { ...is, constraints: { ...c, language: undefined } };
    case "genres": return { ...is, prefs: { ...is.prefs, genres: [] } };
    case "dislikes": return { ...is, dislikes: { genres: [] } };
    case "vibe": return { ...is, vibe: [] };
    case "all":
      return {
        ...is,
        vibe: [],
        prefs: { genres: [], seeds: [] },
        constraints: { runtime: {}, year: {} },
        dislikes: { genres: [] },
      };
    default: return is;
  }
}
