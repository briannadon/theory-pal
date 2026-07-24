// Procedural melody generation over an existing progression.
//
// Not a trained model — the corpus behind `model/` is chords only, with no
// melodic data — but not invented either. The pitch scoring is a port of
// Temperley's RPK model of melody perception (ISMIR 2006 / Cognitive Science
// 2008), whose parameters were fit to the ~6,000 European folk melodies of
// the Essen Folksong Collection. RPK says a melody's next note is governed by
// the product of three distributions:
//
//   Range     — a normal distribution around a central pitch, which keeps the
//               line in one tessitura. Essen melodies span 13.6 semitones from
//               lowest to highest note on average, which is where MAX_SPAN and
//               the range width below come from.
//   Proximity — a normal distribution centered on the *previous* pitch. In
//               Essen, more than half of all melodic intervals are 2 semitones
//               or less; PROXIMITY_SIGMA is set so this model agrees.
//   Key       — the scale-degree distribution of the corpus (Temperley's
//               figure 1, reproduced in KEY_PROFILE_*), which is why the
//               tonic, third and fifth turn up more than the seventh.
//
// Working in log space, a product of probabilities is a sum of penalties, so
// `scorePitch` adds one term per factor and the cheapest candidate wins.
//
// Two consequences worth knowing, because they explain rules that are
// *absent* here:
//
//   - Post-skip reversal (a leap tends to be answered by a change of
//     direction) needs no rule of its own. Von Hippel & Huron (2000) showed
//     it falls out of tessitura: a skip lands near the edge of the range, and
//     the range term then pulls the next note back. Adding an explicit
//     gap-fill rule on top would double-count it.
//   - The melodic arch — phrases peak near or just past their middle
//     (Huron 1996) — is applied by drifting the *central pitch* across the
//     phrase rather than by scoring contour directly.
//
// On top of RPK sit the things RPK doesn't model, because it has no harmony
// or rhythm: chord tones are required on strong beats, non-chord tones are
// rewarded for resolving by step, and rhythm comes from a small library of
// hand-written cells reused across bars (AAAB). The cells are weighted toward
// the sparse end with explicit rests — a singable line breathes, and a melody
// that places a note on every eighth is the main way generators sound busy.
//
// `surprise` (0-1) does two things: it unlocks *which* candidates are legal
// (SURPRISE_GATES) and it makes the picker take the second- or third-best
// candidate now and then, spending a per-phrase budget so strangeness tracks
// the slider instead of clumping into one bar.
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
  /** Pitch window to write in, semitones above the tonic. The generated line
   * additionally spans no more than MAX_SPAN within this window. */
  lowPitch?: number;
  highPitch?: number;
}

/** Thresholds at which each liberty unlocks, and how fast it ramps in. Low
 * settings bend only the gentle rules; the harsh ones need real conviction. */
const SURPRISE_GATES = {
  rhythmVariation: 0.1,
  density: 0.2, // busier rhythm cells become available
  appoggiatura: 0.3, // non-chord tone landing *on* a strong beat
  wideLeap: 0.4,
  unresolved: 0.5, // leave a non-chord tone by leap
  chromatic: 0.6, // step outside the scale entirely
  abandonTarget: 0.8, // don't land the phrase on a stable tone
} as const;

// Essen scale-degree distributions (Temperley 2006, figure 1), indexed by
// semitones above the tonic. Used as the K in RPK: the reason a line gravitates
// to 1, 3 and 5 rather than wandering the scale evenly.
const KEY_PROFILE_MAJOR = [
  0.184, 0.001, 0.155, 0.003, 0.191, 0.109, 0.005, 0.214, 0.006, 0.078, 0.004, 0.055,
];
const KEY_PROFILE_MINOR = [
  0.192, 0.005, 0.149, 0.179, 0.002, 0.144, 0.002, 0.201, 0.038, 0.012, 0.053, 0.022,
];

/** Widest the finished line may span, lowest note to highest. Essen melodies
 * average 13.6 semitones; a hard cap here is what keeps a generated line
 * singable instead of sweeping the lane's full two octaves. */
const MAX_SPAN = 14;

/** Proximity spread, semitones. Chosen so that P(|interval| <= 2) is about
 * 0.55, matching Essen's "more than half of intervals are 2 semitones or
 * less". Small enough that leaps need a reason. */
const PROXIMITY_SIGMA = 2.5;

/** Range spread around the central pitch, semitones. Two sigma covers
 * MAX_SPAN/2, so the tessitura and the span cap describe the same shape. */
const RANGE_SIGMA = 3.5;

/** Weight on the key-profile term. Below 1 because the harmony rules
 * (chord tones on strong beats) already carry most of the tonal weight, and a
 * full-strength profile makes every line converge on the tonic triad. */
const W_KEY = 0.55;

const STEP_LIMIT = 2; // semitones; more than this is a leap
const AWKWARD_LEAPS = new Set([6, 10, 11]); // tritone, minor/major 7th
const W_AWKWARD = 4;
const W_REPEAT = 2.0; // repeats are idiomatic, just not the default move
const W_SPAN_VIOLATION = 40; // effectively a veto, but still rankable
const B_RESOLVE = 3.5; // reward a non-chord tone that steps into a chord tone
const B_TENDENCY = 2.5; // ...especially by semitone, upward

/** A rhythm cell: onsets and lengths in eighths, for an 8-step bar. A length
 * shorter than the gap to the next onset leaves a rest. */
interface Cell {
  notes: { at: number; len: number }[];
}

const SPARSE_CELLS: Cell[] = [
  { notes: [{ at: 0, len: 8 }] },
  {
    notes: [
      { at: 0, len: 4 },
      { at: 4, len: 4 },
    ],
  },
  {
    notes: [
      { at: 0, len: 3 },
      { at: 4, len: 4 },
    ],
  },
  {
    notes: [
      { at: 0, len: 6 },
      { at: 6, len: 2 },
    ],
  },
  {
    notes: [
      { at: 2, len: 2 },
      { at: 4, len: 4 },
    ],
  },
];

const MEDIUM_CELLS: Cell[] = [
  {
    notes: [
      { at: 0, len: 2 },
      { at: 2, len: 2 },
      { at: 4, len: 4 },
    ],
  },
  {
    notes: [
      { at: 0, len: 4 },
      { at: 4, len: 2 },
      { at: 6, len: 2 },
    ],
  },
  {
    notes: [
      { at: 0, len: 2 },
      { at: 3, len: 1 },
      { at: 4, len: 4 },
    ],
  },
  {
    notes: [
      { at: 0, len: 3 },
      { at: 3, len: 1 },
      { at: 4, len: 3 },
    ],
  },
];

const BUSY_CELLS: Cell[] = [
  {
    notes: [
      { at: 0, len: 1 },
      { at: 1, len: 1 },
      { at: 2, len: 2 },
      { at: 4, len: 4 },
    ],
  },
  {
    notes: [
      { at: 0, len: 2 },
      { at: 2, len: 1 },
      { at: 3, len: 1 },
      { at: 4, len: 2 },
      { at: 6, len: 2 },
    ],
  },
  {
    notes: [
      { at: 0, len: 1 },
      { at: 1, len: 1 },
      { at: 2, len: 2 },
      { at: 4, len: 2 },
      { at: 6, len: 2 },
    ],
  },
];

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

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

function pitchesInRange(pcs: number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (let p = low; p <= high; p++) if (pcs.includes(mod12(p))) out.push(p);
  return out;
}

function chordTonePitches(chord: RelChord, low: number, high: number): number[] {
  const pcs = chordIntervals(chord.quality, chord.mods).map((iv) => mod12(chord.degree + iv));
  return pitchesInRange(pcs, low, high);
}

/** Strong beats: the downbeat and the halfway point of the bar. */
function isStrong(stepInBar: number, stepsPerBar: number): boolean {
  return stepInBar % (stepsPerBar / 2) === 0;
}

interface ScoreContext {
  previous: number | null;
  /** How many times the previous pitch has already been restated. Repeats are
   * idiomatic once; a fourth G in a row is a stuck line, so the penalty
   * escalates rather than being flat. */
  repeatRun: number;
  previousWasChordTone: boolean;
  /** Central pitch of the range term, drifting along the phrase's arch. */
  center: number;
  chordTones: number[];
  keyProfile: number[];
  /** Extremes used so far, for the span cap. */
  lowUsed: number;
  highUsed: number;
  /** How far the leap and resolution rules are relaxed, 0-1 each, from the
   * corresponding surprise gates. */
  leapRelaxation: number;
  resolutionRelaxation: number;
}

/** Negative log-likelihood, near enough: one term per RPK factor plus the
 * harmonic terms RPK has no notion of. Lower is better. */
function scorePitch(candidate: number, ctx: ScoreContext): number {
  // R: stay in the tessitura. This term is also what produces post-skip
  // reversal, so no separate gap-fill rule exists (von Hippel & Huron 2000).
  let score = ((candidate - ctx.center) ** 2) / (2 * RANGE_SIGMA ** 2);

  // K: corpus scale-degree weighting.
  const profile = ctx.keyProfile[mod12(candidate)] || 0.0005;
  score += -Math.log(profile) * W_KEY;

  // Span cap: never let the finished line sweep more than MAX_SPAN.
  const low = Math.min(ctx.lowUsed, candidate);
  const high = Math.max(ctx.highUsed, candidate);
  if (high - low > MAX_SPAN) score += W_SPAN_VIOLATION;

  if (ctx.previous === null) return score;

  // P: small intervals dominate.
  const interval = candidate - ctx.previous;
  const size = Math.abs(interval);
  score += (interval ** 2) / (2 * PROXIMITY_SIGMA ** 2);

  if (size === 0) score += W_REPEAT * (1 + ctx.repeatRun);
  if (AWKWARD_LEAPS.has(size)) score += W_AWKWARD * (1 - ctx.leapRelaxation);

  // A dissonance earns its place by resolving stepwise into the chord. As the
  // "unresolved" gate opens, that pull weakens and a non-chord tone may be
  // abandoned by leap.
  if (!ctx.previousWasChordTone && size <= STEP_LIMIT && ctx.chordTones.includes(candidate)) {
    const pull = 1 - ctx.resolutionRelaxation;
    score -= B_RESOLVE * pull;
    if (interval === 1) score -= B_TENDENCY * pull; // leading-tone style resolution
  }

  return score;
}

/** Pick by score, taking a deliberately worse candidate when the surprise
 * budget allows — that is what "break a rule" means here. */
function choose(
  candidates: number[],
  ctx: ScoreContext,
  liberty: boolean,
  seed: number,
  bar: number,
  step: number,
): number {
  if (candidates.length === 0) return ctx.previous ?? Math.round(ctx.center);
  const ranked = candidates
    .map((p) => ({ p, s: scorePitch(p, ctx) }))
    .sort((a, b) => a.s - b.s || a.p - b.p);
  if (!liberty || ranked.length === 1) return ranked[0].p;
  const depth = 1 + Math.floor(hashRandom(seed, bar, step, 20) * Math.min(2, ranked.length - 1));
  return ranked[depth].p;
}

/**
 * Central pitch for a bar: the melodic arch. Huron (1996) found phrases peak
 * near or just past their middle, so this rises to a peak at ~55% of the
 * phrase and settles back, moving the whole tessitura rather than forcing
 * individual notes.
 */
function archCenter(bar: number, barCount: number, low: number, high: number): number {
  const middle = (low + high) / 2;
  if (barCount <= 1) return middle;
  const t = bar / (barCount - 1);
  const peak = 0.55;
  const shape = t <= peak ? t / peak : 1 - (t - peak) / (1 - peak);
  const amplitude = Math.min(4, (high - low) / 4);
  return middle - amplitude * 0.5 + amplitude * shape;
}

function pickCell(seed: number, surprise: number): Cell {
  const roll = hashRandom(seed, 0);
  const busier = gateStrength(surprise, SURPRISE_GATES.density);
  const pick = (cells: Cell[], salt: number) =>
    cells[Math.floor(hashRandom(seed, salt) * cells.length)];
  // Below the density gate the busy cells are out of reach entirely: a note
  // on every eighth is what makes generated melodies sound frantic, and it
  // should take a deliberate turn of the slider to get there.
  if (busier === 0) return roll < 0.68 ? pick(SPARSE_CELLS, 1) : pick(MEDIUM_CELLS, 2);
  const sparseShare = 0.62 - busier * 0.32;
  if (roll < sparseShare) return pick(SPARSE_CELLS, 1);
  if (roll < sparseShare + 0.3) return pick(MEDIUM_CELLS, 2);
  return pick(BUSY_CELLS, 3);
}

/** Vary a cell: drop a note, displace one, or split a long one in two. */
function varyCell(cell: Cell, seed: number, bar: number): Cell {
  const notes = cell.notes.map((n) => ({ ...n }));
  if (notes.length === 0) return cell;
  const r = hashRandom(seed, bar, 12);

  if (r < 0.3 && notes.length > 1) {
    notes.splice(1 + Math.floor(hashRandom(seed, bar, 13) * (notes.length - 1)), 1);
  } else if (r < 0.6 && notes.length > 1) {
    const i = 1 + Math.floor(hashRandom(seed, bar, 14) * (notes.length - 1));
    const shift = notes[i].at + 1 < 8 ? 1 : -1;
    notes[i] = { at: notes[i].at + shift, len: Math.max(1, notes[i].len - shift) };
  } else {
    // Split the longest note in two: a held tone becomes a small gesture
    // without changing the phrase's shape.
    let longest = 0;
    for (let i = 1; i < notes.length; i++) if (notes[i].len > notes[longest].len) longest = i;
    const n = notes[longest];
    if (n.len >= 2) {
      const half = Math.floor(n.len / 2);
      notes.splice(longest, 1, { at: n.at, len: half }, { at: n.at + half, len: n.len - half });
    }
  }
  return { notes: notes.sort((a, b) => a.at - b.at) };
}

/** Legal non-chord tones for a weak beat: scale tones a step from where we
 * are, plus — once the chromatic gate opens — a semitone approach under a
 * chord tone, so even the outside notes stay idiomatic. */
function nonChordCandidates(
  scale: number[],
  chordTones: number[],
  previous: number | null,
  center: number,
  surprise: number,
  seed: number,
  bar: number,
  step: number,
): number[] {
  const anchor = previous ?? Math.round(center);
  const stepwise = scale.filter(
    (p) => p !== anchor && Math.abs(p - anchor) <= STEP_LIMIT && !chordTones.includes(p),
  );
  const out = stepwise;

  const chromatic = gateStrength(surprise, SURPRISE_GATES.chromatic);
  if (chromatic > 0 && hashRandom(seed, bar, step, 8) < chromatic * 0.4) {
    const approach = chordTones
      .map((t) => t - 1)
      .filter((p) => !scale.includes(p) && p !== previous && Math.abs(p - anchor) <= STEP_LIMIT + 1);
    if (approach.length > 0) return [...out, ...approach];
  }
  return out;
}

export function generateMelody(opts: GenerateMelodyOptions): MelodyLane {
  const {
    slots,
    key,
    stepsPerBar,
    surprise = 0,
    seed = 1,
    lowPitch = 0,
    highPitch = 19,
  } = opts;

  const barCount = slots.length;
  if (barCount === 0) return emptyMelody(stepsPerBar);

  const scaleIntervals = getScale(key.scale).intervals;
  const scale = pitchesInRange(scaleIntervals, lowPitch, highPitch);
  if (scale.length === 0) return emptyMelody(stepsPerBar);

  // Temperley's profiles are major/minor; pick by the scale's own third,
  // which is the distinction the profiles actually encode.
  const keyProfile = scaleIntervals.includes(4) ? KEY_PROFILE_MAJOR : KEY_PROFILE_MINOR;

  const cellScale = stepsPerBar / 8;
  const baseCell = pickCell(seed, surprise);

  // Leap and resolution rules loosen at their own gates (see SURPRISE_GATES),
  // scaled once here rather than re-derived per note.
  const leapRelaxation = gateStrength(surprise, SURPRISE_GATES.wideLeap) * 0.8;
  const resolutionRelaxation = gateStrength(surprise, SURPRISE_GATES.unresolved) * 0.9;

  const totalOnsets = Math.max(1, barCount * baseCell.notes.length);
  const budget = Math.round(surprise * totalOnsets * 0.6);
  let spent = 0;

  const notes: MelodyNote[] = [];
  let previous: number | null = null;
  let previousWasChordTone = true;
  let repeatRun = 0;
  let lowUsed = Infinity;
  let highUsed = -Infinity;

  for (let bar = 0; bar < barCount; bar++) {
    const chord = slots[bar];
    const chordTones = chord ? chordTonePitches(chord, lowPitch, highPitch) : scale;
    if (chordTones.length === 0) continue;

    // AAAB: reuse the cell, varying it on the last bar and — as surprise
    // rises — occasionally elsewhere too.
    const varyThisBar =
      bar === barCount - 1 ||
      hashRandom(seed, bar, 11) < gateStrength(surprise, SURPRISE_GATES.rhythmVariation) * 0.5;
    const cell = varyThisBar ? varyCell(baseCell, seed, bar) : baseCell;
    const center = archCenter(bar, barCount, lowPitch, highPitch);

    const cellNotes = cell.notes
      .map((n) => ({
        at: Math.round(n.at * cellScale),
        len: Math.max(1, Math.round(n.len * cellScale)),
      }))
      .filter((n) => n.at < stepsPerBar);

    for (let i = 0; i < cellNotes.length; i++) {
      const { at: stepInBar, len } = cellNotes[i];
      const strong = isStrong(stepInBar, stepsPerBar);
      const isLast = bar === barCount - 1 && i === cellNotes.length - 1;

      const liberty = spent < budget && hashRandom(seed, bar, stepInBar, 1) < surprise;
      const ctx: ScoreContext = {
        previous,
        repeatRun,
        previousWasChordTone,
        center,
        chordTones,
        keyProfile,
        lowUsed: Number.isFinite(lowUsed) ? lowUsed : (previous ?? Math.round(center)),
        highUsed: Number.isFinite(highUsed) ? highUsed : (previous ?? Math.round(center)),
        leapRelaxation,
        resolutionRelaxation,
      };

      let candidates: number[];
      if (isLast && !(liberty && surprise >= SURPRISE_GATES.abandonTarget)) {
        // Land somewhere stable: the chord's root, else any of its tones.
        const roots = chordTones.filter((p) => mod12(p) === mod12(chord?.degree ?? 0));
        candidates = roots.length > 0 ? roots : chordTones;
      } else if (strong && !(liberty && surprise >= SURPRISE_GATES.appoggiatura)) {
        candidates = chordTones;
      } else {
        // Weak beats offer chord tones *and* the scale tones a step away, and
        // let the scoring decide. Passing tones are not a liberty — they are
        // how a line moves by step at all. Restricting weak beats to chord
        // tones produces an arpeggio: consecutive chord tones are a third
        // apart, so the line can only leap.
        candidates = [
          ...chordTones,
          ...nonChordCandidates(scale, chordTones, previous, center, surprise, seed, bar, stepInBar),
        ];
      }

      // The span cap is a filter, not just a penalty: with a small candidate
      // pool every option can violate it, and then the penalty alone would
      // let the line creep wider.
      const withinSpan = candidates.filter(
        (p) =>
          !Number.isFinite(lowUsed) ||
          Math.max(highUsed, p) - Math.min(lowUsed, p) <= MAX_SPAN,
      );
      const pitch = choose(
        withinSpan.length > 0 ? withinSpan : candidates,
        ctx,
        liberty,
        seed,
        bar,
        stepInBar,
      );
      if (liberty) spent++;

      const start = bar * stepsPerBar + stepInBar;
      const nextStart =
        i + 1 < cellNotes.length ? bar * stepsPerBar + cellNotes[i + 1].at : (bar + 1) * stepsPerBar;
      notes.push({ pitch, start, length: Math.max(1, Math.min(len, nextStart - start)) });

      repeatRun = pitch === previous ? repeatRun + 1 : 0;
      previous = pitch;
      previousWasChordTone = chordTones.includes(pitch);
      lowUsed = Math.min(lowUsed, pitch);
      highUsed = Math.max(highUsed, pitch);
    }
  }

  return { stepsPerBar, notes };
}
