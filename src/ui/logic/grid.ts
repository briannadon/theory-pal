// Pure progression-grid state helpers. No React, no DOM — the grid is plain
// data; components only render it and dispatch these transitions. This is
// "no music theory logic in components" applied one level further: even the
// *structural* grid bookkeeping (resize/set/clear/reorder) lives outside any
// component, leaving components to wire user gestures to these functions and
// render the result.
//
// A slot is a *span of time*, not a bar. Each carries its own `beats`, so a
// bar can hold a 3-beat chord followed by a 1-beat one, and a chord can also
// run across a barline. The one invariant every operation here preserves is
// that the slots always sum to exactly `size * BEATS_PER_BAR`: the timeline is
// a fixed length that chords partition, never a free-floating sequence whose
// total drifts as you edit. That invariant is what lets the melody lane keep
// its own bar grid — notes written over bar 3 stay over bar 3 no matter how
// the chords above them are re-cut.
import { arrayMove } from '@dnd-kit/sortable';
import type { RelChord } from '../../theory/index.ts';

export type GridSize = 4 | 8 | 16;
export const GRID_SIZES: readonly GridSize[] = [4, 8, 16];

export const BEATS_PER_BAR = 4;

/** Rhythmic divisions a slot edge can land on, in beats: quarter, eighth,
 * sixteenth. The finest is also the shortest a slot may be. */
export type Division = 1 | 0.5 | 0.25;
export const DIVISIONS: readonly Division[] = [1, 0.5, 0.25];
export const MIN_SLOT_BEATS = 0.25;

export interface Slot {
  chord: RelChord | null;
  /** Length in beats; a multiple of MIN_SLOT_BEATS. */
  beats: number;
}

export interface GridState {
  size: GridSize;
  slots: Slot[];
}

/** Beat values are eighths and sixteenths, so they are exact in binary and
 * comparisons are safe — but sums of many of them still deserve rounding to
 * the grid unit before they are compared or stored. */
function quantize(beats: number): number {
  return Math.round(beats / MIN_SLOT_BEATS) * MIN_SLOT_BEATS;
}

export function emptySlot(beats: number = BEATS_PER_BAR): Slot {
  return { chord: null, beats };
}

export function createGrid(size: GridSize): GridState {
  return { size, slots: Array.from({ length: size }, () => emptySlot()) };
}

/** Total length of the timeline in beats — `size` bars of 4/4, always. */
export function totalBeats(state: GridState): number {
  return state.size * BEATS_PER_BAR;
}

/** Where each slot begins, in beats from the start of the progression. */
export function slotStarts(state: GridState): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const slot of state.slots) {
    starts.push(at);
    at += slot.beats;
  }
  return starts;
}

/** The index of the slot sounding at `beat`, or -1 past the end. */
export function slotIndexAtBeat(state: GridState, beat: number): number {
  let at = 0;
  for (let i = 0; i < state.slots.length; i++) {
    at += state.slots[i].beats;
    if (beat < at) return i;
  }
  return -1;
}

/** The chord sounding at `beat` — what the melody lane and its generator ask
 * when they need to know what a given moment is played against. */
export function chordAtBeat(state: GridState, beat: number): RelChord | null {
  const i = slotIndexAtBeat(state, beat);
  return i < 0 ? null : state.slots[i].chord;
}

/** Change grid size, preserving the chords that still fit. Truncating cuts the
 * timeline at the new length (a slot straddling the cut is shortened rather
 * than dropped); growing appends whole empty bars. */
export function resizeGrid(state: GridState, size: GridSize): GridState {
  const limit = size * BEATS_PER_BAR;
  const slots: Slot[] = [];
  let at = 0;
  for (const slot of state.slots) {
    if (at >= limit) break;
    const beats = Math.min(slot.beats, limit - at);
    slots.push({ ...slot, beats });
    at += beats;
  }
  while (at < limit) {
    const beats = Math.min(BEATS_PER_BAR, limit - at);
    slots.push(emptySlot(beats));
    at += beats;
  }
  return { size, slots };
}

export function setSlot(state: GridState, index: number, chord: RelChord | null): GridState {
  if (index < 0 || index >= state.slots.length) return state;
  const slots = state.slots.slice();
  slots[index] = { ...slots[index], chord };
  return { ...state, slots };
}

export function clearSlot(state: GridState, index: number): GridState {
  return setSlot(state, index, null);
}

/**
 * Set slot `index` to `beats`, taking the difference from — or handing it
 * back to — what follows, so the timeline stays exactly `size` bars long.
 *
 * Shrinking leaves the freed time as empty space right after the slot
 * (extending the next slot if it is already empty, so repeated dragging
 * doesn't shed a trail of slivers). Growing eats into the slots after it in
 * order, dropping any it consumes entirely — the neighbor gives way, which is
 * what dragging an edge into it looks like it should do. Growth is capped at
 * the end of the timeline.
 */
export function resizeSlot(state: GridState, index: number, beats: number): GridState {
  if (index < 0 || index >= state.slots.length) return state;
  const slots = state.slots.slice();
  const current = slots[index];

  const after = slots.slice(index + 1).reduce((sum, s) => sum + s.beats, 0);
  const target = Math.max(MIN_SLOT_BEATS, Math.min(quantize(beats), current.beats + after));
  const delta = quantize(target - current.beats);
  if (delta === 0) return state;

  slots[index] = { ...current, beats: target };

  if (delta < 0) {
    const freed = -delta;
    const next = slots[index + 1];
    if (next && next.chord === null) slots[index + 1] = { ...next, beats: next.beats + freed };
    else slots.splice(index + 1, 0, emptySlot(freed));
    return { ...state, slots };
  }

  let owed = delta;
  let i = index + 1;
  while (owed > 0 && i < slots.length) {
    const taken = Math.min(owed, slots[i].beats);
    const left = quantize(slots[i].beats - taken);
    owed = quantize(owed - taken);
    if (left === 0) slots.splice(i, 1);
    else {
      slots[i] = { ...slots[i], beats: left };
      i++;
    }
  }
  return { ...state, slots };
}

/**
 * Drop a chord into a slot, capping how much of a long empty span it takes:
 * a chord dragged onto eight beats of empty space becomes one bar of chord
 * and four beats of space, not an eight-beat chord nobody asked for. What is
 * left over stays empty and droppable. Filled slots keep their length — that
 * is the user's own edit, and replacing a chord shouldn't re-cut the bar.
 */
export function placeChord(
  state: GridState,
  index: number,
  chord: RelChord,
  maxBeats: number = BEATS_PER_BAR,
): GridState {
  if (index < 0 || index >= state.slots.length) return state;
  const slot = state.slots[index];
  const capped = slot.chord === null && slot.beats > maxBeats;
  return setSlot(capped ? splitSlot(state, index, maxBeats) : state, index, chord);
}

/** Split a slot in two at `beats` from its start, leaving the remainder empty.
 * Not currently wired to a gesture, but it is the operation a double-click or
 * a "split" key would run, and resizeSlot's shrink path is defined in terms of
 * the same idea. */
export function splitSlot(state: GridState, index: number, beats: number): GridState {
  if (index < 0 || index >= state.slots.length) return state;
  const slot = state.slots[index];
  const at = quantize(beats);
  if (at < MIN_SLOT_BEATS || at > slot.beats - MIN_SLOT_BEATS) return state;
  const slots = state.slots.slice();
  slots.splice(index, 1, { ...slot, beats: at }, emptySlot(slot.beats - at));
  return { ...state, slots };
}

/** Reorder within the grid (drag-and-drop "sortable" move): the slot at
 * `from` moves to `to`, shifting the slots in between — dnd-kit's own
 * `arrayMove` semantics — rather than swapping the two. Durations travel with
 * their chord, so a move re-cuts the timeline but never changes its length.
 * No-op for out-of-range or identical indices. */
export function reorderGrid(state: GridState, from: number, to: number): GridState {
  if (from < 0 || from >= state.slots.length || to < 0 || to >= state.slots.length || from === to) {
    return state;
  }
  return { ...state, slots: arrayMove(state.slots, from, to) };
}

export function slotId(index: number): string {
  return `slot-${index}`;
}

/** Inverse of `slotId`; `null` if `id` isn't a grid-slot id (e.g. a strip
 * cell's drag id, which uses a different prefix). */
export function parseSlotIndex(id: string): number | null {
  const m = /^slot-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** How a slot's length reads in the header of its tile: whole beats plainly,
 * fractions as the note they are ("1½", "¾"). */
export function beatsLabel(beats: number): string {
  const whole = Math.floor(beats);
  const rest = quantize(beats - whole);
  const frac = rest === 0.25 ? '¼' : rest === 0.5 ? '½' : rest === 0.75 ? '¾' : '';
  if (whole === 0) return frac;
  return `${whole}${frac}`;
}
