// Derives the suggestion-engine's `SuggestParams.context` (SPEC.md: "Chord
// history, oldest first, most recent last") from the progression grid's
// current state. This is data plumbing, not music theory — the actual
// suggestion ranking lives entirely in `model/`.
import type { RelChord } from '../../theory/index.ts';

/**
 * The trailing run of consecutively-filled slots ending at the grid's last
 * filled slot. A cleared/empty slot breaks the run: silence in the
 * progression reads as a phrase break, so suggestions after a gap start
 * fresh rather than reaching back across it. An entirely empty grid yields
 * `[]`, which `suggest`/`theoryPrior` both treat as "no history yet" (they
 * default to scoring as if sitting on the tonic).
 */
export function deriveContext(slots: readonly (RelChord | null)[]): RelChord[] {
  let lastFilled = -1;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i] !== null) {
      lastFilled = i;
      break;
    }
  }
  if (lastFilled < 0) return [];

  let start = lastFilled;
  while (start > 0 && slots[start - 1] !== null) start--;

  const run: RelChord[] = [];
  for (let i = start; i <= lastFilled; i++) run.push(slots[i] as RelChord);
  return run;
}
