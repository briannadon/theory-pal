// Types for the trained model file (SPEC.md "Trained model file —
// public/model/transitions.json") and the suggestion-engine's public data
// shapes (SPEC.md "src/model/"). Pure data, no logic.
import type { Key, RelChord, ScaleId } from '../theory/index.ts';

/**
 * Per-mode transition counts as emitted by `data/`. Counts are raw (not
 * probabilities) and may be fractional, since the pipeline uses soft
 * key-assignment (SPEC.md, PLAN.md step 3) — `model/` owns all smoothing and
 * normalization. `order1`/`order2` map a state (or `"state1>state2"` for
 * order-2) to a record of next-state -> count; `totals1`/`totals2` give the
 * (possibly fractional) total observations for that context, used for the
 * corpus-confidence term independent of how many distinct next-states were
 * observed.
 */
export interface ModeModel {
  order1: Record<string, Record<string, number>>;
  order2: Record<string, Record<string, number>>;
  order3?: Record<string, Record<string, number>>;
  totals1: Record<string, number>;
  totals2: Record<string, number>;
  totals3?: Record<string, number>;
}

/** The full trained model file. Modes the pipeline could not populate are
 * simply absent from `modes`; `model/` falls back to the theory prior for
 * them (identical to the `model === null` path, just scoped to one mode). */
export interface TransitionModel {
  version: number;
  generatedAt: string;
  source: string;
  songCount: number;
  modes: Partial<Record<ScaleId, ModeModel>>;
}

/** One ranked next-chord suggestion. */
export interface Suggestion {
  chord: RelChord;
  /** 0-1, normalized over the returned list (i.e. the list this Suggestion
   * came from sums to ~1, not the full internal candidate universe). */
  probability: number;
  diatonic: boolean;
  /** false = the theory prior alone carried this candidate; true = corpus
   * counts for the active context contributed a nonzero observed count. */
  fromCorpus: boolean;
}

export interface SuggestParams {
  /** Chord history, oldest first, most recent last. May be empty. */
  context: RelChord[];
  key: Key;
  limit?: number;
}
