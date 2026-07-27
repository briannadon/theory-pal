import { describe, expect, it } from 'vitest';
import type { RelChord } from '../../theory/index.ts';
import {
  beatsLabel,
  chordAtBeat,
  clearSlot,
  createGrid,
  duplicateSlot,
  parseSlotIndex,
  placeChord,
  reorderGrid,
  resizeGrid,
  resizeSlot,
  setSlot,
  setSlotStart,
  slotId,
  slotIndexAtBeat,
  slotIndexEndingAt,
  slotStarts,
  splitSlot,
  totalBeats,
  type GridState,
} from './grid.ts';

const I: RelChord = { degree: 0, quality: 'maj' };
const IV: RelChord = { degree: 5, quality: 'maj' };
const V: RelChord = { degree: 7, quality: 'maj' };
const vi: RelChord = { degree: 9, quality: 'min' };

/** Compact view of a grid for assertions: chord (or null) and its length. */
const shape = (g: GridState) => g.slots.map((s) => [s.chord, s.beats] as const);
const sum = (g: GridState) => g.slots.reduce((t, s) => t + s.beats, 0);

describe('createGrid', () => {
  it('starts as one empty four-beat slot per bar', () => {
    const g = createGrid(4);
    expect(g.size).toBe(4);
    expect(shape(g)).toEqual([
      [null, 4],
      [null, 4],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(totalBeats(g));
  });
});

describe('setSlot / clearSlot', () => {
  it('sets a chord without touching its length or the original state', () => {
    const g0 = createGrid(4);
    const g1 = setSlot(g0, 1, IV);
    expect(shape(g1)[1]).toEqual([IV, 4]);
    expect(g0.slots[1].chord).toBeNull();
  });

  it('ignores out-of-range indices', () => {
    const g0 = createGrid(4);
    expect(setSlot(g0, -1, IV)).toBe(g0);
    expect(setSlot(g0, 4, IV)).toBe(g0);
  });

  it('clears a chord but leaves its span in place', () => {
    let g = createGrid(4);
    g = setSlot(g, 2, V);
    g = resizeSlot(g, 2, 2);
    g = clearSlot(g, 2);
    expect(g.slots[2]).toEqual({ chord: null, beats: 2 });
    expect(sum(g)).toBe(16);
  });
});

describe('resizeSlot', () => {
  it('hands freed beats to a new empty slot behind it', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = resizeSlot(g, 0, 3);
    expect(shape(g)).toEqual([
      [I, 3],
      [null, 1],
      [IV, 4],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('extends the following empty slot rather than adding another', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 3);
    g = resizeSlot(g, 0, 2);
    expect(shape(g)).toEqual([
      [I, 2],
      [null, 6],
      [null, 4],
      [null, 4],
    ]);
  });

  it('takes beats from the next slot when growing', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = resizeSlot(g, 0, 5);
    expect(shape(g)).toEqual([
      [I, 5],
      [IV, 3],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('consumes slots it swallows whole', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = setSlot(g, 2, V);
    g = resizeSlot(g, 0, 10);
    expect(shape(g)).toEqual([
      [I, 10],
      [V, 2],
      [null, 4],
    ]);
  });

  it('cannot grow past the end of the timeline', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 99);
    expect(shape(g)).toEqual([[I, 16]]);
    expect(sum(g)).toBe(16);
  });

  it('snaps to sixteenths and never goes below one', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 1.3);
    expect(g.slots[0].beats).toBe(1.25);
    g = resizeSlot(g, 0, 0);
    expect(g.slots[0].beats).toBe(0.25);
    expect(sum(g)).toBe(16);
  });

  it('is a no-op when the length does not change', () => {
    const g = setSlot(createGrid(4), 0, I);
    expect(resizeSlot(g, 0, 4)).toBe(g);
    expect(resizeSlot(g, 9, 2)).toBe(g);
  });
});

describe('setSlotStart', () => {
  it('closes the gap in front of a chord, holding its right edge still', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 2); // I for 2 beats, the rest of the timeline empty
    g = splitSlot(g, 1, 2); // 2 beats of gap, then the slot the chord lands in
    g = setSlot(g, 2, V); // V starts at beat 4, two beats after I ends
    g = setSlotStart(g, 2, 2);
    expect(shape(g)).toEqual([
      [I, 2],
      [V, 6],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('eats into the previous chord once the gap is used up', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, V);
    g = setSlotStart(g, 1, 3);
    expect(shape(g)).toEqual([
      [I, 3],
      [V, 5],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('consumes slots it swallows whole', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = setSlot(g, 2, V);
    g = setSlotStart(g, 2, 2);
    expect(shape(g)).toEqual([
      [I, 2],
      [V, 10],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('cannot start before the beginning of the timeline', () => {
    let g = createGrid(4);
    g = setSlot(g, 1, V);
    g = setSlotStart(g, 1, -99);
    expect(shape(g)).toEqual([
      [V, 8],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('leaves empty space in front when the edge moves later', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, V);
    g = setSlotStart(g, 1, 6);
    expect(shape(g)).toEqual([
      [I, 4],
      [null, 2],
      [V, 2],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('extends the preceding empty slot rather than adding another', () => {
    let g = createGrid(4);
    g = setSlot(g, 1, V);
    g = setSlotStart(g, 1, 5);
    g = setSlotStart(g, 1, 6);
    expect(shape(g)).toEqual([
      [null, 6],
      [V, 2],
      [null, 4],
      [null, 4],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('snaps to sixteenths and keeps at least one of them', () => {
    let g = createGrid(4);
    g = setSlot(g, 1, V);
    g = setSlotStart(g, 1, 4.3);
    expect(slotStarts(g)[1]).toBe(4.25);
    g = setSlotStart(g, 1, 99);
    expect(g.slots[1].beats).toBe(0.25);
    expect(sum(g)).toBe(16);
  });

  it('is a no-op when the edge does not move', () => {
    const g = setSlot(createGrid(4), 1, V);
    expect(setSlotStart(g, 1, 4)).toBe(g);
    expect(setSlotStart(g, 9, 2)).toBe(g);
  });
});

describe('placeChord', () => {
  it('takes only a bar of a long empty span, leaving the rest droppable', () => {
    let g = createGrid(8);
    g = resizeSlot(g, 0, 12); // one long empty span
    g = placeChord(g, 0, I);
    expect(shape(g).slice(0, 2)).toEqual([
      [I, 4],
      [null, 8],
    ]);
    expect(sum(g)).toBe(32);
  });

  it('fills a short empty span whole — the 1-beat pickup after a 3-beat chord', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = resizeSlot(g, 0, 3); // opens one empty beat at the end of bar 1
    g = placeChord(g, 1, V);
    expect(shape(g).slice(0, 3)).toEqual([
      [I, 3],
      [V, 1],
      [IV, 4],
    ]);
  });

  it('leaves an occupied slot its own length', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 6);
    g = placeChord(g, 0, V);
    expect(shape(g)[0]).toEqual([V, 6]);
  });
});

describe('splitSlot', () => {
  it('cuts a slot in two, the remainder empty', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = splitSlot(g, 0, 2);
    expect(shape(g).slice(0, 2)).toEqual([
      [I, 2],
      [null, 2],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('refuses a cut at or past either edge', () => {
    const g = setSlot(createGrid(4), 0, I);
    expect(splitSlot(g, 0, 0)).toBe(g);
    expect(splitSlot(g, 0, 4)).toBe(g);
  });
});

describe('resizeGrid', () => {
  it('appends whole empty bars when growing', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeGrid(g, 8);
    expect(g.size).toBe(8);
    expect(g.slots).toHaveLength(8);
    expect(g.slots[0].chord).toBe(I);
    expect(sum(g)).toBe(32);
  });

  it('cuts the timeline at the new length, shortening a straddling slot', () => {
    let g = createGrid(8);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 18);
    g = resizeGrid(g, 4);
    expect(shape(g)).toEqual([[I, 16]]);
    expect(sum(g)).toBe(16);
  });

  it('drops chords past the cut', () => {
    let g = createGrid(8);
    g = setSlot(g, 0, I);
    g = setSlot(g, 6, vi);
    g = resizeGrid(g, 4);
    expect(g.slots.map((s) => s.chord)).toEqual([I, null, null, null]);
  });
});

describe('reorderGrid', () => {
  it('moves a chord forward, shifting the ones in between back', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, IV);
    g = setSlot(g, 2, V);
    g = reorderGrid(g, 0, 2);
    expect(g.slots.map((s) => s.chord)).toEqual([IV, V, I, null]);
  });

  it('carries each chord its own length', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 2); // I is 2 beats; the empty slot after it absorbs the rest
    g = setSlot(g, 2, IV);
    g = reorderGrid(g, 0, 2);
    expect(shape(g).slice(0, 3)).toEqual([
      [null, 6],
      [IV, 4],
      [I, 2],
    ]);
    expect(sum(g)).toBe(16);
  });

  it('is a no-op for identical or out-of-range indices', () => {
    const g = setSlot(createGrid(4), 0, I);
    expect(reorderGrid(g, 0, 0)).toBe(g);
    expect(reorderGrid(g, -1, 2)).toBe(g);
    expect(reorderGrid(g, 0, 9)).toBe(g);
  });
});

describe('timeline queries', () => {
  it('reports where each slot starts', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 3);
    expect(slotStarts(g)).toEqual([0, 3, 8, 12]);
  });

  it('finds the slot and chord sounding at a beat', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = resizeSlot(g, 0, 3);
    g = setSlot(g, 1, V); // the 1-beat pickup that fills bar 1
    expect(chordAtBeat(g, 0)).toBe(I);
    expect(chordAtBeat(g, 2.75)).toBe(I);
    expect(chordAtBeat(g, 3)).toBe(V);
    expect(slotIndexAtBeat(g, 3.5)).toBe(1);
    expect(slotIndexAtBeat(g, 16)).toBe(-1);
  });
});

describe('slotIndexEndingAt', () => {
  it('finds the slot whose right edge lands on a beat, and only that one', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, I);
    g = setSlot(g, 1, V);
    g = resizeSlot(g, 0, 3); // [I 3][gap 1][V 4][…]
    expect(slotIndexEndingAt(g, 3)).toBe(0);
    expect(slotIndexEndingAt(g, 4)).toBe(1);
    expect(slotIndexEndingAt(g, 8)).toBe(2);
    expect(slotIndexEndingAt(g, 2)).toBe(-1);
    expect(slotIndexEndingAt(g, 99)).toBe(-1);
  });

  it('holds a chord across the re-cut its own left-edge drag causes', () => {
    let g = createGrid(4);
    g = setSlot(g, 1, V);
    const end = 8; // V ends at beat 8 and stays there while its start moves
    g = setSlotStart(g, slotIndexEndingAt(g, end), 2); // eats half the gap
    expect(slotIndexEndingAt(g, end)).toBe(1);
    g = setSlotStart(g, slotIndexEndingAt(g, end), 0); // and then the rest of it
    expect(slotIndexEndingAt(g, end)).toBe(0); // the slot in front is gone
    expect(shape(g)).toEqual([
      [V, 8],
      [null, 4],
      [null, 4],
    ]);
  });
});

describe('duplicateSlot', () => {
  it('copies into the empty space after the chord, taking only its own length', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, IV);
    g = duplicateSlot(g, 0);
    expect(shape(g)).toEqual([
      [IV, 4],
      [IV, 4],
      [null, 4],
      [null, 4],
    ]);
  });

  it('leaves the rest of a long gap empty rather than swallowing it', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, IV);
    g = resizeSlot(g, 0, 1); // a 1-beat stab, then 7 beats of space
    g = duplicateSlot(g, 0);
    expect(shape(g).slice(0, 3)).toEqual([
      [IV, 1],
      [IV, 1],
      [null, 6],
    ]);
  });

  it('fills a gap shorter than the chord without growing it', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, IV); // 4 beats
    g = setSlot(g, 1, V);
    g = setSlotStart(g, 1, 6); // V starts late, leaving 2 beats of space
    g = duplicateSlot(g, 0);
    expect(shape(g)).toEqual([
      [IV, 4],
      [IV, 2],
      [V, 2],
      [null, 4],
      [null, 4],
    ]);
  });

  it('splits the chord in two when the next slot is filled', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, IV);
    g = setSlot(g, 1, V);
    g = duplicateSlot(g, 0);
    expect(shape(g)).toEqual([
      [IV, 2],
      [IV, 2],
      [V, 4],
      [null, 4],
      [null, 4],
    ]);
  });

  it('splits the last slot, which has nothing after it at all', () => {
    let g = createGrid(4);
    for (let i = 0; i < 4; i++) g = setSlot(g, i, I);
    g = duplicateSlot(g, 3);
    expect(shape(g).slice(3)).toEqual([
      [I, 2],
      [I, 2],
    ]);
  });

  it('rounds an odd split to the grid unit rather than shedding a sliver', () => {
    const g: GridState = { size: 4, slots: [{ chord: IV, beats: 0.75 }, { chord: V, beats: 15.25 }] };
    expect(shape(duplicateSlot(g, 0)).slice(0, 2)).toEqual([
      [IV, 0.5],
      [IV, 0.25],
    ]);
  });

  it('never changes the length of the timeline', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, IV);
    g = setSlot(g, 1, V);
    g = resizeSlot(g, 1, 2);
    for (const i of [0, 1, 2]) {
      const dup = duplicateSlot(g, i);
      expect(dup.slots.reduce((t, s) => t + s.beats, 0)).toBe(totalBeats(g));
    }
  });

  it('copies the mods, and copies them by value', () => {
    let g = createGrid(4);
    g = setSlot(g, 0, { degree: 7, quality: 'dom7', mods: { ninth: true } });
    g = duplicateSlot(g, 0);
    expect(g.slots[1].chord).toEqual({ degree: 7, quality: 'dom7', mods: { ninth: true } });
    expect(g.slots[1].chord?.mods).not.toBe(g.slots[0].chord?.mods);
  });

  it('does nothing to an empty slot, an out-of-range index, or a chord too short to split', () => {
    // At the minimum length with a chord next door: no gap to copy into and no
    // middle to split.
    const g: GridState = { size: 4, slots: [{ chord: IV, beats: 0.25 }, { chord: V, beats: 15.75 }] };
    expect(duplicateSlot(g, 0)).toBe(g);
    const empty = createGrid(4);
    expect(duplicateSlot(empty, 0)).toBe(empty);
    expect(duplicateSlot(empty, 99)).toBe(empty);
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

describe('beatsLabel', () => {
  it('names whole beats and the fractions in between', () => {
    expect(beatsLabel(4)).toBe('4');
    expect(beatsLabel(1.5)).toBe('1½');
    expect(beatsLabel(0.5)).toBe('½');
    expect(beatsLabel(0.75)).toBe('¾');
    expect(beatsLabel(2.25)).toBe('2¼');
  });
});
