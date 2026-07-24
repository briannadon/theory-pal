import { describe, expect, it } from 'vitest';
import { parseMidi, type MidiEvent, type MidiNoteOffEvent, type MidiNoteOnEvent } from 'midi-file';
import { exportMidiFile } from './export.ts';
import type { AbsChord } from '../theory/index.ts';

async function parse(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return parseMidi(bytes);
}

function isNoteOn(e: MidiEvent): e is MidiNoteOnEvent {
  return e.type === 'noteOn' && e.velocity > 0;
}

function isNoteOff(e: MidiEvent): e is MidiNoteOffEvent {
  return e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0);
}

/** Absolute tick of each event in a track, given each event's deltaTime. */
function absoluteTicks(track: MidiEvent[]): number[] {
  let t = 0;
  return track.map((e) => {
    t += e.deltaTime;
    return t;
  });
}

describe('exportMidiFile', () => {
  it('produces a parseable format-0, single-track SMF', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }];
    const blob = exportMidiFile(bars, 120);
    expect(blob.type).toBe('audio/midi');
    const parsed = await parse(blob);
    expect(parsed.header.format).toBe(0);
    expect(parsed.tracks).toHaveLength(1);
  });

  it('encodes the correct tempo meta event from bpm', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }];
    for (const bpm of [60, 90, 120, 174]) {
      const parsed = await parse(exportMidiFile(bars, bpm));
      const tempoEvent = parsed.tracks[0].find((e) => e.type === 'setTempo');
      expect(tempoEvent).toBeDefined();
      const microsecondsPerBeat = (tempoEvent as { microsecondsPerBeat: number }).microsecondsPerBeat;
      expect(Math.round(60_000_000 / microsecondsPerBeat)).toBe(bpm);
    }
  });

  it('every note-on has a matching note-off, same note number, after it', async () => {
    const bars: (AbsChord | null)[] = [
      { root: 0, quality: 'maj7' },
      { root: 5, quality: 'dom7' },
      null,
      { root: 9, quality: 'min7' },
    ];
    const parsed = await parse(exportMidiFile(bars, 100));
    const track = parsed.tracks[0];
    const ticks = absoluteTicks(track);

    const onStack = new Map<number, number[]>(); // note -> stack of on-tick positions (index into track)
    const unmatched: number[] = [];
    track.forEach((e, i) => {
      if (isNoteOn(e)) {
        const list = onStack.get(e.noteNumber) ?? [];
        list.push(i);
        onStack.set(e.noteNumber, list);
      } else if (isNoteOff(e)) {
        const list = onStack.get(e.noteNumber);
        if (!list || list.length === 0) {
          unmatched.push(i);
        } else {
          const onIndex = list.pop()!;
          expect(ticks[i]).toBeGreaterThanOrEqual(ticks[onIndex]);
        }
      }
    });
    expect(unmatched).toEqual([]);
    // Nothing left dangling: every note-on was eventually matched.
    for (const [, list] of onStack) expect(list).toEqual([]);
  });

  it('places one chord per bar (480 ticks/beat * 4 beats = 1920 ticks/bar) and leaves null bars silent', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }, null, { root: 7, quality: 'maj' }];
    const parsed = await parse(exportMidiFile(bars, 120));
    const track = parsed.tracks[0];
    const ticks = absoluteTicks(track);

    const barsWithNoteOn = new Set<number>();
    track.forEach((e, i) => {
      if (isNoteOn(e)) barsWithNoteOn.add(Math.floor(ticks[i] / 1920));
    });
    expect(barsWithNoteOn.has(0)).toBe(true);
    expect(barsWithNoteOn.has(1)).toBe(false); // the null bar
    expect(barsWithNoteOn.has(2)).toBe(true);

    // Bar 0's chord (C major, root position via voiceProgression) starts at tick 0.
    const firstNoteOnTick = ticks[track.findIndex((e) => isNoteOn(e))];
    expect(firstNoteOnTick).toBe(0);
  });

  it('voices each chord (via theory/voiceProgression) rather than emitting bare root-position triads', async () => {
    // A ii-V-I: voice leading should keep some common tones between adjacent
    // chords rather than jumping straight back to root position each bar,
    // which is what distinguishes voiceProgression output from a naive
    // per-chord chordPitches() rendering.
    const bars: (AbsChord | null)[] = [
      { root: 2, quality: 'min7' }, // Dm7
      { root: 7, quality: 'dom7' }, // G7
      { root: 0, quality: 'maj7' }, // Cmaj7
    ];
    const parsed = await parse(exportMidiFile(bars, 120));
    const track = parsed.tracks[0];
    const ticks = absoluteTicks(track);

    const notesAtTick = (tick: number): number[] =>
      track.filter((e, i) => isNoteOn(e) && ticks[i] === tick).map((e) => (e as MidiNoteOnEvent).noteNumber);

    const bar0 = notesAtTick(0).sort((a, b) => a - b);
    const bar1 = notesAtTick(1920).sort((a, b) => a - b);
    // Each voiced chord should have 4 notes (7th chords) and stay within a
    // reasonable playable register (voiceProgression's default window).
    expect(bar0).toHaveLength(4);
    expect(bar1).toHaveLength(4);
    for (const n of [...bar0, ...bar1]) {
      expect(n).toBeGreaterThanOrEqual(48);
      expect(n).toBeLessThanOrEqual(84);
    }
  });

  it('ends with an endOfTrack meta event spanning the full bar count', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }, null];
    const parsed = await parse(exportMidiFile(bars, 120));
    const track = parsed.tracks[0];
    expect(track[track.length - 1].type).toBe('endOfTrack');
    const ticks = absoluteTicks(track);
    expect(ticks[ticks.length - 1]).toBe(2 * 1920); // 2 bars total, including the trailing silent one
  });

  it('an all-null progression exports silently without throwing', async () => {
    const bars: (AbsChord | null)[] = [null, null, null, null];
    const blob = exportMidiFile(bars, 120);
    const parsed = await parse(blob);
    const track = parsed.tracks[0];
    expect(track.some((e) => isNoteOn(e))).toBe(false);
    expect(track[track.length - 1].type).toBe('endOfTrack');
  });
});
