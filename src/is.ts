import { InformationState } from "./types";

export const initialIS = (): InformationState => ({
  next_moves: [],
  private: { agenda: [], notices: [] },
  shared: {},
  history: [],
  prefs: { genres: [], seeds: [] },
  vibe: [],
  constraints: { runtime: {}, year: {} },
  dislikes: { genres: [] },
  candidates: [],
  recommended: [],
  rejected: [],
  search: { status: "idle", page: 1, noMore: false },
});
