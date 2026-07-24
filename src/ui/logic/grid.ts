// Pure progression-grid state helpers. No React, no DOM — the grid is plain
// data; components only render it and dispatch these transitions. This is
// "no music theory logic in components" applied one level further: even the
// *structural* grid bookkeeping (resize/set/clear/reorder) lives outside any
// component, leaving components to wire user gestures to these functions and
// render the result.
import { arrayMove } from '@dnd-kit/sortable';
import type { RelChord } from '../../theory/index.ts';

export type GridSize = 4 | 8 | 16;
export const GRID_SIZES: readonly GridSize[] = [4, 8, 16];

export interface GridState {
  size: GridSize;
  slots: (RelChord | null)[];
}

export function createGrid(size: GridSize): GridState {
  return { size, slots: new Array(size).fill(null) };
}

/** Change grid size, preserving existing chords at their slot positions —
 * truncated if shrinking, padded with empty slots if growing. */
export function resizeGrid(state: GridState, size: GridSize): GridState {
  const slots: (RelChord | null)[] = new Array(size).fill(null);
  for (let i = 0; i < Math.min(size, state.slots.length); i++) slots[i] = state.slots[i];
  return { size, slots };
}

export function setSlot(state: GridState, index: number, chord: RelChord | null): GridState {
  if (index < 0 || index >= state.slots.length) return state;
  const slots = state.slots.slice();
  slots[index] = chord;
  return { ...state, slots };
}

export function clearSlot(state: GridState, index: number): GridState {
  return setSlot(state, index, null);
}

/** Reorder within the grid (drag-and-drop "sortable" move): the chord at
 * `from` moves to `to`, shifting the slots in between — dnd-kit's own
 * `arrayMove` semantics — rather than swapping the two. No-op for
 * out-of-range or identical indices. */
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
