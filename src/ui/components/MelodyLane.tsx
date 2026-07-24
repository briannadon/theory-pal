// The melody editor: a piano-roll lane under the progression grid, colored by
// what each row means *against the chord in that bar* — chord tone brightest,
// other scale tones dim, off-scale nearly dark. That coloring is the point of
// the lane: it teaches where the safe notes are while you write, and it moves
// as the harmony moves.
//
// Hovering a bar (here, or its tile in the grid above) resolves the lane to
// that one chord: its tones light up across the full width and everything else
// recedes, answering "what can I play over this chord?" in one glance instead
// of asking the eye to scan a single column.
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

type DragMode = { kind: 'move'; index: number } | { kind: 'resize'; index: number } | null;

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
  const [drag, setDrag] = useState<DragMode>(null);
  const movedRef = useRef(false);

  const stepW = STEP_W[lane.stepsPerBar];
  const totalSteps = slots.length * lane.stepsPerBar;
  const width = totalSteps * stepW;
  const height = MELODY_ROWS * ROW_H;

  // Rows run high pitch at the top, so row 0 is the top of the lane.
  const pitchForRow = (row: number) => MELODY_ROWS - 1 - row;

  const hoveredChord = hoveredBar !== null ? (slots[hoveredBar] ?? null) : null;
  const rowFocus = (pitch: number): '' | ' tp-lane__row--lit' | ' tp-lane__row--dim' => {
    if (hoveredBar === null) return '';
    return melodyRowKind(pitch, hoveredChord, keyValue) === 'chord'
      ? ' tp-lane__row--lit'
      : ' tp-lane__row--dim';
  };

  const pointToCell = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const step = Math.floor((clientX - rect.left) / stepW);
      const row = Math.floor((clientY - rect.top) / ROW_H);
      if (step < 0 || step >= totalSteps || row < 0 || row >= MELODY_ROWS) return null;
      return { step, pitch: pitchForRow(row) };
    },
    [stepW, totalSteps],
  );

  const handleSurfacePointerDown = (e: React.PointerEvent) => {
    if (drag) return;
    const cell = pointToCell(e.clientX, e.clientY);
    if (!cell) return;
    const note: MelodyNote = { pitch: cell.pitch, start: cell.step, length: 1 };
    onChange(addMelodyNote(lane, note)); // monophonic: trims whatever it lands on
    onAuditionPitch(cell.pitch);
  };

  const handleNotePointerDown = (e: React.PointerEvent, index: number, note: MelodyNote) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const onGrip = e.clientX >= rect.right - RESIZE_GRIP_PX;
    movedRef.current = false;
    setDrag({ kind: onGrip ? 'resize' : 'move', index });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (!onGrip) onAuditionPitch(note.pitch);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const cell = pointToCell(e.clientX, e.clientY);

    if (!drag) {
      onHoverBar(cell ? Math.floor(cell.step / lane.stepsPerBar) : null);
      return;
    }
    if (!cell) return;
    const current = lane.notes[drag.index];
    if (!current) return;

    if (drag.kind === 'move') {
      if (cell.step === current.start && cell.pitch === current.pitch) return;
      movedRef.current = true;
      const notes = lane.notes.slice();
      notes[drag.index] = { ...current, start: cell.step, pitch: cell.pitch };
      onChange({ ...lane, notes });
    } else {
      const length = Math.max(1, cell.step - current.start + 1);
      if (length === current.length) return;
      movedRef.current = true;
      const notes = lane.notes.slice();
      notes[drag.index] = { ...current, length };
      onChange({ ...lane, notes });
    }
  };

  // A press-and-release on a note without moving it deletes it — the lane's
  // only destructive gesture, and the inverse of click-empty-space-to-add.
  const handlePointerUp = () => {
    if (drag && !movedRef.current) {
      onChange({ ...lane, notes: lane.notes.filter((_, i) => i !== drag.index) });
    }
    setDrag(null);
    movedRef.current = false;
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

  return (
    <div className="tp-lane" onPointerLeave={() => onHoverBar(null)}>
      <div className="tp-lane__gutter" style={{ height }}>
        {Array.from({ length: MELODY_ROWS }, (_, row) => {
          const pitch = pitchForRow(row);
          return (
            <button
              key={row}
              type="button"
              className={`tp-lane__key${pitch % 12 === 0 ? ' tp-lane__key--tonic' : ''}${rowFocus(pitch)}`}
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
          className="tp-lane__surface"
          ref={surfaceRef}
          style={{ width, height }}
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {Array.from({ length: MELODY_ROWS }, (_, row) => {
            const pitch = pitchForRow(row);
            return (
              <div
                key={row}
                className={`tp-lane__row${pitch % 12 === 0 ? ' tp-lane__row--tonic' : ''}${rowFocus(pitch)}`}
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
              className={`tp-lane__note${drag?.index === i ? ' tp-lane__note--active' : ''}`}
              style={{
                left: note.start * stepW,
                width: Math.max(1, note.length) * stepW - 1,
                top: (MELODY_ROWS - 1 - note.pitch) * ROW_H,
                height: ROW_H - 1,
              }}
              onPointerDown={(e) => handleNotePointerDown(e, i, note)}
              title={`${rowLabel(note.pitch)} · drag to move, drag the right edge to lengthen, click to delete`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
