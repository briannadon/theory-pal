// Standard MIDI file export (SPEC.md `src/midi/`): format 0, single track,
// one chord per bar, null slots leave silence. Built on the `midi-file`
// package's `writeMidi` — it emits an intermediate `MidiData` object as raw
// bytes; we build that object directly rather than writing SMF bytes by hand.
//
// Chords are voiced via `theory/voiceProgression` (skipping null slots so
// voice-leading only considers actual chords, not gaps) so the exported file
// sounds like what the grid's own audition would play, rather than flat
// root-position triads.
import { writeMidi, type MidiData, type MidiEvent } from 'midi-file';
import {
  renderBar,
  voiceProgression,
  type AbsChord,
  type BarStyle,
  type NoteEvent,
} from '../theory/index.ts';

const TICKS_PER_BEAT = 480;
const BEATS_PER_BAR = 4; // one chord per bar, 4/4 — SPEC.md / PLAN.md v1 scope
const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR;

interface RawNoteEvent {
  tick: number;
  on: boolean;
  note: number;
  velocity: number;
}

export interface ExportOptions {
  /** How each bar is played. Defaults to one sustained chord per bar, which
   * is what export has always written; pass the transport's live style to
   * export arpeggios instead. */
  style?: BarStyle;
  /** Melody notes per bar, in beats from that bar's start (theory/pattern.ts). */
  melody?: (NoteEvent[] | null)[];
}

// Whole-bar chords: the historical export behavior, and still the default.
const SUSTAIN_STYLE: BarStyle = { pattern: 'sustain', rate: '1/4' };

/**
 * Render `bars` (one `AbsChord` per bar-slot, `null` = a silent bar) to a
 * Standard MIDI File — format 0, single track, tempo set from `bpm`. Returns
 * a Blob the UI can hand to a download link.
 */
export function exportMidiFile(bars: (AbsChord | null)[], bpm: number, opts?: ExportOptions): Blob {
  const microsecondsPerBeat = Math.round(60_000_000 / bpm);

  // Voice only the real chords (in order), so voice-leading treats gaps as
  // absent rather than as a chord to lead into/out of, then re-align the
  // voiced chords back onto their original bar indices.
  const chordIndices: number[] = [];
  const chordsOnly: AbsChord[] = [];
  bars.forEach((bar, i) => {
    if (bar !== null) {
      chordIndices.push(i);
      chordsOnly.push(bar);
    }
  });
  const voiced = voiceProgression(chordsOnly);
  const notesByBar = new Map<number, number[]>();
  chordIndices.forEach((barIndex, i) => notesByBar.set(barIndex, voiced[i].notes));

  // Chords and melody both come through `renderBar`'s NoteEvent form, so the
  // exported file is the same material playback schedules — an arpeggio or a
  // lead line exports without a second code path here.
  const style = opts?.style ?? SUSTAIN_STYLE;
  const rawEvents: RawNoteEvent[] = [];
  const emit = (barIndex: number, events: NoteEvent[]) => {
    const barStart = barIndex * TICKS_PER_BAR;
    for (const ev of events) {
      const startTick = barStart + Math.round(ev.startBeat * TICKS_PER_BEAT);
      const endTick = startTick + Math.round(ev.durationBeats * TICKS_PER_BEAT);
      rawEvents.push({ tick: startTick, on: true, note: ev.note, velocity: ev.velocity });
      rawEvents.push({ tick: endTick, on: false, note: ev.note, velocity: 0 });
    }
  };

  for (const [barIndex, notes] of notesByBar) {
    emit(barIndex, renderBar({ notes }, style, BEATS_PER_BAR));
  }
  opts?.melody?.forEach((events, barIndex) => {
    if (events && events.length > 0) emit(barIndex, events);
  });
  // Stable, deterministic order: by tick, note-offs before note-ons at the
  // same tick (so a note ending exactly when another with the same number
  // begins doesn't produce an overlapping on/on or an out-of-order off after
  // on), then by note number.
  rawEvents.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on) || a.note - b.note);

  const track: MidiEvent[] = [
    { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat },
    {
      deltaTime: 0,
      meta: true,
      type: 'timeSignature',
      numerator: BEATS_PER_BAR,
      denominator: 4,
      metronome: 24,
      thirtyseconds: 8,
    },
  ];

  let lastTick = 0;
  for (const ev of rawEvents) {
    const deltaTime = ev.tick - lastTick;
    lastTick = ev.tick;
    track.push({
      deltaTime,
      channel: 0,
      type: ev.on ? 'noteOn' : 'noteOff',
      noteNumber: ev.note,
      velocity: ev.on ? ev.velocity : 0,
    });
  }

  const totalTicks = bars.length * TICKS_PER_BAR;
  track.push({ deltaTime: Math.max(0, totalTicks - lastTick), meta: true, type: 'endOfTrack' });

  const midiData: MidiData = {
    header: { format: 0, numTracks: 1, ticksPerBeat: TICKS_PER_BEAT },
    tracks: [track],
  };

  const bytes = writeMidi(midiData);
  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
}
