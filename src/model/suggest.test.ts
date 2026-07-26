import { describe, expect, it } from 'vitest';
import type { Key, RelChord } from '../theory/index.ts';
import { DEFAULT_SUGGEST_LIMIT } from './constants.ts';
import { suggest, surprise } from './suggest.ts';
import type { ModeModel, TransitionModel } from './types.ts';

function makeModel(modes: Partial<Record<string, ModeModel>>): TransitionModel {
  return {
    version: 1,
    generatedAt: '2026-07-23T00:00:00Z',
    source: 'test fixture',
    songCount: 1,
    // eslint/ts don't need to validate ScaleId here — internal test fixture.
    modes: modes as TransitionModel['modes'],
  };
}

const cMajor: Key = { tonic: 0, scale: 'ionian' };

describe('suggest: prior-only (model === null)', () => {
  it('ranks IV and V above weaker functional matches, in C ionian after I', () => {
    const list = suggest(null, { context: [{ degree: 0, quality: 'maj' }], key: cMajor, limit: 20 });
    const rankOf = (degree: number, quality: string) =>
      list.findIndex((s) => s.chord.degree === degree && s.chord.quality === quality);
    const IV = rankOf(5, 'maj');
    const V = rankOf(7, 'maj');
    const iii = rankOf(4, 'min');
    expect(IV).toBeGreaterThanOrEqual(0);
    expect(V).toBeGreaterThanOrEqual(0);
    expect(iii).toBeGreaterThanOrEqual(0);
    expect(IV).toBeLessThan(iii);
    expect(V).toBeLessThan(iii);
  });

  it('includes non-diatonic chords (bVII, borrowed iv) in the default-limit output, flagged diatonic: false', () => {
    const list = suggest(null, { context: [{ degree: 0, quality: 'maj' }], key: cMajor });
    expect(list.length).toBe(DEFAULT_SUGGEST_LIMIT);
    const nonDiatonic = list.filter((s) => !s.diatonic);
    expect(nonDiatonic.length).toBeGreaterThan(0);
    for (const s of nonDiatonic) expect(s.fromCorpus).toBe(false);
  });

  it('probabilities are normalized over the returned list and sum to ~1, at several limits', () => {
    for (const limit of [1, 3, 8, 40]) {
      const list = suggest(null, { context: [{ degree: 0, quality: 'maj' }], key: cMajor, limit });
      expect(list).toHaveLength(limit);
      const sum = list.reduce((s, x) => s + x.probability, 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const s of list) {
        expect(s.probability).toBeGreaterThanOrEqual(0);
        expect(s.probability).toBeLessThanOrEqual(1);
      }
    }
  });

  it('works with an empty context', () => {
    expect(() => suggest(null, { context: [], key: cMajor })).not.toThrow();
    const list = suggest(null, { context: [], key: cMajor });
    expect(list.length).toBeGreaterThan(0);
  });

  it('every returned suggestion has fromCorpus: false when there is no model at all', () => {
    const list = suggest(null, { context: [{ degree: 0, quality: 'maj' }], key: cMajor, limit: 30 });
    expect(list.every((s) => !s.fromCorpus)).toBe(true);
  });
});

describe('suggest: a mode absent from the model behaves exactly like model === null for that mode', () => {
  it('falls back fully to the prior when modes has no entry for this key\'s scale', () => {
    const model = makeModel({}); // pipeline could not populate any mode
    const params = { context: [{ degree: 0, quality: 'maj' }] as RelChord[], key: cMajor, limit: 20 };
    expect(suggest(model, params)).toEqual(suggest(null, params));
  });
});

describe('suggest: order-2 with backoff to order-1, then to the prior', () => {
  // Context: I -> IV. Order-2 key "0:maj>5:maj" strongly favors vi (a
  // deceptive-ish move), which neither the order-1 continuation of IV alone
  // nor the prior would rank first.
  const context: RelChord[] = [
    { degree: 0, quality: 'maj' },
    { degree: 5, quality: 'maj' },
  ];

  it('order-2 beats order-1 when the model has the specific two-chord context', () => {
    const withOrder2 = makeModel({
      ionian: {
        order1: { '5:maj': { '7:maj': 5, '2:min': 5 } },
        order2: { '0:maj>5:maj': { '9:min': 20 } },
        totals1: { '5:maj': 10 },
        totals2: { '0:maj>5:maj': 20 },
      },
    });
    const list = suggest(withOrder2, { context, key: cMajor, limit: 5 });
    expect(list[0].chord).toEqual({ degree: 9, quality: 'min' });
    expect(list[0].fromCorpus).toBe(true);
  });

  it('backs off to order-1 when order-2 has no (or too little) data for this exact context', () => {
    const order1Only = makeModel({
      ionian: {
        order1: { '5:maj': { '7:maj': 5, '2:min': 5 } },
        order2: {}, // no data at all for "0:maj>5:maj"
        totals1: { '5:maj': 10 },
        totals2: {},
      },
    });
    const list = suggest(order1Only, { context, key: cMajor, limit: 5 });
    // vi had no corpus support in this fixture, so order-1's evenly-split
    // V/ii signal should win it out over the (prior-only) vi.
    expect(list[0].chord).not.toEqual({ degree: 9, quality: 'min' });
    const viEntry = list.find((s) => s.chord.degree === 9 && s.chord.quality === 'min');
    expect(viEntry?.fromCorpus).not.toBe(true);
  });

  it('backs off all the way to the prior when neither order-1 nor order-2 has enough data', () => {
    const sparse = makeModel({
      ionian: {
        order1: { '5:maj': { '7:maj': 0.2 } }, // below MIN_ORDER1_TOTAL
        order2: {},
        totals1: { '5:maj': 0.2 },
        totals2: {},
      },
    });
    const list = suggest(sparse, { context, key: cMajor, limit: 10 });
    const priorOnly = suggest(null, { context, key: cMajor, limit: 10 });
    expect(list).toEqual(priorOnly);
  });

  it('handles fractional counts (soft key-assignment) without special-casing', () => {
    const fractional = makeModel({
      ionian: {
        order1: {},
        order2: { '0:maj>5:maj': { '9:min': 3.7, '7:maj': 1.2 } },
        totals1: {},
        totals2: { '0:maj>5:maj': 4.9 },
      },
    });
    expect(() => suggest(fractional, { context, key: cMajor, limit: 10 })).not.toThrow();
    const list = suggest(fractional, { context, key: cMajor, limit: 10 });
    const sum = list.reduce((s, x) => s + x.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe('suggest: filling a slot that already has a chord after it', () => {
  const I: RelChord = { degree: 0, quality: 'maj' };
  const ii: RelChord = { degree: 2, quality: 'min' };
  const IV: RelChord = { degree: 5, quality: 'maj' };
  const V: RelChord = { degree: 7, quality: 'maj' };
  const bVII: RelChord = { degree: 10, quality: 'maj' };

  const rankIn = (list: ReturnType<typeof suggest>, chord: RelChord) =>
    list.findIndex((s) => s.chord.degree === chord.degree && s.chord.quality === chord.quality);
  const probIn = (list: ReturnType<typeof suggest>, chord: RelChord) =>
    list.find((s) => s.chord.degree === chord.degree && s.chord.quality === chord.quality)
      ?.probability ?? 0;

  it('omitting `following` leaves the ranking exactly as it was', () => {
    const forward = suggest(null, { context: [IV], key: cMajor, limit: 20 });
    const explicitUndefined = suggest(null, {
      context: [IV],
      following: undefined,
      key: cMajor,
      limit: 20,
    });
    expect(explicitUndefined).toEqual(forward);
  });

  it('puts V first between IV and I, where forward-only ranking prefers bVII', () => {
    const forward = suggest(null, { context: [IV], key: cMajor, limit: 20 });
    // Both are idiomatic continuations of IV, and the prior ranks the backdoor
    // bVII first when it only knows what came before.
    expect(rankIn(forward, bVII)).toBeLessThan(rankIn(forward, V));

    const between = suggest(null, { context: [IV], following: I, key: cMajor, limit: 20 });
    expect(rankIn(between, V)).toBe(0);
  });

  it('lifts the normative predominants for a slot before V', () => {
    const forward = suggest(null, { context: [I], key: cMajor, limit: 20 });
    const between = suggest(null, { context: [I], following: V, key: cMajor, limit: 20 });
    expect(rankIn(between, ii)).toBeLessThan(rankIn(forward, ii));
  });

  it('demotes a candidate that follows the context well but leads nowhere', () => {
    // I is a fine chord after IV (a plagal move) and a poor one before another
    // I, which forward-only ranking cannot see.
    const forward = suggest(null, { context: [IV], key: cMajor, limit: 20 });
    const between = suggest(null, { context: [IV], following: I, key: cMajor, limit: 20 });
    expect(probIn(forward, V) / probIn(forward, I)).toBeLessThan(
      probIn(between, V) / probIn(between, I),
    );
  });

  it('ranks on the backward side alone when the slot starts the progression', () => {
    // The case this feature exists for: clearing the first chord and asking
    // what belongs in front of what is left.
    const between = suggest(null, { context: [], following: V, key: cMajor, limit: 20 });
    expect(rankIn(between, IV)).toBe(0);
    expect(rankIn(between, ii)).toBeLessThan(rankIn(between, V));
  });

  it('flags fromCorpus when only the backward transition was observed', () => {
    const backwardOnly = makeModel({
      ionian: {
        order1: { '5:maj': { '0:maj': 10 } },
        order2: {},
        totals1: { '5:maj': 10 },
        totals2: {},
      },
    });
    // No context, so nothing is observed going *into* IV; the corpus only
    // knows that IV goes to I.
    const list = suggest(backwardOnly, { context: [], following: I, key: cMajor, limit: 20 });
    expect(list[rankIn(list, IV)].fromCorpus).toBe(true);
  });

  it('reaches surprise() too', () => {
    const rng = () => 0.0001;
    const forward = surprise(null, { context: [IV], key: cMajor }, rng);
    const between = surprise(null, { context: [IV], following: I, key: cMajor }, rng);
    expect(forward).not.toBeNull();
    expect(between).not.toBeNull();
    expect(between!.chord).not.toEqual(forward!.chord);
  });
});
