// Web MIDI output (SPEC.md `src/midi/`). CRITICAL (PLAN.md "Firefox
// specifics"): `requestAccess()` must only ever be invoked from a
// user-gesture handler (e.g. a click in the port picker), never on module
// import or page load. Firefox gates Web MIDI behind a per-site "site
// permission add-on" it prompts the user to install on first request, and it
// auto-denies access outright when no MIDI device is currently visible to the
// OS — on a setup that only uses a virtual ALSA/JACK port, that port must
// exist before this is called. This module never calls
// `navigator.requestMIDIAccess` itself except inside `requestAccess()`.
//
// The app must stay fully usable when MIDI is denied, unsupported, or no
// device is present: `available` reports false and every other method
// no-ops safely — nothing here throws or bubbles an exception to the UI.
/** Channels the app sends on. Chords and melody are separated so a DAW or
 * hardware synth can route them to different instruments, and so each can be
 * given its own level. Zero-based, as MIDI status bytes are; a DAW will
 * display these as channels 1 and 2. */
export const MIDI_CHANNEL = { chords: 0, melody: 1 } as const;

export interface MidiPort {
  id: string;
  name: string;
  manufacturer?: string;
}

export interface MidiOut {
  /** Call ONLY from a user-gesture handler. Resolves to the list of
   * available output ports; resolves to `[]` (never rejects) if access is
   * denied, unsupported, or the environment has no MIDI devices. */
  requestAccess(): Promise<MidiPort[]>;
  selectPort(id: string): void;
  /**
   * Send a chord's note-ons, and their matching note-offs `durationMs` later.
   * When `whenMs` is given (a `performance.now()`-timebase timestamp — the
   * unit Web MIDI's `send(data, timestamp)` expects) both the note-ons and
   * note-offs are scheduled via the API's own timestamped delivery rather
   * than a JS timer; omitted, the notes fire as soon as possible and the
   * note-off is timed from `now()`.
   *
   * `channel` is zero-based; see MIDI_CHANNEL.
   */
  sendChord(
    notes: number[],
    durationMs: number,
    velocity?: number,
    whenMs?: number,
    channel?: number,
  ): void;
  /** Channel volume (CC 7), 0-1. The natural MIDI meaning of a mixer fader:
   * it changes the receiving instrument's level without touching the
   * velocities, which stay expressive. */
  setVolume(channel: number, level: number): void;
  /** MIDI panic: silence the selected output immediately, canceling any
   * still-queued scheduled messages where the runtime supports it. Always
   * safe to call, including when nothing is currently sounding. */
  stopAll(): void;
  readonly available: boolean;
}

export interface WebMidiOutOptions {
  /** Injectable seam for tests; defaults to `navigator.requestMIDIAccess`. */
  requestMIDIAccessFn?: (options?: MIDIOptions) => Promise<MIDIAccess>;
  /** Injectable wall clock (`performance.now()`-timebase), for computing the
   * immediate note-off fallback when `sendChord` is called without `whenMs`. */
  now?: () => number;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const CC_ALL_SOUND_OFF = 120;
const CC_ALL_NOTES_OFF = 123;
const CC_CHANNEL_VOLUME = 7;
const MAX_CC = 127;
const DEFAULT_VELOCITY = 100;

export class WebMidiOut implements MidiOut {
  private readonly requestMIDIAccessFn: (options?: MIDIOptions) => Promise<MIDIAccess>;
  private readonly now: () => number;

  private access: MIDIAccess | null = null;
  private output: MIDIOutput | null = null;
  private _available = false;

  constructor(options?: WebMidiOutOptions) {
    this.requestMIDIAccessFn = options?.requestMIDIAccessFn ?? ((opts) => navigator.requestMIDIAccess(opts));
    this.now = options?.now ?? (() => performance.now());
  }

  get available(): boolean {
    return this._available;
  }

  async requestAccess(): Promise<MidiPort[]> {
    try {
      const access = await this.requestMIDIAccessFn({ sysex: false });
      this.access = access;
      this._available = true;
      return this.listPorts();
    } catch {
      // Denied, unsupported, or (Firefox) auto-denied for lack of a visible
      // device. Degrade quietly: no throw, just report unavailable.
      this.access = null;
      this._available = false;
      return [];
    }
  }

  private listPorts(): MidiPort[] {
    if (!this.access) return [];
    const ports: MidiPort[] = [];
    for (const output of this.access.outputs.values()) {
      ports.push({ id: output.id, name: output.name ?? output.id, manufacturer: output.manufacturer ?? undefined });
    }
    return ports;
  }

  selectPort(id: string): void {
    if (!this.access) return;
    this.output = this.access.outputs.get(id) ?? null;
  }

  sendChord(
    notes: number[],
    durationMs: number,
    velocity = DEFAULT_VELOCITY,
    whenMs?: number,
    channel = MIDI_CHANNEL.chords,
  ): void {
    if (!this.output || notes.length === 0) return;
    const ch = channel & 0x0f;
    const offAt = whenMs !== undefined ? whenMs + durationMs : this.now() + durationMs;
    for (const note of notes) {
      this.output.send([NOTE_ON | ch, note & 0x7f, velocity & 0x7f], whenMs);
    }
    for (const note of notes) {
      this.output.send([NOTE_OFF | ch, note & 0x7f, 0], offAt);
    }
  }

  setVolume(channel: number, level: number): void {
    if (!this.output) return;
    const value = Math.round(Math.max(0, Math.min(1, level)) * MAX_CC);
    this.output.send([CONTROL_CHANGE | (channel & 0x0f), CC_CHANNEL_VOLUME, value]);
  }

  stopAll(): void {
    if (!this.output) return;
    // Not in every TS DOM lib version, but present on real MIDIOutput
    // instances — cancels anything still queued from timestamped sendChord calls.
    (this.output as unknown as { clear?: () => void }).clear?.();
    // Panic every channel the app sends on, not just the first: a lead note
    // left hanging on the melody channel is exactly what Stop must clear.
    for (const ch of Object.values(MIDI_CHANNEL)) {
      this.output.send([CONTROL_CHANGE | ch, CC_ALL_SOUND_OFF, 0]);
      this.output.send([CONTROL_CHANGE | ch, CC_ALL_NOTES_OFF, 0]);
    }
  }
}
