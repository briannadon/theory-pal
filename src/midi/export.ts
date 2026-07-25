// Standard MIDI file export (SPEC.md `src/midi/`): one chord per bar, null
// slots leave silence. Format 0 and a single track when the progression is
// chords alone; format 1 with a tempo track plus separate chord and melody
// tracks (on separate channels) once there is a melody to separate. Built on the `midi-file`
// package's `writeMidi` — it emits an intermediate `MidiData` object as raw
// bytes; we build that object directly rather than writing SMF bytes by hand.
//
// Chords are voiced via `theory/voiceProgression` (skipping null slots so
// voice-leading only considers actual chords, not gaps) so the exported file
// sounds like what the grid's own audition would play, rather than flat
// root-position triads.
import { writeMidi, type MidiData, type MidiEvent } from 'midi-file';
import { MIDI_CHANNEL } from './out.ts';
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
  /** How each chord is played. Defaults to one sustained chord per slot, which
   * is what export has always written; pass the transport's live style to
   * export arpeggios instead. */
  style?: BarStyle;
  /** Melody notes per bar, in beats from that bar's start (theory/pattern.ts).
   * Bars, not chord slots: the melody lane keeps its own even bar grid no
   * matter how the chords above it are cut. */
  melody?: (NoteEvent[] | null)[];
  /** How long each chord slot lasts, in beats. Indexed like `bars`; omit for
   * the historical one-chord-per-bar timeline. */
  slotBeats?: readonly number[];
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
  //
  // The two parts sit on different grids and are collected against their own:
  // chords on the slot timeline (each slot as long as `slotBeats` says, which
  // is how a 3+1 bar exports as a 3-beat chord and a 1-beat one), melody on
  // plain 4/4 bars.
  const style = opts?.style ?? SUSTAIN_STYLE;
  const slotStartTicks: number[] = [];
  let cursorBeats = 0;
  for (let i = 0; i < bars.length; i++) {
    slotStartTicks.push(Math.round(cursorBeats * TICKS_PER_BEAT));
    cursorBeats += opts?.slotBeats?.[i] ?? BEATS_PER_BAR;
  }
  const totalTicks = Math.max(
    Math.round(cursorBeats * TICKS_PER_BEAT),
    (opts?.melody?.length ?? 0) * TICKS_PER_BAR,
  );

  const collect = (
    count: number,
    startTickOf: (index: number) => number,
    source: (index: number) => NoteEvent[] | null,
  ): RawNoteEvent[] => {
    const raw: RawNoteEvent[] = [];
    for (let index = 0; index < count; index++) {
      const events = source(index);
      if (!events) continue;
      const base = startTickOf(index);
      for (const ev of events) {
        const startTick = base + Math.round(ev.startBeat * TICKS_PER_BEAT);
        const endTick = startTick + Math.round(ev.durationBeats * TICKS_PER_BEAT);
        raw.push({ tick: startTick, on: true, note: ev.note, velocity: ev.velocity });
        raw.push({ tick: endTick, on: false, note: ev.note, velocity: 0 });
      }
    }
    // Stable, deterministic order: by tick, note-offs before note-ons at the
    // same tick (so a note ending exactly when another with the same number
    // begins doesn't produce an overlapping on/on or an out-of-order off after
    // on), then by note number.
    return raw.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on) || a.note - b.note);
  };

  const chordEvents = collect(
    bars.length,
    (i) => slotStartTicks[i],
    (i) => {
      const notes = notesByBar.get(i);
      return notes ? renderBar({ notes }, style, opts?.slotBeats?.[i] ?? BEATS_PER_BAR) : null;
    },
  );
  const melodyEvents = collect(
    opts?.melody?.length ?? 0,
    (bar) => bar * TICKS_PER_BAR,
    (bar) => opts?.melody?.[bar] ?? null,
  );

  const meta: MidiEvent[] = [
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

  const buildTrack = (
    head: MidiEvent[],
    events: RawNoteEvent[],
    channel: number,
    name?: string,
  ): MidiEvent[] => {
    const track: MidiEvent[] = [...head];
    if (name) track.unshift({ deltaTime: 0, meta: true, type: 'trackName', text: name });
    let lastTick = 0;
    for (const ev of events) {
      const deltaTime = ev.tick - lastTick;
      lastTick = ev.tick;
      track.push({
        deltaTime,
        channel,
        type: ev.on ? 'noteOn' : 'noteOff',
        noteNumber: ev.note,
        velocity: ev.on ? ev.velocity : 0,
      });
    }
    track.push({ deltaTime: Math.max(0, totalTicks - lastTick), meta: true, type: 'endOfTrack' });
    return track;
  };

  // With no melody there is one part, so a format-0 single-track file is the
  // honest representation (and what every consumer of this function got
  // before melodies existed). A melody makes it genuinely multi-track: chords
  // and lead land on separate tracks and separate channels, so a DAW can give
  // them different instruments — the same split playback uses live.
  const midiData: MidiData = melodyEvents.length
    ? {
        header: { format: 1, numTracks: 3, ticksPerBeat: TICKS_PER_BEAT },
        tracks: [
          buildTrack(meta, [], MIDI_CHANNEL.chords, 'theory-pal'),
          buildTrack([], chordEvents, MIDI_CHANNEL.chords, 'Chords'),
          buildTrack([], melodyEvents, MIDI_CHANNEL.melody, 'Melody'),
        ],
      }
    : {
        header: { format: 0, numTracks: 1, ticksPerBeat: TICKS_PER_BEAT },
        tracks: [buildTrack(meta, chordEvents, MIDI_CHANNEL.chords)],
      };

  const bytes = writeMidi(midiData);
  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
}
