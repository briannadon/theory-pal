// The progression grid container: grid size (4/8/16 bars), the snap division
// chord edges land on, clear-grid, and the sortable slots themselves.
//
// The grid is a *timeline*, not a row of equal cells: each tile is as wide as
// the chord is long, so a bar of 3 + 1 looks like a bar of 3 + 1. Bar lines
// are drawn behind the tiles (every four beats) because the tiles themselves
// no longer mark them — that is the whole point of letting a chord be any
// length, including one that runs across a barline.
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { useEffect, useState } from 'react';
import {
  chordName,
  isDiatonic,
  romanNumeral,
  toAbsolute,
  type Key,
  type RelChord,
} from '../../theory/index.ts';
import {
  BEATS_PER_BAR,
  DIVISIONS,
  slotId,
  slotIndexEndingAt,
  slotStarts,
  totalBeats,
  type Division,
  type GridSize,
  type GridState,
} from '../logic/grid.ts';
import type { ChordAccent } from './ChordFace.tsx';
import { GridSlot } from './GridSlot.tsx';

export interface GridContainerProps {
  state: GridState;
  keyValue: Key;
  playingIndex: number | null;
  onSetSize: (size: GridSize) => void;
  onClearGrid: () => void;
  onAuditionSlot: (chord: RelChord) => void;
  onClearSlot: (index: number) => void;
  onModifySlot?: (index: number, chord: RelChord) => void;
  onDuplicateSlot?: (index: number) => void;
  onHoverSlot?: (index: number | null) => void;
  onResizeSlot?: (index: number, beats: number) => void;
  onSetSlotStart?: (index: number, start: number) => void;
  /** What a dragged chord edge snaps to. */
  division: Division;
  onDivisionChange: (division: Division) => void;
  /** Pixels per beat. Shared with the melody lane so a chord tile sits over
   * exactly the melody steps it sounds against. */
  beatWidth: number;
  /** The empty slot a click has selected, and the one the suggestion strip is
   * currently ranking for. See GridSlot for why they are two states. */
  selectedSlot?: number | null;
  targetSlot?: number | null;
  onSelectSlot?: (index: number | null) => void;
  onTargetSlot?: (index: number | null) => void;
}

const SIZES: GridSize[] = [4, 8, 16];
const DIVISION_LABELS: Record<Division, string> = { 1: '1/4', 0.5: '1/8', 0.25: '1/16' };

export function GridContainer({
  state,
  keyValue,
  playingIndex,
  onSetSize,
  onClearGrid,
  onAuditionSlot,
  onClearSlot,
  onModifySlot,
  onDuplicateSlot,
  onHoverSlot,
  onResizeSlot,
  onSetSlotStart,
  division,
  onDivisionChange,
  beatWidth,
  selectedSlot = null,
  targetSlot = null,
  onSelectSlot,
  onTargetSlot,
}: GridContainerProps) {
  const slotIds = state.slots.map((_, i) => slotId(i));
  const hasChords = state.slots.some((s) => s.chord !== null);
  const starts = slotStarts(state);
  const beats = totalBeats(state);
  const width = beats * beatWidth;

  // A left-edge drag, tracked here rather than in the tile that started it:
  // moving that edge earlier splices out the slots it swallows, which renumbers
  // every tile after them, and slot keys are positional — the tile under the
  // pointer is unmounted exactly when the gap closes. The grid stays. What the
  // drag holds onto is the edge that is *not* moving, the chord's end, so the
  // slot can be found again after each re-cut.
  const [edgeDrag, setEdgeDrag] = useState<{ end: number; start: number; x: number } | null>(null);

  useEffect(() => {
    if (!edgeDrag || !onSetSlotStart) return;
    const onMove = (e: PointerEvent) => {
      const index = slotIndexEndingAt(state, edgeDrag.end);
      if (index < 0) return;
      const raw = edgeDrag.start + (e.clientX - edgeDrag.x) / beatWidth;
      const snapped = Math.max(0, Math.round(raw / division) * division);
      if (snapped !== slotStarts(state)[index]) onSetSlotStart(index, snapped);
    };
    const onUp = () => setEdgeDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [edgeDrag, state, beatWidth, division, onSetSlotStart]);

  return (
    <section className="tp-grid">
      <div className="tp-grid__header">
        <span className="tp-strip__eyebrow">Progression</span>
        <div className="tp-size-group" role="group" aria-label="Grid size in bars">
          {SIZES.map((sz) => (
            <button
              key={sz}
              type="button"
              className="tp-size-btn"
              aria-pressed={state.size === sz}
              onClick={() => onSetSize(sz)}
            >
              {sz}
            </button>
          ))}
        </div>
        <div className="tp-size-group" role="group" aria-label="Chord length snap">
          {DIVISIONS.map((d) => (
            <button
              key={d}
              type="button"
              className="tp-size-btn"
              aria-pressed={division === d}
              onClick={() => onDivisionChange(d)}
            >
              {DIVISION_LABELS[d]}
            </button>
          ))}
        </div>
        <span className="tp-strip__hint">
          drag a tile’s right edge to set how long its chord lasts, its left edge to move where
          it starts
        </span>
        <button
          type="button"
          className="tp-btn"
          onClick={onClearGrid}
          disabled={!hasChords}
          style={{ marginLeft: 'auto' }}
        >
          Clear
        </button>
      </div>

      <div className="tp-grid__scroll">
        <div className="tp-grid__track" style={{ width }}>
          <div className="tp-grid__ruler">
            {Array.from({ length: state.size }, (_, bar) => (
              <span
                key={bar}
                className="tp-grid__bar-number"
                style={{ left: bar * BEATS_PER_BAR * beatWidth, width: BEATS_PER_BAR * beatWidth }}
              >
                {bar + 1}
              </span>
            ))}
          </div>

          <div
            className="tp-grid__cells"
            style={
              {
                '--beat-w': `${beatWidth}px`,
                '--bar-w': `${beatWidth * BEATS_PER_BAR}px`,
              } as React.CSSProperties
            }
          >
            <SortableContext items={slotIds} strategy={horizontalListSortingStrategy}>
              {state.slots.map((slot, i) => {
                const id = slotId(i);
                const chord = slot.chord;
                let roman: string | undefined;
                let name: string | undefined;
                let accent: ChordAccent = 'empty';

                if (chord !== null) {
                  roman = romanNumeral(chord, keyValue);
                  name = chordName(toAbsolute(chord, keyValue));
                  accent = isDiatonic(chord, keyValue) ? 'diatonic' : 'borrowed';
                }

                return (
                  <GridSlot
                    key={id}
                    id={id}
                    index={i}
                    chord={chord}
                    roman={roman}
                    name={name}
                    accent={accent}
                    isPlaying={playingIndex === i}
                    onAudition={() => {
                      if (chord !== null) onAuditionSlot(chord);
                    }}
                    onClear={() => onClearSlot(i)}
                    keyValue={keyValue}
                    onModifyChord={(next) => onModifySlot?.(i, next)}
                    onDuplicate={onDuplicateSlot ? () => onDuplicateSlot(i) : undefined}
                    // Where the copy goes, decided here because only the grid
                    // can see the slot next door (see `duplicateSlot`).
                    duplicateMode={
                      state.slots[i + 1] && state.slots[i + 1].chord === null ? 'gap' : 'split'
                    }
                    onHoverChange={(hovering) => onHoverSlot?.(hovering ? i : null)}
                    start={starts[i]}
                    beats={slot.beats}
                    beatWidth={beatWidth}
                    division={division}
                    onResize={onResizeSlot ? (next) => onResizeSlot(i, next) : undefined}
                    onSetStart={onSetSlotStart ? (next) => onSetSlotStart(i, next) : undefined}
                    isSelected={selectedSlot === i}
                    isTargeted={targetSlot === i}
                    onSelect={
                      onSelectSlot ? () => onSelectSlot(selectedSlot === i ? null : i) : undefined
                    }
                    onSuggestHere={onTargetSlot ? () => onTargetSlot(i) : undefined}
                    onStartEdgeDrag={
                      onSetSlotStart
                        ? (clientX) =>
                            setEdgeDrag({
                              end: starts[i] + slot.beats,
                              start: starts[i],
                              x: clientX,
                            })
                        : undefined
                    }
                  />
                );
              })}
            </SortableContext>
          </div>
        </div>
      </div>
    </section>
  );
}
