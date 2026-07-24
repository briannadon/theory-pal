import { describe, expect, it } from 'vitest';
import type { Key, RelChord } from '../theory/index.ts';
import { SURPRISE_SKIP_TOP } from './constants.ts';
import { suggest, surprise } from './suggest.ts';

const cMajor: Key = { tonic: 0, scale: 'ionian' };
const context: RelChord[] = [{ degree: 0, quality: 'maj' }];

/** Deterministic seeded PRNG (mulberry32) so tests don't depend on Math.random. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('surprise', () => {
  it('is deterministic given a seeded rng', () => {
    const a = surprise(null, { context, key: cMajor }, seeded(42));
    const b = surprise(null, { context, key: cMajor }, seeded(42));
    expect(a).toEqual(b);
  });

  it('different seeds can (and generally do) produce different picks', () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const s = surprise(null, { context, key: cMajor }, seeded(seed));
      picks.add(`${s?.chord.degree}:${s?.chord.quality}`);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('never returns the top-ranked suggestion', () => {
    const top = suggest(null, { context, key: cMajor, limit: 1 })[0];
    for (let seed = 0; seed < 50; seed++) {
      const s = surprise(null, { context, key: cMajor }, seeded(seed));
      expect(s).not.toBeNull();
      expect(s).not.toEqual(top);
    }
  });

  it('always draws from below the top SURPRISE_SKIP_TOP ranks of its pool', () => {
    const pool = suggest(null, { context, key: cMajor, limit: 24 });
    for (let seed = 0; seed < 30; seed++) {
      const s = surprise(null, { context, key: cMajor }, seeded(seed))!;
      const rank = pool.findIndex((x) => x.chord.degree === s.chord.degree && x.chord.quality === s.chord.quality);
      expect(rank).toBeGreaterThanOrEqual(SURPRISE_SKIP_TOP);
    }
  });

  it('excludes the near-zero "nonsense" tail (never returns something below the probability floor)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = surprise(null, { context, key: cMajor }, seeded(seed))!;
      expect(s.probability).toBeGreaterThan(0);
    }
  });

  it('works with model === null (falls back to prior)', () => {
    expect(() => surprise(null, { context, key: cMajor }, seeded(1))).not.toThrow();
  });

  it('defaults to Math.random when no rng is supplied', () => {
    expect(() => surprise(null, { context, key: cMajor })).not.toThrow();
  });
});
