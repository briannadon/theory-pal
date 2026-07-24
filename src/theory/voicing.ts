// Voicing engine: chord sequence -> concrete MIDI note numbers with basic voice
// leading. Block chords only (v1); strum/arp patterns are a stretch goal per
// PLAN.md. Deterministic: every choice is a nearest-candidate search with a
// fixed tie-break, no randomness.
//
// Algorithm: the bass voice (root, or the chord tone selected by `inversion`)
// is placed nearest the previous chord's bass note (or `center` for the first
// chord), which is what "keep the root or specified inversion in the bass"
// means in practice — it fixes which chord tone is lowest, while the octave
// that tone lands in is still free to move for smoothness. Each remaining
// chord tone is then placed in whichever octave, within the register window
// and above the bass, lies closest to the nearest not-yet-claimed note of the
// previous chord (greedy nearest-neighbor assignment) — this is what minimizes
// total semitone movement between adjacent chords.
import { chordIntervals, type AbsChord } from './chords.ts';

export interface VoicedChord {
  notes: number[]; // MIDI note numbers, sorted ascending
}

export interface VoiceOpts {
  center?: number;
  low?: number;
  high?: number;
}

const DEFAULT_CENTER = 60;
const DEFAULT_LOW = 48;
const DEFAULT_HIGH = 84;

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** All octave transpositions of pitch class `pc` that fall within [low, high]. */
function candidatesInWindow(pc: number, low: number, high: number): number[] {
  const base = mod12(pc);
  const out: number[] = [];
  const kMin = Math.ceil((low - base) / 12);
  const kMax = Math.floor((high - base) / 12);
  for (let k = kMin; k <= kMax; k++) out.push(base + 12 * k);
  return out;
}

function nearest(candidates: number[], target: number): number {
  let best = candidates[0];
  let bestCost = Math.abs(best - target);
  for (let i = 1; i < candidates.length; i++) {
    const cost = Math.abs(candidates[i] - target);
    if (cost < bestCost || (cost === bestCost && candidates[i] < best)) {
      best = candidates[i];
      bestCost = cost;
    }
  }
  return best;
}

export function voiceChord(c: AbsChord, prev?: VoicedChord, opts?: VoiceOpts): VoicedChord {
  const center = opts?.center ?? DEFAULT_CENTER;
  const low = opts?.low ?? DEFAULT_LOW;
  const high = opts?.high ?? DEFAULT_HIGH;

  const intervals = chordIntervals(c.quality, c.mods);
  const invIndex = ((c.inversion ?? 0) % intervals.length + intervals.length) % intervals.length;
  // Bass tone first, then the remaining tones in ascending chord order (wrapping) —
  // the standard "bass, then up through the rest" ordering for an inversion.
  const rotated = [...intervals.slice(invIndex), ...intervals.slice(0, invIndex)];
  const pcs = rotated.map((iv) => mod12(c.root + iv));

  // Bass voice. Any pitch class has a candidate within (bassNote, bassNote+12],
  // so reserving 12 semitones of headroom below `high` guarantees every upper
  // voice can find an in-window candidate strictly above the bass.
  const bassTarget = prev ? prev.notes[0] : center;
  const bassCandidates = candidatesInWindow(pcs[0], low, high);
  const bassCandidatesWithHeadroom = bassCandidates.filter((n) => n <= high - 12);
  const bassPool =
    bassCandidatesWithHeadroom.length > 0
      ? bassCandidatesWithHeadroom
      : bassCandidates.length > 0
        ? bassCandidates
        : [pcs[0]];
  const bassNote = nearest(bassPool, bassTarget);

  // Pool of previous notes available to "attract" upper voices, so voices don't
  // all collapse onto the single closest previous note.
  const pool = prev ? prev.notes.slice() : [];
  const notes: number[] = [bassNote];

  for (let i = 1; i < pcs.length; i++) {
    const pc = pcs[i];
    let candidates = candidatesInWindow(pc, low, high).filter((n) => n > bassNote);
    if (candidates.length === 0) {
      // Degenerate case (narrow window): fall back to the nearest transposition
      // above the bass even if it slightly exceeds the window.
      const all = candidatesInWindow(pc, low - 24, high + 24).filter((n) => n > bassNote);
      candidates = all.length ? all : [bassNote + 12];
    }

    if (pool.length > 0) {
      // Choose the candidate minimizing distance to its nearest pool note.
      let bestCandidate = candidates[0];
      let bestCost = Infinity;
      let bestPoolIdx = -1;
      for (const cand of candidates) {
        for (let p = 0; p < pool.length; p++) {
          const cost = Math.abs(cand - pool[p]);
          if (cost < bestCost || (cost === bestCost && cand < bestCandidate)) {
            bestCost = cost;
            bestCandidate = cand;
            bestPoolIdx = p;
          }
        }
      }
      notes.push(bestCandidate);
      if (bestPoolIdx >= 0) pool.splice(bestPoolIdx, 1);
    } else {
      notes.push(nearest(candidates, center));
    }
  }

  return { notes: Array.from(new Set(notes)).sort((a, b) => a - b) };
}

export function voiceProgression(chords: AbsChord[], opts?: VoiceOpts): VoicedChord[] {
  const result: VoicedChord[] = [];
  let prev: VoicedChord | undefined;
  for (const c of chords) {
    const voiced = voiceChord(c, prev, opts);
    result.push(voiced);
    prev = voiced;
  }
  return result;
}
