import { InformationState } from "./types";

export function tasteProfile(is: InformationState): string | null {
  const parts: string[] = [];
  if (is.vibe.length) {
    parts.push(`Desired feeling, atmosphere or themes: ${is.vibe.join("; ")}.`);
  }
  if (is.prefs.genres.length) {
    parts.push(`Preferred genres: ${is.prefs.genres.join(", ")}.`);
  }
  if (is.prefs.seeds.length) {
    parts.push(
      `Movies the user likes: ${is.prefs.seeds
        .map((movie) => `${movie.title} (${movie.genres.join(", ")})${movie.overview ? `: ${movie.overview.slice(0, 400)}` : ""}`)
        .join("; ")}.`
    );
  }
  return parts.length ? parts.join(" ") : null;
}
