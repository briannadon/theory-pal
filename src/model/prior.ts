// Hand-written functional-harmony prior. This is "what comes next" when the
// corpus has nothing to say for a given mode/context — and, blended in via
// suggest.ts, a stabilizing influence even when it does.
//
// The design goal (PLAN.md/SPEC.md): generalize tonic/subdominant/dominant
// function and standard chromatic devices (secondary dominants, modal
// mixture, bVII, Neapolitan, chromatic mediants) across ALL scales in
// theory/scales.ts, not just a hardcoded major-key table. The mechanism used
// throughout is: classify structure by *scale-degree position* and *root
// interval*, not by hardcoded chord identity, so the same code path produces
// C ionian's V and A phrygian's v (a minor triad!) from the same
// DEGREE_FUNCTION table, and produces dorian's characteristic major-IV vs
// mixolydian's characteristic bVII from the same "which scale tone is
// altered relative to a reference" computation rather than 21 separate
// per-scale-id special cases.
import {
  diatonicChords,
  getScale,
  QUALITY_INTERVALS,
  stateKey,
  type ChordQuality,
  type Key,
  type RelChord,
} from '../theory/index.ts';
import {
  BORROWED_FACTOR,
  CHARACTERISTIC_BONUS,
  CHROMATIC_DEGREE_FUNCTION,
  CHROMATIC_MEDIANT_FACTOR,
  CHROMATIC_MEDIANT_OFFSETS,
  DEGREE_FUNCTION,
  FUNCTION_TRANSITION,
  GLOBAL_FLOOR_WEIGHT,
  NEAPOLITAN_FACTOR,
  ROOT_MOTION_WEIGHT,
  SECONDARY_DOMINANT_FACTOR,
} from './constants.ts';

type Function3 = 'T' | 'S' | 'D';

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

// Every quality in the v1 vocabulary gets a floor entry (see
// GLOBAL_FLOOR_WEIGHT) — reusing theory/'s own quality table as the source
// of truth rather than duplicating a quality list here.
const ALL_QUALITIES = Object.keys(QUALITY_INTERVALS) as ChordQuality[];

// The two universal reference points used to find each mode's "altered"
// (characteristic) scale tone: the major scale (for major-third modes) and
// natural minor / aeolian (for minor-third modes). Virtually all Western
// tonal/modal theory is a deviation from one of these two, so comparing
// against whichever is closer generalizes to any 7-note scale in the table
// (including the more exotic harmonic/melodic-minor modes) without a
// per-scale-id lookup table.
const MAJOR_REF = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN_REF = [0, 2, 3, 5, 7, 8, 10];

/**
 * Scale-degree indices (0-6) where this scale's interval differs from
 * whichever reference (major or aeolian) it's closer to overall. These are
 * the "distinctive" scale tones that give a mode its characteristic flavor:
 * e.g. dorian vs aeolian differs only at index 5 (natural 6th vs b6), which
 * is exactly the raised 6th that makes dorian's IV chord major instead of
 * minor. Mixolydian vs major differs only at index 6 (b7), which both
 * weakens its V (giving it a minor third) and creates its signature bVII.
 */
function characteristicIndices(intervals: readonly number[]): Set<number> {
  let distMajor = 0;
  let distAeolian = 0;
  for (let i = 0; i < 7; i++) {
    distMajor += Math.abs(intervals[i] - MAJOR_REF[i]);
    distAeolian += Math.abs(intervals[i] - AEOLIAN_REF[i]);
  }
  const ref = distMajor <= distAeolian ? MAJOR_REF : AEOLIAN_REF;
  const idxs = new Set<number>();
  for (let i = 0; i < 7; i++) {
    if (intervals[i] !== ref[i]) idxs.add(i);
  }
  return idxs;
}

/** A diatonic chord at scale-degree index `i` is "characteristic" if its
 * root, third, or fifth (scale-degree indices i, i+2, i+4 mod 7 — the same
 * tertian stacking `diatonicChords` uses) lands on an altered scale tone. */
function isCharacteristic(i: number, charIdx: Set<number>): boolean {
  return charIdx.has(i) || charIdx.has((i + 2) % 7) || charIdx.has((i + 4) % 7);
}

/** Which parallel scale supplies this mode's modal-mixture / borrowed
 * chords: the parallel natural-minor for major-third modes, the parallel
 * major for minor-third modes. This is the standard notion of "borrowing
 * from the parallel key," generalized by checking the mode's own 3rd rather
 * than hardcoding "major keys borrow from minor." */
function mixtureSourceScale(intervals: readonly number[]): 'ionian' | 'aeolian' {
  const third = intervals[2] - intervals[0];
  return third === 4 ? 'aeolian' : 'ionian';
}

/** Function bucket for an arbitrary chord: if it matches one of the mode's
 * own diatonic degrees, use that degree's function (DEGREE_FUNCTION); else
 * fall back to the generic chromatic-degree table. Used to classify the
 * *previous* chord in context, which may itself be a borrowed/chromatic
 * chord from an earlier suggestion. */
function chordFunction(rc: RelChord, diatonic: readonly RelChord[]): Function3 {
  const d = mod12(rc.degree);
  const idx = diatonic.findIndex((x) => mod12(x.degree) === d);
  if (idx >= 0) return DEGREE_FUNCTION[idx];
  return CHROMATIC_DEGREE_FUNCTION[d];
}

function sameChord(a: RelChord, b: RelChord): boolean {
  return mod12(a.degree) === mod12(b.degree) && a.quality === b.quality;
}

/**
 * Hand-written functional-harmony weights for "what comes after this
 * context, in this key/mode." Returns raw (unnormalized) positive weights
 * keyed by theory/'s stateKey format, ready for suggest.ts to normalize and
 * blend with corpus data. Never omits a plausible chromatic chord — every
 * (degree, quality) in the v1 vocabulary gets at least GLOBAL_FLOOR_WEIGHT,
 * so borrowed/secondary/chromatic-mediant chords are always present (just
 * outranked), per SPEC.md's "never filter to diatonic" requirement.
 */
export function theoryPrior(key: Key, context: RelChord[]): Map<string, number> {
  const scale = getScale(key.scale);
  const intervals = scale.intervals;
  const diatonic = diatonicChords(key, false);
  const charIdx = characteristicIndices(intervals);

  // With no context, assume the most common starting point: sitting on the
  // tonic. This only affects root-motion scoring (which needs *some*
  // previous root) — it does not force the tonic chord itself into the
  // output, which is scored like any other candidate.
  const prev: RelChord = context.length > 0 ? context[context.length - 1] : { degree: 0, quality: 'maj' };
  const prevRoot = mod12(prev.degree);
  const prevFn = chordFunction(prev, diatonic);

  const weights = new Map<string, number>();
  const add = (rc: RelChord, weight: number) => {
    const k = stateKey(rc);
    const existing = weights.get(k);
    if (existing === undefined || weight > existing) weights.set(k, weight);
  };

  // 0. Global floor. Guarantees every chromatic chord is reachable.
  for (let d = 0; d < 12; d++) {
    for (const q of ALL_QUALITIES) add({ degree: d, quality: q }, GLOBAL_FLOOR_WEIGHT);
  }

  // 1. Native diatonic triads: function-transition weight * root-motion
  // strength * characteristic-tone bonus.
  diatonic.forEach((rc, i) => {
    const fn = DEGREE_FUNCTION[i];
    const w =
      ROOT_MOTION_WEIGHT[mod12(rc.degree - prevRoot)] *
      FUNCTION_TRANSITION[prevFn][fn] *
      (isCharacteristic(i, charIdx) ? CHARACTERISTIC_BONUS : 1);
    add(rc, w);
  });

  // 2. Secondary dominants (V/x): a dominant-7th chord a fifth above each
  // non-tonic diatonic degree, functioning locally as that degree's dominant
  // regardless of the current mode (e.g. V/IV, V/vi). V/I is skipped since
  // that's just the mode's own V (already covered above, whatever quality it
  // has in this mode).
  diatonic.forEach((target, i) => {
    if (i === 0) return;
    const secRoot = mod12(target.degree + 7);
    const secChord: RelChord = { degree: secRoot, quality: 'dom7' };
    if (diatonic.some((d) => sameChord(d, secChord))) return;
    const w =
      ROOT_MOTION_WEIGHT[mod12(secRoot - prevRoot)] *
      FUNCTION_TRANSITION[prevFn]['D'] *
      SECONDARY_DOMINANT_FACTOR;
    add(secChord, w);
  });

  // 3. Modal mixture / borrowed chords: the parallel scale's diatonic triads
  // that differ from this mode's own (by degree+quality). This is where
  // bVII-in-major, borrowed iv, bVI, bIII etc. fall out automatically —
  // no per-chord special-casing needed.
  const mixScale = getScale(mixtureSourceScale(intervals));
  const mixDiatonic = diatonicChords({ tonic: key.tonic, scale: mixScale.id }, false);
  mixDiatonic.forEach((rc, i) => {
    if (diatonic.some((d) => sameChord(d, rc))) return; // already native, not actually borrowed
    const fn = DEGREE_FUNCTION[i];
    const w = ROOT_MOTION_WEIGHT[mod12(rc.degree - prevRoot)] * FUNCTION_TRANSITION[prevFn][fn] * BORROWED_FACTOR;
    add(rc, w);
  });

  // 4. Neapolitan (bII major): a subdominant substitute borrowed from
  // neither reference scale above, common enough across genres/modes to
  // warrant its own entry when this mode doesn't already have a major
  // triad on the b2 (phrygian/locrian already do, via step 1).
  const neapolitan: RelChord = { degree: 1, quality: 'maj' };
  if (!diatonic.some((d) => sameChord(d, neapolitan)) && !mixDiatonic.some((d) => sameChord(d, neapolitan))) {
    const w = ROOT_MOTION_WEIGHT[mod12(1 - prevRoot)] * FUNCTION_TRANSITION[prevFn]['S'] * NEAPOLITAN_FACTOR;
    add(neapolitan, w);
  }

  // 5. Chromatic mediants: major/minor triads a third away from the tonic,
  // treated as tonic-substitute color chords, added wherever they aren't
  // already covered by native/borrowed chords above.
  for (const offset of CHROMATIC_MEDIANT_OFFSETS) {
    for (const quality of ['maj', 'min'] as const) {
      const rc: RelChord = { degree: offset, quality };
      if (diatonic.some((d) => sameChord(d, rc)) || mixDiatonic.some((d) => sameChord(d, rc))) continue;
      const w = ROOT_MOTION_WEIGHT[mod12(offset - prevRoot)] * FUNCTION_TRANSITION[prevFn]['T'] * CHROMATIC_MEDIANT_FACTOR;
      add(rc, w);
    }
  }

  return weights;
}
