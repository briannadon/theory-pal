import { describe, expect, it } from 'vitest';
import type { RelChord } from '../../theory/index.ts';
import { deriveContext } from './context.ts';

const I: RelChord = { degree: 0, quality: 'maj' };
const IV: RelChord = { degree: 5, quality: 'maj' };
const V: RelChord = { degree: 7, quality: 'maj' };
const vi: RelChord = { degree: 9, quality: 'min' };

describe('deriveContext', () => {
  it('returns [] for an entirely empty grid', () => {
    expect(deriveContext([null, null, null, null])).toEqual([]);
  });

  it('returns every chord, in order, for a fully-filled grid', () => {
    expect(deriveContext([I, IV, V, vi])).toEqual([I, IV, V, vi]);
  });

  it('returns the trailing contiguous run ending at the last filled slot', () => {
    // gap at index 1 breaks the run; only V, vi (indices 2-3) survive.
    expect(deriveContext([I, null, V, vi])).toEqual([V, vi]);
  });

  it('ignores trailing empty slots and reports up to the last filled one', () => {
    expect(deriveContext([I, IV, null, null])).toEqual([I, IV]);
  });

  it('a single filled slot after a gap yields a single-chord context', () => {
    expect(deriveContext([I, IV, null, V, null])).toEqual([V]);
  });

  it('does not mutate the input', () => {
    const slots = [I, null, V, vi];
    const copy = slots.slice();
    deriveContext(slots);
    expect(slots).toEqual(copy);
  });
});
