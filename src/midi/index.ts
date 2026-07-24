// Public API surface for src/midi/. Matches SPEC.md's `src/midi/` section.
export type { MidiPort, MidiOut, WebMidiOutOptions } from './out.ts';
export { WebMidiOut } from './out.ts';

export { exportMidiFile } from './export.ts';
