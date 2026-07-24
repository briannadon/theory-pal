// Public API surface for src/midi/. Matches SPEC.md's `src/midi/` section.
export type { MidiPort, MidiOut, WebMidiOutOptions } from './out.ts';
export { WebMidiOut, MIDI_CHANNEL } from './out.ts';

export { exportMidiFile } from './export.ts';
export type { ExportOptions } from './export.ts';
