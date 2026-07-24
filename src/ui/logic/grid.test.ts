import { describe, expect, it } from 'vitest';
import type { RelChord } from '../../theory/index.ts';
import {
  clearSlot,
  createGrid,
  parseSlotIndex,
  reorderGrid,
  resizeGrid,
  setSlot,
  slotId,
} from './grid.ts';

const I: RelChord = { degree: 0, quality: 'maj' };
const IV: RelChord = { degree: 5, quality: 'maj' };
const V: RelChord = { degree: 7, quality: 'maj' };
const vi: RelChord = { degree: 9, quality: 'min' };

describe('createGrid', () => {
  it('starts every slot empty', () => {
    const g = createGrid(4);
    expect(g.size).toBe(4);
    expect(g.slots).toEqual([null, null, null, null]);
  });
});

describe('setSlot / clearSlot', () => {
  it('sets a chord at an index without mutating the original state', () => {
    const g0 = createGrid(4);
    const g1 = setSlot(g0, 1, IV);
    expect(g1.slots).toEqual([null, IV, null, null]);
    expect(g0.slots).toEqual([null, null, null, null]); // original untouched
  });

  it('ignores out-of-range indices', () => {
    const g0 = createGrid(4);
    expect(setSlot(g0, -1, IV)).toBe(g0);
    expect(setSlot(g0, 4, IV)).toBe(g0);
  });

  it('clears a slot back to null', () => {
    let g = createGrid(4);
    g = setSlot(g, 2, V);
    g = clearSlot(g, 2);
    expect(g.slots).toEqual([null, null, null, null]);
  });
});

describe('resizeGrid', () => {
  it('pads with empty slots when growing', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeGrid(g, 8);
    expect(g.size).toBe(8);
    expect(g.slots).toEqual([I, null, null, null, null, null, null, null]);
  });

  it('truncates when shrinking, preserving remaining positions', () => {
    let g = createGrid(8);
    g = setSlot(g, 0, I);
    g = setSlot(g, 6, vi);
    g = resizeGrid(g, 4);
    expect(g.size).toBe(4);
    expect(g.slots).toEqual([I, null, null, null]);
  });
});

describe('reorderGrid', () => {
  it('moves a chord forward, shifting the ones in between back', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = setSlot(g, 2, V);
    // Move I (index 0) to index 2: IV and V each shift back one.
    g = reorderGrid(g, 0, 2);
    expect(g.slots).toEqual([IV, V, I, null]);
  });

  it('moves a chord backward, shifting the ones in between forward', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = setSlot(g, 2, V);
    g = reorderGrid(g, 2, 0);
    expect(g.slots).toEqual([V, I, IV, null]);
  });

  it('carries empty slots along like any other element', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    // slot 1 stays empty; move the empty slot itself to the end.
    g = reorderGrid(g, 1, 3);
    expect(g.slots).toEqual([I, null, null, null]);
  });

  it('is a no-op for identical or out-of-range indices', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    expect(reorderGrid(g, 0, 0)).toBe(g);
    expect(reorderGrid(g, -1, 2)).toBe(g);
    expect(reorderGrid(g, 0, 4)).toBe(g);
  });
});

describe('slotId / parseSlotIndex', () => {
  it('round-trips', () => {
    expect(parseSlotIndex(slotId(0))).toBe(0);
    expect(parseSlotIndex(slotId(15))).toBe(15);
  });

  it('rejects ids that are not grid-slot ids', () => {
    expect(parseSlotIndex('diatonic-3')).toBeNull();
    expect(parseSlotIndex('suggestion-surprise')).toBeNull();
  });
});
