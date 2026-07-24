// Procedural melody generation over an existing progression.
//
// Not a trained model: the corpus behind `model/` is chords only, with no
// melodic data, so this is an explicit rule engine and is labeled as one in
// the UI. The rules are the standard ones for tonal melody writing:
//
//   1. Rhythm before pitch. Onsets come from a small library of hand-written
//      rhythm cells, not from per-step coin flips — independent sampling
//      produces noodling, while a repeated cell produces a phrase.
//   2. Chord tones on strong beats; non-chord tones between them.
//   3. A non-chord tone must be *approached and left by step*, which is what
//      makes it read as a passing or neighbor tone rather than a wrong note.
//   4. Prefer steps over leaps, cap leap size, and answer a leap by moving
//      back the other way (gap-fill).
//   5. Reuse the cell across bars (AAAB by default), re-snapped to each new
//      chord, and land the phrase on a stable tone.
//
// `surprise` (0-1) loosens those rules in stages — see SURPRISE_GATES. It
// spends a *budget* of violations spread across the phrase rather than
// flipping an independent coin per note, so the amount of strangeness tracks
// the slider and never clumps into one unlistenable bar.
//
// Determinism: every random decision draws from `hashRandom(seed, ...)` keyed
// by bar, step and decision class, so nudging the slider flips individual
// decisions in place — the melody you liked gets spicier — instead of
// rerolling something unrelated. Changing the seed is what rerolls.
import { chordIntervals, type Key, type RelChord } from './chords.ts';
import { emptyMelody, type MelodyLane, type MelodyNote } from './melody.ts';
import { getScale } from './scales.ts';

export interface GenerateMelodyOptions {
  slots: readonly (RelChord | null)[];
  key: Key;
  stepsPerBar: 8 | 16;
  /** 0 = obey every rule, 1 = break them as often as the gates allow. */
  surprise?: number;
  /** Reroll handle: same seed + same inputs = same melody. */
  seed?: number;
  /** Lane rows available, matching the editor (0 = tonic at base octave). */
  lowPitch?: number;
  highPitch?: number;
}

/** Thresholds at which each liberty unlocks, and how fast it ramps in. Low
 * settings bend only the gentle rules; the harsh ones need real conviction. */
const SURPRISE_GATES = {
  weakNonChordTone: 0.0,
  rhythmVariation: 0.1,
  appoggiatura: 0.3, // non-chord tone landing *on* a strong beat
  wideLeap: 0.4,
  unresolved: 0.5, // leave a non-chord tone by leap
  chromatic: 0.6, // step outside the scale entirely
  abandonTarget: 0.8, // don't land the phrase on a stable tone
} as const;

/** Onsets as step indices within a bar, written for an 8-step (1/8) bar and
 * scaled up for 1/16 lanes. Deliberately few and deliberately plain: variety
 * comes from varying one cell, not from having fifty. */
const RHYTHM_CELLS: number[][] = [
  [0, 2, 4, 6], // straight quarters
  [0, 2, 3, 4, 6], // quarters with a push
  [0, 1, 2, 4, 5, 6], // running eighths, resting on 4
  [0, 3, 4, 7], // syncopated
  [0, 2, 4, 5, 6, 7], // gap, then a run
  [0, 4], // half notes
  [2, 4, 6], // pickup-less, starts late
  [0, 1, 3, 4, 6, 7],
];

const MAX_STEP_LEAP = 7; // semitones; a fifth
const WIDE_LEAP = 12;

/** Deterministic uniform in [0,1) from a seed and a few integer coordinates.
 * A hash rather than a sequential PRNG so each decision is addressable: the
 * value at (bar 2, step 3, "stray") doesn't shift when an earlier decision
 * changes. */
function hashRandom(seed: number, ...coords: number[]): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (const c of coords) {
    h = Math.imul(h ^ (c + 0x165667b1), 0x27d4eb2d);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** How strongly a liberty applies at this surprise level: 0 below its gate,
 * ramping to 1 at surprise 1. */
function gateStrength(surprise: number, gate: number): number {
  if (surprise <= gate) return 0;
  return Math.min(1, (surprise - gate) / Math.max(0.15, 1 - gate));
}

function chordTonePitches(chord: RelChord, key: Key, low: number, high: number): number[] {
  const pcs = chordIntervals(chord.quality, chord.mods).map(
    (iv) => (((chord.degree + iv) % 12) + 12) % 12,
  );
  return pitchesInRange(pcs, key, low, high);
}

function scalePitches(key: Key, low: number, high: number): number[] {
  return pitchesInRange(getScale(key.scale).intervals, key, low, high);
}

function pitchesInRange(pcs: number[], _key: Key, low: number, high: number): number[] {
  const out: number[] = [];
  for (let p = low; p <= high; p++) {
    if (pcs.includes(((p % 12) + 12) % 12)) out.push(p);
  }
  return out;
}

function nearest(candidates: number[], target: number, avoid?: (p: number) => boolean): number {
  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    if (avoid?.(c)) continue;
    const cost = Math.abs(c - target);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
    }
  }
  return best;
}

/** Strong beats in an 8-step bar: the downbeat and the halfway point. */
function isStrong(stepInBar: number, stepsPerBar: number): boolean {
  const quarter = stepsPerBar / 4;
  return stepInBar % (quarter * 2) === 0;
}

export function generateMelody(opts: GenerateMelodyOptions): MelodyLane {
  const {
    slots,
    key,
    stepsPerBar,
    surprise = 0,
    seed = 1,
    lowPitch = 0,
    highPitch = 24,
  } = opts;

  const barCount = slots.length;
  if (barCount === 0) return emptyMelody(stepsPerBar);

  const scale = scalePitches(key, lowPitch, highPitch);
  if (scale.length === 0) return emptyMelody(stepsPerBar);

  const cellScale = stepsPerBar / 8;
  const baseCell = RHYTHM_CELLS[Math.floor(hashRandom(seed, 0) * RHYTHM_CELLS.length)];

  // One violation budget for the whole phrase, distributed across onsets
  // rather than rolled per note (see the header comment).
  const totalOnsets = barCount * baseCell.length;
  const budget = Math.round(surprise * totalOnsets * 0.6);
  let spent = 0;

  const notes: MelodyNote[] = [];
  let previous: number | null = null;
  let beforePrevious: number | null = null;
  let lastMotion = 0;

  for (let bar = 0; bar < barCount; bar++) {
    const chord = slots[bar];
    const chordTones = chord ? chordTonePitches(chord, key, lowPitch, highPitch) : scale;
    if (chordTones.length === 0) continue;

    // AAAB: reuse the cell, varying it on the last bar and — as surprise
    // rises — occasionally elsewhere too.
    const varyThisBar =
      bar === barCount - 1 ||
      hashRandom(seed, bar, 11) < gateStrength(surprise, SURPRISE_GATES.rhythmVariation) * 0.5;
    const cell = varyThisBar ? varyCell(baseCell, seed, bar) : baseCell;

    const onsets = cell.map((s) => Math.round(s * cellScale)).filter((s) => s < stepsPerBar);

    for (let i = 0; i < onsets.length; i++) {
      const stepInBar = onsets[i];
      const absoluteStep = bar * stepsPerBar + stepInBar;
      const strong = isStrong(stepInBar, stepsPerBar);
      const isLast = bar === barCount - 1 && i === onsets.length - 1;

      const roll = hashRandom(seed, bar, stepInBar, 1);
      const wantsLiberty = spent < budget && roll < surprise;

      let pitch: number;
      // The pool the pitch came from, so the anti-trill correction below can
      // pick a different note without breaking the rule that produced it.
      let pool: number[] = chordTones;

      if (isLast && !(wantsLiberty && surprise >= SURPRISE_GATES.abandonTarget)) {
        // Land somewhere stable: the tonic, or the current chord's root.
        const targets = chordTones.filter((p) => ((p % 12) + 12) % 12 === (chord?.degree ?? 0) % 12);
        pool = targets.length ? targets : chordTones;
        pitch = nearest(pool, previous ?? 12);
      } else if (strong && !(wantsLiberty && surprise >= SURPRISE_GATES.appoggiatura)) {
        pitch = pickChordTone(chordTones, previous, seed, bar, stepInBar, surprise);
      } else {
        const stray =
          wantsLiberty ||
          hashRandom(seed, bar, stepInBar, 2) <
            gateStrength(surprise, SURPRISE_GATES.weakNonChordTone) * 0.55;
        pitch = stray
          ? pickNonChordTone(scale, chordTones, previous, seed, bar, stepInBar, surprise)
          : pickChordTone(chordTones, previous, seed, bar, stepInBar, surprise);
        if (stray) pool = scale;
      }

      // Anti-trill: bouncing between two adjacent notes (D C D C D C) is the
      // one artifact these rules produce on their own, because "nearest chord
      // tone" and "step away from it" keep answering each other. If this note
      // would complete such a bounce, carry on in the same direction instead.
      if (
        beforePrevious !== null &&
        previous !== null &&
        pitch === beforePrevious &&
        Math.abs(pitch - previous) <= 2
      ) {
        const onward = pool.filter((p) => p !== pitch && p !== previous);
        if (onward.length > 0) pitch = nearest(onward, previous + (previous - pitch));
      }

      if (wantsLiberty) spent++;

      // Gap-fill: after a leap, prefer stepping back the other way.
      if (previous !== null) {
        const motion = pitch - previous;
        if (Math.abs(motion) > MAX_STEP_LEAP && Math.sign(motion) === Math.sign(lastMotion)) {
          const wide = gateStrength(surprise, SURPRISE_GATES.wideLeap);
          if (hashRandom(seed, bar, stepInBar, 3) > wide) {
            const pool = chordTones.length ? chordTones : scale;
            pitch = nearest(pool, previous - Math.sign(motion) * 2, (p) => p === previous);
          }
        }
        lastMotion = pitch - previous;
      }

      const nextOnset =
        i + 1 < onsets.length ? bar * stepsPerBar + onsets[i + 1] : (bar + 1) * stepsPerBar;
      notes.push({
        pitch,
        start: absoluteStep,
        length: Math.max(1, nextOnset - absoluteStep),
      });
      beforePrevious = previous;
      previous = pitch;
    }
  }

  return { stepsPerBar, notes };
}

function pickChordTone(
  chordTones: number[],
  previous: number | null,
  seed: number,
  bar: number,
  step: number,
  surprise: number,
): number {
  if (previous === null) {
    // Open somewhere in the middle of the available range rather than at its
    // floor, so the line has room to move in both directions.
    const mid = chordTones[Math.floor(chordTones.length / 2)];
    return mid;
  }
  // Never simply restate the previous note: a line that repeats a pitch on
  // consecutive onsets reads as a held note the rhythm keeps re-articulating,
  // not as melodic motion. `nearest` would otherwise always return it, since
  // the previous note is a chord tone at distance 0.
  const moving = chordTones.filter((p) => p !== previous);
  if (moving.length === 0) return chordTones[0];
  const near = moving.filter((p) => Math.abs(p - previous) <= MAX_STEP_LEAP);
  const pool = near.length > 0 ? near : moving;
  const wide = gateStrength(surprise, SURPRISE_GATES.wideLeap);
  if (wide > 0 && hashRandom(seed, bar, step, 4) < wide * 0.4) {
    const far = moving.filter((p) => Math.abs(p - previous) >= WIDE_LEAP);
    if (far.length > 0) return far[Math.floor(hashRandom(seed, bar, step, 5) * far.length)];
  }
  const idx = Math.floor(hashRandom(seed, bar, step, 6) * pool.length);
  // Bias toward the nearest option, taking the sampled one only sometimes.
  return hashRandom(seed, bar, step, 7) < 0.55 ? nearest(pool, previous) : pool[idx];
}

function pickNonChordTone(
  scale: number[],
  chordTones: number[],
  previous: number | null,
  seed: number,
  bar: number,
  step: number,
  surprise: number,
): number {
  const anchor = previous ?? chordTones[Math.floor(chordTones.length / 2)];

  // Chromatic liberty: a semitone approach to a chord tone, not a random
  // outside note — even the violations stay idiomatic.
  const chromatic = gateStrength(surprise, SURPRISE_GATES.chromatic);
  if (chromatic > 0 && hashRandom(seed, bar, step, 8) < chromatic * 0.35) {
    const target = nearest(chordTones, anchor);
    const below = target - 1;
    if (!scale.includes(below) && below !== previous) return below;
  }

  // Default: a scale tone a step away from where we are, which is also a step
  // away from a chord tone we can resolve into.
  const stepwise = scale.filter(
    (p) => Math.abs(p - anchor) > 0 && Math.abs(p - anchor) <= 2 && !chordTones.includes(p),
  );
  if (stepwise.length === 0) return nearest(chordTones, anchor, (p) => p === previous);

  const unresolved = gateStrength(surprise, SURPRISE_GATES.unresolved);
  const resolvable = stepwise.filter((p) =>
    chordTones.some((t) => Math.abs(t - p) <= 2 && t !== p),
  );
  const pool = resolvable.length > 0 && hashRandom(seed, bar, step, 9) > unresolved * 0.5
    ? resolvable
    : stepwise;
  return pool[Math.floor(hashRandom(seed, bar, step, 10) * pool.length)];
}

/** Vary a rhythm cell: displace an onset, drop one, or subdivide one. */
function varyCell(cell: number[], seed: number, bar: number): number[] {
  const r = hashRandom(seed, bar, 12);
  const out = cell.slice();
  if (out.length <= 2) return out;
  if (r < 0.34) {
    // Drop an interior onset.
    const i = 1 + Math.floor(hashRandom(seed, bar, 13) * (out.length - 1));
    out.splice(i, 1);
  } else if (r < 0.67) {
    // Displace an interior onset by one step.
    const i = 1 + Math.floor(hashRandom(seed, bar, 14) * (out.length - 1));
    out[i] = Math.min(7, out[i] + 1);
  } else {
    // Subdivide: add an onset in the largest gap.
    let bestGap = 0;
    let at = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i] - out[i - 1] > bestGap) {
        bestGap = out[i] - out[i - 1];
        at = i;
      }
    }
    if (bestGap >= 2) out.splice(at, 0, out[at - 1] + 1);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
