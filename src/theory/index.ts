// Public API surface for src/theory/. Pure TS, no DOM, no React, no framework
// imports — must stay portable to a plugin/DAW context later (see PLAN.md
// "Porting path"). Matches the contract in SPEC.md's `src/theory/` section.
export type { ScaleId, Scale } from './scales.ts';
export { getScale, allScales } from './scales.ts';

export type { PitchClass, ChordQuality, ChordMods, ChordShape, Key, RelChord, AbsChord } from './chords.ts';
export {
  QUALITY_INTERVALS,
  stateKey,
  parseStateKey,
  toAbsolute,
  toRelative,
  isDiatonic,
  diatonicChords,
  chordPitches,
  chordIntervals,
  chordShape,
  extensionSpelling,
  hasSeventh,
  withSeventh,
  withoutSeventh,
} from './chords.ts';

export { noteName, chordName } from './pitch.ts';
export { romanNumeral } from './roman.ts';

export type { VoicedChord, VoiceOpts } from './voicing.ts';
export { voiceChord, voiceProgression } from './voicing.ts';

export type { NoteEvent, ArpPattern, ArpRate, BarStyle } from './pattern.ts';
export { renderBar, DEFAULT_BAR_STYLE } from './pattern.ts';

export type { GenerateMelodyOptions } from './generate.ts';
export { generateMelody } from './generate.ts';

export type { MelodyNote, MelodyLane } from './melody.ts';
export {
  MELODY_BASE_MIDI,
  MELODY_ROWS,
  emptyMelody,
  melodyPitchToMidi,
  melodyRowKind,
  melodyToBars,
  setMelodyResolution,
  addMelodyNote,
  removeMelodyNote,
  clampMelody,
} from './melody.ts';
