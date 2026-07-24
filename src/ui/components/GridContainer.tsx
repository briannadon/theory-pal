// The progression grid container: manages grid size controls (4/8/16),
// clear grid, holds the sortable slots via dnd-kit's SortableContext, and
// handles rendering slot states (chord name, roman numeral, accent).
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import {
  chordName,
  isDiatonic,
  romanNumeral,
  toAbsolute,
  type Key,
  type RelChord,
} from '../../theory/index.ts';
import { slotId, type GridSize, type GridState } from '../logic/grid.ts';
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
}

const SIZES: GridSize[] = [4, 8, 16];

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
}: GridContainerProps) {
  const slotIds = state.slots.map((_, i) => slotId(i));
  const hasChords = state.slots.some((s) => s !== null);

  return (
    <section className="tp-grid">
      <div className="tp-grid__header">
        <span className="tp-strip__eyebrow">Progression</span>
        <div className="tp-size-group" role="group" aria-label="Grid size">
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
      <div className="tp-grid__cells">
        <SortableContext items={slotIds} strategy={rectSortingStrategy}>
          {state.slots.map((chord, i) => {
            const id = slotId(i);
            const isPlaying = playingIndex === i;
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
                isPlaying={isPlaying}
                onAudition={() => {
                  if (chord !== null) onAuditionSlot(chord);
                }}
                onClear={() => onClearSlot(i)}
                keyValue={keyValue}
                onModifyChord={(next) => onModifySlot?.(i, next)}
                onHoverChange={(hovering) => onHoverSlot?.(hovering ? i : null)}
              />
            );
          })}
        </SortableContext>
      </div>
    </section>
  );
}
