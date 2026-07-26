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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** One chord slot on the timeline: what it is and when it sounds. Chords have
 * their own lengths, so the lane can no longer assume one per bar — it asks
 * which *slot* covers a given moment instead. */
export interface LaneSegment {
  chord: RelChord | null;
  /** Beats from the start of the progression. */
  start: number;
  beats: number;
}

export interface MelodyLaneProps {
  lane: MelodyLaneData;
  keyValue: Key;
  /** The chord timeline, so each column knows what it is played against. */
  segments: readonly LaneSegment[];
  /** Bars in the progression; the lane's own grid stays even regardless of
   * how the chords above it are cut. */
  bars: number;
  playingSlot: number | null;
  /** Slot whose chord the lane is currently resolving to, from either this
   * component's own hover or a chord tile in the grid above. */
  hoveredSlot: number | null;
  onHoverSlot: (slot: number | null) => void;
  onChange: (lane: MelodyLaneData) => void;
  onAuditionPitch: (pitch: number) => void;
  /** Pixels per beat, shared with the progression grid so a chord tile sits
   * directly over the melody steps it sounds against. */
  beatWidth: number;
  /** Touch's stand-in for the alt-drag erase marquee: a phone has no alt
   * key, so a section-header toggle puts the lane into the same erase-box
   * gesture that alt normally arms. Alt still works on desktop regardless. */
  eraseMode?: boolean;
}

const ROW_H = 13;
/** Row height on a coarse (touch) pointer. Pitch, unlike the step axis, isn't
 * shared with the chord grid, so it's free to grow for fatter fingers without
 * desyncing anything. */
const ROW_H_COARSE = 20;
const BEATS_PER_BAR = 4;
const RESIZE_GRIP_PX = 6;
const RESIZE_GRIP_PX_COARSE = 14;
/** How far a touch can drift from its start and still count as a tap rather
 * than the start of a page/lane swipe. */
const TAP_SLOP_PX = 10;

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

/** Tracks (pointer: coarse) live rather than reading it once, since a
 * detachable touchscreen/mouse combo can flip it mid-session. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

export function MelodyLane({
  lane,
  keyValue,
  segments,
  bars,
  playingSlot,
  hoveredSlot,
  onHoverSlot,
  onChange,
  onAuditionPitch,
  beatWidth,
  eraseMode = false,
}: MelodyLaneProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  // A touch that hasn't moved past the slop threshold yet: note creation is
  // deferred until pointerup confirms it was a tap and not the start of a
  // swipe, so a plain finger drag over empty cells scrolls instead of
  // drawing (see the surface's touch-action, set below).
  const pendingTapRef = useRef<{ cell: Cell; x: number; y: number } | null>(null);

  const isCoarsePointer = useCoarsePointer();
  const rowH = isCoarsePointer ? ROW_H_COARSE : ROW_H;
  const resizeGripPx = isCoarsePointer ? RESIZE_GRIP_PX_COARSE : RESIZE_GRIP_PX;

  const beatsPerStep = BEATS_PER_BAR / lane.stepsPerBar;
  const stepW = beatWidth * beatsPerStep;
  const totalSteps = bars * lane.stepsPerBar;
  const totalBeats = bars * BEATS_PER_BAR;
  const width = totalSteps * stepW;
  const height = MELODY_ROWS * rowH;

  // Zooming from the toolbar would otherwise leave scrollLeft where it was,
  // which lands the user somewhere else in the tune: at 3x, the bar that was
  // on screen is now a third of the way into a lane three times as long. Hold
  // the centered moment still instead. Width is bars * 4 * beatWidth, so
  // beatWidth alone says how the scale moved (changing resolution rescales
  // steps but not the lane).
  const prevBeatWidthRef = useRef(beatWidth);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevBeatWidthRef.current;
    prevBeatWidthRef.current = beatWidth;
    if (!el || prev === beatWidth || prev <= 0) return;
    const centered = el.scrollLeft + el.clientWidth / 2;
    el.scrollLeft = (centered / prev) * beatWidth - el.clientWidth / 2;
  }, [beatWidth]);

  /** Which slot is sounding at a beat — the lane's link between its own even
   * grid and the uneven chord timeline above it. */
  const slotAtBeat = (beat: number): number | null => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (beat >= segments[i].start - 1e-9) return i;
    }
    return null;
  };

  // Rows run high pitch at the top, so row 0 is the top of the lane.
  const pitchForRow = (row: number) => MELODY_ROWS - 1 - row;
  const rowForPitch = (pitch: number) => MELODY_ROWS - 1 - pitch;

  const hoveredChord = hoveredSlot !== null ? (segments[hoveredSlot]?.chord ?? null) : null;
  /** Which of the three hover tiers a row is in — chord tone, other scale
   * tone, or off-scale — as a class-name suffix shared by the lane rows and
   * the gutter keys, which use the same tiers under different block names. */
  const focusTier = (pitch: number): '' | 'lit' | 'scale' | 'dim' => {
    if (hoveredSlot === null) return '';
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
      const row = Math.floor((clientY - rect.top) / rowH);
      if (step < 0 || step >= totalSteps || row < 0 || row >= MELODY_ROWS) return null;
      return { step, pitch: pitchForRow(row) };
    },
    [stepW, totalSteps, rowH],
  );

  const capture = (e: React.PointerEvent) => {
    surfaceRef.current?.setPointerCapture(e.pointerId);
  };

  const handleSurfacePointerDown = (e: React.PointerEvent) => {
    if (drag) return;
    const cell = pointToCell(e.clientX, e.clientY);
    if (!cell) return;

    if (e.altKey || eraseMode) {
      // Alt-press (or the touch erase-mode toggle) starts an erase box. A
      // press with no movement is a one-cell box, which is how Alt-click /
      // an erase-mode tap deletes a single note.
      capture(e);
      setDrag({ kind: 'erase', from: cell, to: cell });
      return;
    }

    if (e.pointerType === 'touch') {
      // Defer note creation until pointerup confirms this was a tap, not a
      // swipe. The surface's touch-action lets a real drag scroll natively
      // instead of reaching this handler at all in most cases; this is the
      // fallback for drags too small for the browser to treat as a pan.
      pendingTapRef.current = { cell, x: e.clientX, y: e.clientY };
      return;
    }

    capture(e);
    const note: MelodyNote = { pitch: cell.pitch, start: cell.step, length: 1 };
    const next = addMelodyNote(lane, note); // monophonic: trims whatever it lands on
    onChange(next);
    // Keep dragging to set the note's length, rather than always writing the
    // shortest possible note and making the user resize it afterwards.
    setDrag({ kind: 'draw', index: next.notes.indexOf(note), anchor: cell.step });
    onAuditionPitch(cell.pitch);
  };

  const handleNotePointerDown = (e: React.PointerEvent, index: number, note: MelodyNote) => {
    // Alt (or touch erase mode) is the erase modifier everywhere, so let it
    // fall through to the surface handler and start a box there instead of
    // grabbing the note.
    if (e.altKey || eraseMode) return;
    e.stopPropagation();
    capture(e);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const onGrip = e.clientX >= rect.right - resizeGripPx;
    if (onGrip) {
      setDrag({ kind: 'resize', index });
      return;
    }
    const cell = pointToCell(e.clientX, e.clientY);
    setDrag({ kind: 'move', index, grabOffset: cell ? cell.step - note.start : 0 });
    onAuditionPitch(note.pitch);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pendingTapRef.current) {
      const { x, y } = pendingTapRef.current;
      if (Math.abs(e.clientX - x) > TAP_SLOP_PX || Math.abs(e.clientY - y) > TAP_SLOP_PX) {
        // Past the slop: this is a swipe, not a tap. Drop it and let the
        // browser's native pan (or the user's own further motion) own it.
        pendingTapRef.current = null;
      }
    }

    const cell = pointToCell(e.clientX, e.clientY);

    if (!drag) {
      onHoverSlot(cell ? slotAtBeat(cell.step * beatsPerStep) : null);
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

  const handlePointerUp = (e: React.PointerEvent) => {
    if (pendingTapRef.current) {
      const pending = pendingTapRef.current;
      pendingTapRef.current = null;
      // Only a genuine pointerup confirms a tap; a cancel means the browser
      // took the gesture over as a scroll, so nothing should be written.
      if (e.type === 'pointerup') {
        const note: MelodyNote = { pitch: pending.cell.pitch, start: pending.cell.step, length: 1 };
        onChange(addMelodyNote(lane, note));
        onAuditionPitch(pending.cell.pitch);
      }
      return;
    }
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

  /** One row's background: a stop per chord slot, colored by that chord —
   * so the color changes where the harmony changes, mid-bar or not. */
  const rowGradient = (pitch: number): string => {
    const stops: string[] = [];
    segments.forEach((segment) => {
      const kind = melodyRowKind(pitch, segment.chord, keyValue);
      const color =
        kind === 'chord'
          ? 'var(--lane-chord)'
          : kind === 'scale'
            ? 'var(--lane-scale)'
            : 'var(--lane-off)';
      const from = (segment.start / totalBeats) * 100;
      const to = (Math.min(totalBeats, segment.start + segment.beats) / totalBeats) * 100;
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
          top: rowForPitch(Math.max(drag.from.pitch, drag.to.pitch)) * rowH,
          height: (Math.abs(drag.to.pitch - drag.from.pitch) + 1) * rowH,
        }
      : null;

  return (
    <div className="tp-lane" onPointerLeave={() => onHoverSlot(null)}>
      <div className="tp-lane__gutter" style={{ height }}>
        {Array.from({ length: MELODY_ROWS }, (_, row) => {
          const pitch = pitchForRow(row);
          return (
            <button
              key={row}
              type="button"
              className={`tp-lane__key${pitch % 12 === 0 ? ' tp-lane__key--tonic' : ''}${focusClass('key', pitch)}`}
              style={{ height: rowH }}
              onClick={() => onAuditionPitch(pitch)}
              tabIndex={-1}
              aria-label={`Hear ${rowLabel(pitch)}`}
            >
              {rowLabel(pitch)}
            </button>
          );
        })}
      </div>

      <div className="tp-lane__scroll" ref={scrollRef}>
        <div
          className={`tp-lane__surface${drag?.kind === 'erase' || eraseMode ? ' tp-lane__surface--erasing' : ''}`}
          ref={surfaceRef}
          // On a coarse pointer the base touch-action (mobile-melody.css)
          // lets a plain swipe pan the lane natively; erase mode takes that
          // back so a fast erase-box drag can't be swallowed as a scroll.
          style={{ width, height, touchAction: eraseMode ? 'none' : undefined }}
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
                style={{ top: row * rowH, height: rowH, background: rowGradient(pitch) }}
              />
            );
          })}

          {Array.from({ length: bars }, (_, bar) => (
            <div
              key={`bar-${bar}`}
              className="tp-lane__gridline"
              style={{ left: bar * BEATS_PER_BAR * beatWidth }}
            />
          ))}

          {segments.map((segment, i) => (
            <div
              key={`seg-${i}`}
              className={`tp-lane__segment${playingSlot === i ? ' tp-lane__segment--playing' : ''}${
                hoveredSlot === i ? ' tp-lane__segment--hovered' : ''
              }`}
              style={{ left: segment.start * beatWidth, width: segment.beats * beatWidth }}
            />
          ))}

          {lane.notes.map((note, i) => (
            <div
              key={`${note.start}-${note.pitch}-${i}`}
              className={`tp-lane__note${drag && 'index' in drag && drag.index === i ? ' tp-lane__note--active' : ''}`}
              style={{
                left: note.start * stepW,
                width: Math.max(1, note.length) * stepW - 1,
                top: rowForPitch(note.pitch) * rowH,
                height: rowH - 1,
              }}
              onPointerDown={(e) => handleNotePointerDown(e, i, note)}
              title={`${rowLabel(note.pitch)} · drag to move, drag the right edge to lengthen, alt-click or erase mode to delete`}
            />
          ))}

          {eraseBox && <div className="tp-lane__erase-box" style={eraseBox} />}
        </div>
      </div>
    </div>
  );
}
