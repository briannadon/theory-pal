// The melody editor: a piano-roll lane under the progression grid, colored by
// what each row means *against the chord in that bar* — chord tone brightest,
// other scale tones dim, off-scale nearly dark. That coloring is the point of
// the lane: it teaches where the safe notes are while you write, and it moves
// as the harmony moves.
//
// Hovering a bar (here, or its tile in the grid above) resolves the lane to
// that one chord: its tones light up in the chord accent, the key's other
// scale tones sit behind them in grey, and everything off-scale recedes —
// answering "what can I play over this chord?" in one glance instead of asking
// the eye to scan a single column.
//
// Gestures: drag on empty space draws a note as long as the drag; drag a note
// to move it, or its right edge to lengthen it. Deleting is deliberately
// modified — hold Alt and click a note, or Alt-drag a box over several —
// because an unmodified click that destroys work is too easy to fire by
// accident while sketching.
//
// Rendering: rows are absolutely-positioned bands whose background is a single
// left-to-right gradient with one stop per bar, rather than one element per
// cell. A 16-bar 1/16 lane is 256 columns; per-cell elements would be 6400
// nodes to mount and hit-test, while this is 25 gradients plus one element per
// actual note.
import { useCallback, useRef, useState } from 'react';
import {
  addMelodyNote,
  melodyPitchToMidi,
  melodyRowKind,
  MELODY_ROWS,
  noteName,
  type Key,
  type MelodyLane as MelodyLaneData,
  type MelodyNote,
  type RelChord,
} from '../../theory/index.ts';

export interface MelodyLaneProps {
  lane: MelodyLaneData;
  keyValue: Key;
  /** Chord per bar-slot, so each column knows what it is played against. */
  slots: readonly (RelChord | null)[];
  playingBar: number | null;
  /** Bar whose chord the lane is currently resolving to, from either this
   * component's own bar hover or a chord tile in the grid above. */
  hoveredBar: number | null;
  onHoverBar: (bar: number | null) => void;
  onChange: (lane: MelodyLaneData) => void;
  onAuditionPitch: (pitch: number) => void;
}

const ROW_H = 13;
const STEP_W = { 8: 18, 16: 11 } as const;
const RESIZE_GRIP_PX = 6;

interface Cell {
  step: number;
  pitch: number;
}

type Drag =
  | { kind: 'draw'; index: number; anchor: number }
  | { kind: 'move'; index: number; grabOffset: number }
  | { kind: 'resize'; index: number }
  | { kind: 'erase'; from: Cell; to: Cell }
  | null;

export function MelodyLane({
  lane,
  keyValue,
  slots,
  playingBar,
  hoveredBar,
  onHoverBar,
  onChange,
  onAuditionPitch,
}: MelodyLaneProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);

  const stepW = STEP_W[lane.stepsPerBar];
  const totalSteps = slots.length * lane.stepsPerBar;
  const width = totalSteps * stepW;
  const height = MELODY_ROWS * ROW_H;

  // Rows run high pitch at the top, so row 0 is the top of the lane.
  const pitchForRow = (row: number) => MELODY_ROWS - 1 - row;
  const rowForPitch = (pitch: number) => MELODY_ROWS - 1 - pitch;

  const hoveredChord = hoveredBar !== null ? (slots[hoveredBar] ?? null) : null;
  /** Which of the three hover tiers a row is in — chord tone, other scale
   * tone, or off-scale — as a class-name suffix shared by the lane rows and
   * the gutter keys, which use the same tiers under different block names. */
  const focusTier = (pitch: number): '' | 'lit' | 'scale' | 'dim' => {
    if (hoveredBar === null) return '';
    const kind = melodyRowKind(pitch, hoveredChord, keyValue);
    if (kind === 'chord') return 'lit';
    return kind === 'scale' ? 'scale' : 'dim';
  };
  const focusClass = (block: 'row' | 'key', pitch: number): string => {
    const tier = focusTier(pitch);
    return tier ? ` tp-lane__${block}--${tier}` : '';
  };

  const pointToCell = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const step = Math.floor((clientX - rect.left) / stepW);
      const row = Math.floor((clientY - rect.top) / ROW_H);
      if (step < 0 || step >= totalSteps || row < 0 || row >= MELODY_ROWS) return null;
      return { step, pitch: pitchForRow(row) };
    },
    [stepW, totalSteps],
  );

  const capture = (e: React.PointerEvent) => {
    surfaceRef.current?.setPointerCapture(e.pointerId);
  };

  const handleSurfacePointerDown = (e: React.PointerEvent) => {
    if (drag) return;
    const cell = pointToCell(e.clientX, e.clientY);
    if (!cell) return;
    capture(e);

    if (e.altKey) {
      // Alt-press starts an erase box. A press with no movement is a
      // one-cell box, which is how Alt-click deletes a single note.
      setDrag({ kind: 'erase', from: cell, to: cell });
      return;
    }

    const note: MelodyNote = { pitch: cell.pitch, start: cell.step, length: 1 };
    const next = addMelodyNote(lane, note); // monophonic: trims whatever it lands on
    onChange(next);
    // Keep dragging to set the note's length, rather than always writing the
    // shortest possible note and making the user resize it afterwards.
    setDrag({ kind: 'draw', index: next.notes.indexOf(note), anchor: cell.step });
    onAuditionPitch(cell.pitch);
  };

  const handleNotePointerDown = (e: React.PointerEvent, index: number, note: MelodyNote) => {
    // Alt is the erase modifier everywhere, so let it fall through to the
    // surface handler and start a box there instead of grabbing the note.
    if (e.altKey) return;
    e.stopPropagation();
    capture(e);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const onGrip = e.clientX >= rect.right - RESIZE_GRIP_PX;
    if (onGrip) {
      setDrag({ kind: 'resize', index });
      return;
    }
    const cell = pointToCell(e.clientX, e.clientY);
    setDrag({ kind: 'move', index, grabOffset: cell ? cell.step - note.start : 0 });
    onAuditionPitch(note.pitch);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const cell = pointToCell(e.clientX, e.clientY);

    if (!drag) {
      onHoverBar(cell ? Math.floor(cell.step / lane.stepsPerBar) : null);
      return;
    }
    if (drag.kind === 'erase') {
      if (cell && (cell.step !== drag.to.step || cell.pitch !== drag.to.pitch)) {
        setDrag({ ...drag, to: cell });
      }
      return;
    }
    if (!cell) return;

    const current = lane.notes[drag.index];
    if (!current) return;
    const notes = lane.notes.slice();

    if (drag.kind === 'move') {
      const start = Math.max(0, Math.min(totalSteps - current.length, cell.step - drag.grabOffset));
      if (start === current.start && cell.pitch === current.pitch) return;
      notes[drag.index] = { ...current, start, pitch: cell.pitch };
    } else {
      // draw and resize are the same operation from different anchors.
      const anchor = drag.kind === 'draw' ? drag.anchor : current.start;
      const length = Math.max(1, Math.min(totalSteps - anchor, cell.step - anchor + 1));
      if (length === current.length) return;
      notes[drag.index] = { ...current, length };
    }
    onChange({ ...lane, notes });
  };

  const handlePointerUp = () => {
    if (drag?.kind === 'erase') {
      const lowStep = Math.min(drag.from.step, drag.to.step);
      const highStep = Math.max(drag.from.step, drag.to.step);
      const lowPitch = Math.min(drag.from.pitch, drag.to.pitch);
      const highPitch = Math.max(drag.from.pitch, drag.to.pitch);
      // Any note the box touches goes, not just ones wholly inside it.
      onChange({
        ...lane,
        notes: lane.notes.filter(
          (n) =>
            !(
              n.pitch >= lowPitch &&
              n.pitch <= highPitch &&
              n.start <= highStep &&
              n.start + n.length - 1 >= lowStep
            ),
        ),
      });
    }
    setDrag(null);
  };

  /** One row's background: a stop per bar, colored by that bar's chord. */
  const rowGradient = (pitch: number): string => {
    const stops: string[] = [];
    slots.forEach((chord, bar) => {
      const kind = melodyRowKind(pitch, chord, keyValue);
      const color =
        kind === 'chord'
          ? 'var(--lane-chord)'
          : kind === 'scale'
            ? 'var(--lane-scale)'
            : 'var(--lane-off)';
      const from = (bar / slots.length) * 100;
      const to = ((bar + 1) / slots.length) * 100;
      stops.push(`${color} ${from}% ${to}%`);
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  };

  const rowLabel = (pitch: number): string => {
    const midi = melodyPitchToMidi(pitch, keyValue);
    return `${noteName(midi % 12, 'maj')}${Math.floor(midi / 12) - 1}`;
  };

  const eraseBox =
    drag?.kind === 'erase'
      ? {
          left: Math.min(drag.from.step, drag.to.step) * stepW,
          width: (Math.abs(drag.to.step - drag.from.step) + 1) * stepW,
          top: rowForPitch(Math.max(drag.from.pitch, drag.to.pitch)) * ROW_H,
          height: (Math.abs(drag.to.pitch - drag.from.pitch) + 1) * ROW_H,
        }
      : null;

  return (
    <div className="tp-lane" onPointerLeave={() => onHoverBar(null)}>
      <div className="tp-lane__gutter" style={{ height }}>
        {Array.from({ length: MELODY_ROWS }, (_, row) => {
          const pitch = pitchForRow(row);
          return (
            <button
              key={row}
              type="button"
              className={`tp-lane__key${pitch % 12 === 0 ? ' tp-lane__key--tonic' : ''}${focusClass('key', pitch)}`}
              style={{ height: ROW_H }}
              onClick={() => onAuditionPitch(pitch)}
              tabIndex={-1}
              aria-label={`Hear ${rowLabel(pitch)}`}
            >
              {rowLabel(pitch)}
            </button>
          );
        })}
      </div>

      <div className="tp-lane__scroll">
        <div
          className={`tp-lane__surface${drag?.kind === 'erase' ? ' tp-lane__surface--erasing' : ''}`}
          ref={surfaceRef}
          style={{ width, height }}
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {Array.from({ length: MELODY_ROWS }, (_, row) => {
            const pitch = pitchForRow(row);
            return (
              <div
                key={row}
                className={`tp-lane__row${pitch % 12 === 0 ? ' tp-lane__row--tonic' : ''}${focusClass('row', pitch)}`}
                style={{ top: row * ROW_H, height: ROW_H, background: rowGradient(pitch) }}
              />
            );
          })}

          {slots.map((_, bar) => (
            <div
              key={`bar-${bar}`}
              className={`tp-lane__barline${playingBar === bar ? ' tp-lane__barline--playing' : ''}${
                hoveredBar === bar ? ' tp-lane__barline--hovered' : ''
              }`}
              style={{ left: bar * lane.stepsPerBar * stepW, width: lane.stepsPerBar * stepW }}
            />
          ))}

          {lane.notes.map((note, i) => (
            <div
              key={`${note.start}-${note.pitch}-${i}`}
              className={`tp-lane__note${drag && 'index' in drag && drag.index === i ? ' tp-lane__note--active' : ''}`}
              style={{
                left: note.start * stepW,
                width: Math.max(1, note.length) * stepW - 1,
                top: rowForPitch(note.pitch) * ROW_H,
                height: ROW_H - 1,
              }}
              onPointerDown={(e) => handleNotePointerDown(e, i, note)}
              title={`${rowLabel(note.pitch)} · drag to move, drag the right edge to lengthen, alt-click to delete`}
            />
          ))}

          {eraseBox && <div className="tp-lane__erase-box" style={eraseBox} />}
        </div>
      </div>
    </div>
  );
}
