import { InformationState } from "./types";

export const initialIS = (): InformationState => ({
  next_moves: [],
  private: { agenda: [], notices: [] },
  shared: {},
  history: [],
  readiness: { meaningfulTurns: 0, evidence: [] },
  prefs: { genres: [], seeds: [] },
  vibe: [],
  constraints: { runtime: {}, year: {} },
  dislikes: { genres: [] },
  candidates: [],
  recommended: [],
  rejected: [],
  recommendStreak: 0,
  search: { status: "idle", page: 1, noMore: false },
});