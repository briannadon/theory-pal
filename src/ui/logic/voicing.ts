// Aligns the grid's relative chords onto voiced, absolute notes for
// audio/MIDI playback. All actual music theory (voice leading,
// relative->absolute conversion) is delegated to `theory/`; this module only
// handles the bookkeeping of skipping empty bars for voice-leading purposes
// and re-aligning the result back onto the original bar indices — the same
// approach `midi/export.ts` uses for `.mid` export, kept consistent here so
// playback and export sound alike.
import { toAbsolute, voiceProgression, type Key, type RelChord, type VoicedChord } from '../../theory/index.ts';

export function voiceGrid(slots: readonly (RelChord | null)[], key: Key): (VoicedChord | null)[] {
  const indices: number[] = [];
  const abs = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s !== null) {
      indices.push(i);
      abs.push(toAbsolute(s, key));
    }
  }
  const voiced = voiceProgression(abs);
  const out: (VoicedChord | null)[] = new Array(slots.length).fill(null);
  indices.forEach((barIndex, i) => {
    out[barIndex] = voiced[i];
  });
  return out;
}
