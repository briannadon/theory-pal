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
import { voiceProgression, type AbsChord } from '../theory/index.ts';

const TICKS_PER_BEAT = 480;
const BEATS_PER_BAR = 4; // one chord per bar, 4/4 — SPEC.md / PLAN.md v1 scope
const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR;
const NOTE_VELOCITY = 100;

interface RawNoteEvent {
  tick: number;
  on: boolean;
  note: number;
}

/**
 * Render `bars` (one `AbsChord` per bar-slot, `null` = a silent bar) to a
 * Standard MIDI File — format 0, single track, tempo set from `bpm`. Returns
 * a Blob the UI can hand to a download link.
 */
export function exportMidiFile(bars: (AbsChord | null)[], bpm: number): Blob {
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

  const rawEvents: RawNoteEvent[] = [];
  for (const [barIndex, notes] of notesByBar) {
    const startTick = barIndex * TICKS_PER_BAR;
    const endTick = startTick + TICKS_PER_BAR;
    for (const note of notes) {
      rawEvents.push({ tick: startTick, on: true, note });
      rawEvents.push({ tick: endTick, on: false, note });
    }
  }
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
      velocity: ev.on ? NOTE_VELOCITY : 0,
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
