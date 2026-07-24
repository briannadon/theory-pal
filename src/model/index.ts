// Public API surface for src/model/. Pure TS, no DOM except the isolated
// `fetch` inside loadModel, no React. Matches SPEC.md's `src/model/` section.
export type { ModeModel, Suggestion, SuggestParams, TransitionModel } from './types.ts';
export { loadModel } from './loadModel.ts';
export { suggest, surprise } from './suggest.ts';
export { theoryPrior } from './prior.ts';

// Tuning constants for the corpus/prior blend and the theory prior's
// functional-harmony weights, exported from one place per SPEC.md/PLAN.md.
export * from './constants.ts';
