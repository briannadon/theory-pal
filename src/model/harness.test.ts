// PLAN.md M2 checkpoint: "Dev harness: give it `i - iv`, get ranked next
// chords with percentages." No trained model file exists yet (a separate,
// concurrent pipeline effort produces public/model/transitions.json), so
// this exercises the prior-only path — exactly the path the app runs on
// before the model finishes loading, or for any mode the pipeline couldn't
// populate.
//
// Run with `npx vitest run src/model/harness.test.ts --reporter=verbose` (or
// any reporter that shows console output) to eyeball the ranking.
import { describe, expect, it } from 'vitest';
import { chordName, romanNumeral, toAbsolute, type Key, type RelChord } from '../theory/index.ts';
import { suggest } from './suggest.ts';

function printRanking(label: string, key: Key, context: RelChord[]) {
  const list = suggest(null, { context, key, limit: 16 });
  const ctxLabel = context.map((c) => romanNumeral(c, key)).join(' - ');
  console.log(`\n${label}: after ${ctxLabel}`);
  console.log('-'.repeat(50));
  for (const s of list) {
    const roman = romanNumeral(s.chord, key).padEnd(8);
    const abs = chordName(toAbsolute(s.chord, key)).padEnd(7);
    const pct = `${(s.probability * 100).toFixed(1)}%`.padStart(6);
    const flag = s.diatonic ? '' : '  (borrowed/chromatic)';
    console.log(`  ${roman} ${abs} ${pct}${flag}`);
  }
  return list;
}

describe('M2 dev harness: i - iv in A aeolian (natural minor)', () => {
  it('prints a human-readable ranked list of next chords with percentages', () => {
    const key: Key = { tonic: 9, scale: 'aeolian' }; // A minor
    const context: RelChord[] = [
      { degree: 0, quality: 'min' }, // i
      { degree: 5, quality: 'min' }, // iv
    ];
    const list = printRanking('A aeolian', key, context);

    // Sanity, not just print-and-hope: a real ranked list, normalized, with
    // both diatonic and non-diatonic chords reachable.
    expect(list.length).toBeGreaterThan(0);
    const sum = list.reduce((s, x) => s + x.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(list.some((s) => s.diatonic)).toBe(true);
    expect(list.some((s) => !s.diatonic)).toBe(true);
  });

  it('also prints i - iv in a different mode (D dorian) for a mode-generalization comparison', () => {
    const key: Key = { tonic: 2, scale: 'dorian' }; // D dorian
    const context: RelChord[] = [
      { degree: 0, quality: 'min' }, // i
      { degree: 5, quality: 'maj' }, // IV (dorian's characteristic major IV)
    ];
    const list = printRanking('D dorian', key, context);
    expect(list.length).toBeGreaterThan(0);
  });
});
