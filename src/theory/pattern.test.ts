import { describe, expect, it } from 'vitest';
import { renderBar, type BarStyle, type VoicedChord } from './index.ts';

const cMaj: VoicedChord = { notes: [60, 64, 67] };

function starts(style: BarStyle, chord = cMaj, beats = 4): number[] {
  return renderBar(chord, style, beats).map((e) => e.startBeat);
}

function notes(style: BarStyle, chord = cMaj, beats = 4): number[] {
  return renderBar(chord, style, beats).map((e) => e.note);
}

describe('renderBar', () => {
  it('block style reproduces the original playback: whole chord on every beat', () => {
    const events = renderBar(cMaj, { pattern: 'block', rate: '1/4' }, 4);
    expect(events).toHaveLength(12); // 3 notes x 4 beats
    expect(events.slice(0, 3)).toEqual([
      { note: 60, startBeat: 0, durationBeats: 0.85, velocity: 100 },
      { note: 64, startBeat: 0, durationBeats: 0.85, velocity: 100 },
      { note: 67, startBeat: 0, durationBeats: 0.85, velocity: 100 },
    ]);
    expect(new Set(events.map((e) => e.startBeat))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('walks the voicing one note per step at the requested rate', () => {
    expect(starts({ pattern: 'up', rate: '1/8' })).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(notes({ pattern: 'up', rate: '1/8' })).toEqual([60, 64, 67, 60, 64, 67, 60, 64]);
    expect(starts({ pattern: 'up', rate: '1/16' })).toHaveLength(16);
  });

  it('supports triplet rates', () => {
    const events = renderBar(cMaj, { pattern: 'up', rate: '1/8t' }, 4);
    expect(events).toHaveLength(12); // 12 eighth-note triplets in a 4/4 bar
    expect(events[3].startBeat).toBeCloseTo(1);
  });

  it('orders notes by pattern, without repeating the turning points', () => {
    expect(notes({ pattern: 'down', rate: '1/4' })).toEqual([67, 64, 60, 67]);
    expect(notes({ pattern: 'updown', rate: '1/4' })).toEqual([60, 64, 67, 64]);
    expect(notes({ pattern: 'downup', rate: '1/4' })).toEqual([67, 64, 60, 64]);
  });

  it('spans extra octaves by stacking the voicing', () => {
    expect(notes({ pattern: 'up', rate: '1/8', octaves: 2 })).toEqual([
      60, 64, 67, 72, 76, 79, 60, 64,
    ]);
  });

  it('random draws from the pool using the caller’s rng, deterministically', () => {
    const rng = () => 0.99; // always the top of the pool
    const events = renderBar(cMaj, { pattern: 'random', rate: '1/4' }, 4, rng);
    expect(events.map((e) => e.note)).toEqual([67, 67, 67, 67]);
  });

  it('gate scales note length against the step, not the beat', () => {
    const [first] = renderBar(cMaj, { pattern: 'up', rate: '1/8', gate: 0.5 }, 4);
    expect(first.durationBeats).toBe(0.25);
  });

  it('fills a short span without spilling past its end', () => {
    // A one-beat chord: struck once, and its tail cannot run into whatever
    // chord takes over on the next beat.
    expect(renderBar(cMaj, { pattern: 'block', rate: '1/4' }, 1)).toHaveLength(3);
    expect(renderBar(cMaj, { pattern: 'sustain', rate: '1/4' }, 1)[0].durationBeats).toBe(1);
    // Half a beat is shorter than the gate, so the gate gives way.
    expect(renderBar(cMaj, { pattern: 'block', rate: '1/4' }, 0.5)[0].durationBeats).toBe(0.425);
  });

  it('arpeggiates uneven spans, and still sounds one note in a span shorter than a step', () => {
    expect(starts({ pattern: 'up', rate: '1/8' }, cMaj, 3)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    const stab = renderBar(cMaj, { pattern: 'up', rate: '1/4' }, 0.5);
    expect(stab).toHaveLength(1);
    expect(stab[0].durationBeats).toBe(0.425);
  });

  it('an empty voicing produces nothing rather than throwing', () => {
    expect(renderBar({ notes: [] }, { pattern: 'up', rate: '1/8' }, 4)).toEqual([]);
  });
});
