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
/**
 * Both sides of a specific slot, for ranking a chord to put *in* it rather
 * than after the progression. `context` is the run of filled slots leading up
 * to the target, `following` the chord immediately after it if there is one.
 *
 * The gap rule from `deriveContext` applies in both directions: a run stops at
 * an empty slot, and a chord that is not immediately after the target does not
 * become `following`. Silence reads as a phrase break whichever side of the
 * target it falls on.
 *
 * `target === null` is the default, untargeted case and returns exactly what
 * `deriveContext` does, with no `following`.
 */
export function deriveSlotContext(
  slots: readonly (RelChord | null)[],
  target: number | null,
): { context: RelChord[]; following?: RelChord } {
  if (target === null || target < 0 || target >= slots.length) {
    return { context: deriveContext(slots) };
  }

  let start = target;
  while (start > 0 && slots[start - 1] !== null) start--;
  const context: RelChord[] = [];
  for (let i = start; i < target; i++) context.push(slots[i] as RelChord);

  const following = slots[target + 1] ?? null;
  return following !== null ? { context, following } : { context };
}

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
