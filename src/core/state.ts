/** The information state: its initial value and read-only views of it. */
import { settings } from "../config/settings";
import { certificationFor, Intake } from "./intake";
import { InformationState as IS, SearchCriteria } from "./types";
import { last } from "./util";

/** Every conversation starts from Phase 1's facts (the form, or a profile file in the typed chat). */
export const initialIS = (intake: Intake): IS => ({
  intake,
  next_moves: [],
  private: { notices: [] },
  shared: {},
  history: [],
  wish: "",
  avoid: [],
  people: [],
  candidates: [],
  recommended: [],
  rejected: [],
  qud: "none",
});

/** Taste = a wish or a wanted person. Filters and dislikes alone are not taste. */
export const hasTaste = (is: IS) => !!is.wish || is.people.some((p) => !p.negated);

/** Phase 1 as TMDB filters: the pool is every movie that passes them. The chat can only narrow this, locally. */
export function poolCriteria({ profile, tonight }: Intake): SearchCriteria {
  return {
    excludeGenres: tonight.avoidGenres,
    // Never below the floor for real movies (no shorts).
    runtime: { min: settings.intake.minMinutes, ...(tonight.maxMinutes !== undefined && { max: tonight.maxMinutes }) },
    year: {},
    certificationLte: certificationFor(tonight.youngestAge),
    watch: profile.platforms.length ? { region: profile.country, providers: profile.platforms } : undefined,
  };
}

/** Compact view of what the system currently believes, for the LLM prompts. Empty fields are omitted. */
export function stateSummary(is: IS): Record<string, unknown> {
  const { profile, tonight } = is.intake;
  const o: Record<string, unknown> = {
    // From the settings form: fixed for this conversation, never asked again.
    tonight: {
      ...(profile.name && { name: profile.name }),
      company: tonight.company,
      youngestViewerAge: tonight.youngestAge,
      ...(tonight.maxMinutes !== undefined && { timeLimitMinutes: tonight.maxMinutes }),
      ...(tonight.avoidGenres.length && { avoidGenres: tonight.avoidGenres }),
      streamingServices: profile.platforms.length || "none (any movie)",
    },
  };
  if (is.wish) o.wish = is.wish;
  const wanted = is.people.filter((p) => !p.negated).map((p) => p.name);
  const unwanted = is.people.filter((p) => p.negated).map((p) => p.name);
  if (wanted.length) o.wantedPeople = wanted;
  if (is.avoid.length) o.avoid = is.avoid;
  if (unwanted.length) o.avoidPeople = unwanted;
  return o;
}

export const lastSuggested = (is: IS): string | null => last(is.recommended)?.title ?? null;

/** The user's positive taste as one line, for Jake. */
export function tasteProfile(is: IS): string | null {
  const parts: string[] = [];
  if (is.wish) parts.push(`They want: ${is.wish}`);
  const wanted = is.people.filter((p) => !p.negated).map((p) => p.name);
  if (wanted.length) parts.push(`With: ${wanted.join(", ")}.`);
  return parts.join(" ") || null;
}
