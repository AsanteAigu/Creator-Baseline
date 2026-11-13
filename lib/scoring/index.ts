import type { ScoringConfig } from "./types";

export * from "./types";
export { computeRates, median, type Rates } from "./rates";
export { computeBaseline, isOldEnough, type BaselineOptions } from "./baseline";
export {
  clampRatio,
  combineScore,
  labelFor,
  renormalise,
  roundForStorage,
  scoreAll,
  scorePost,
  weightsFor,
} from "./score";

/** §5 defaults. The column defaults in the initial migration mirror these. */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: { watch_time: 0.35, sends: 0.25, saves: 0.2, likes: 0.1, comments: 0.1 },
  photoWeights: { sends: 0.4, saves: 0.3, likes: 0.15, comments: 0.15 },
  cap: 5,
  strongCutoff: 1.5,
  weakCutoff: 0.9,
  minAgeHours: 24,
  medianWindow: 30,
};
