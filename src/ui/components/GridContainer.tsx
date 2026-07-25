// The progression grid container: grid size (4/8/16 bars), the snap division
// chord edges land on, clear-grid, and the sortable slots themselves.
//
// The grid is a *timeline*, not a row of equal cells: each tile is as wide as
// the chord is long, so a bar of 3 + 1 looks like a bar of 3 + 1. Bar lines
// are drawn behind the tiles (every four beats) because the tiles themselves
// no longer mark them — that is the whole point of letting a chord be any
// length, including one that runs across a barline.
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
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
  onHoverSlot?: (index: number | null) => void;
  onResizeSlot?: (index: number, beats: number) => void;
  /** What a dragged chord edge snaps to. */
  division: Division;
  onDivisionChange: (division: Division) => void;
  /** Pixels per beat. Shared with the melody lane so a chord tile sits over
   * exactly the melody steps it sounds against. */
  beatWidth: number;
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
  onHoverSlot,
  onResizeSlot,
  division,
  onDivisionChange,
  beatWidth,
}: GridContainerProps) {
  const slotIds = state.slots.map((_, i) => slotId(i));
  const hasChords = state.slots.some((s) => s.chord !== null);
  const starts = slotStarts(state);
  const beats = totalBeats(state);
  const width = beats * beatWidth;

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
        <span className="tp-strip__hint">drag a tile’s right edge to set how long its chord lasts</span>
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
                    onHoverChange={(hovering) => onHoverSlot?.(hovering ? i : null)}
                    start={starts[i]}
                    beats={slot.beats}
                    beatWidth={beatWidth}
                    division={division}
                    onResize={onResizeSlot ? (next) => onResizeSlot(i, next) : undefined}
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
