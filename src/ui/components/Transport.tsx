// Transport bar: Play/Stop controls, BPM input, Loop toggle, Piano toggle,
// Web MIDI port picker (request access on user click only), and Export .mid button.
import type { ArpPattern, ArpRate, BarStyle } from '../../theory/index.ts';
import type { MidiPort } from '../../midi/index.ts';
import type { MidiAccessStatus } from '../hooks/useMidiOut.ts';

// Playing styles offered in the transport. `sustain` is deliberately absent:
// it exists for .mid export (whole-bar chords) and reads as "nothing is
// happening" when auditioning.
const PATTERNS: { value: ArpPattern; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'up', label: 'Arp up' },
  { value: 'down', label: 'Arp down' },
  { value: 'updown', label: 'Arp up-down' },
  { value: 'downup', label: 'Arp down-up' },
  { value: 'random', label: 'Arp random' },
];

const RATES: ArpRate[] = ['1/4', '1/8', '1/16', '1/8t', '1/16t'];

export interface TransportProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  isLooping: boolean;
  onToggleLoop: () => void;
  isPianoEnabled: boolean;
  onTogglePiano: () => void;
  style: BarStyle;
  onStyleChange: (style: BarStyle) => void;
  midiStatus: MidiAccessStatus;
  midiPorts: MidiPort[];
  selectedMidiPortId: string | null;
  onRequestMidiAccess: () => void;
  onSelectMidiPort: (id: string) => void;
  onExportMidi: () => void;
  hasChordsInGrid: boolean;
}

export function Transport({
  isPlaying,
  onPlayPause,
  bpm,
  onBpmChange,
  isLooping,
  onToggleLoop,
  isPianoEnabled,
  onTogglePiano,
  style,
  onStyleChange,
  midiStatus,
  midiPorts,
  selectedMidiPortId,
  onRequestMidiAccess,
  onSelectMidiPort,
  onExportMidi,
  hasChordsInGrid,
}: TransportProps) {
  return (
    <footer className="tp-transport">
      <button
        type="button"
        className="tp-transport__play"
        onClick={onPlayPause}
        disabled={!hasChordsInGrid && !isPlaying}
        aria-label={isPlaying ? 'Stop playback' : 'Play progression'}
      >
        {isPlaying ? '■' : '▶'}
      </button>

      <div className="tp-transport__group">
        <label>
          BPM
          <input
            type="number"
            className="tp-tempo-input"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => {
              const val = Math.max(40, Math.min(240, Number(e.target.value) || 120));
              onBpmChange(val);
            }}
          />
        </label>
      </div>

      <button
        type="button"
        className="tp-toggle"
        aria-pressed={isLooping}
        onClick={onToggleLoop}
      >
        ↻ Loop
      </button>

      <button
        type="button"
        className="tp-toggle"
        aria-pressed={isPianoEnabled}
        onClick={onTogglePiano}
      >
        🎹 Piano
      </button>

      <div className="tp-transport__group">
        <select
          className="tp-midi-picker__select"
          value={style.pattern}
          aria-label="Chord playing style"
          onChange={(e) => onStyleChange({ ...style, pattern: e.target.value as ArpPattern })}
        >
          {PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="tp-midi-picker__select"
          value={style.rate}
          aria-label="Arpeggio rate"
          disabled={style.pattern === 'block'}
          onChange={(e) => onStyleChange({ ...style, rate: e.target.value as ArpRate })}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="tp-transport__spacer" />

      <div className="tp-midi-picker">
        {midiStatus === 'idle' || midiStatus === 'requesting' ? (
          <button
            type="button"
            className="tp-btn"
            onClick={onRequestMidiAccess}
            disabled={midiStatus === 'requesting'}
          >
            {midiStatus === 'requesting' ? 'Connecting MIDI…' : 'Enable MIDI Out'}
          </button>
        ) : midiStatus === 'granted' ? (
          midiPorts.length === 0 ? (
            <span className="tp-midi-status tp-midi-status--granted">MIDI active (no ports)</span>
          ) : (
            <select
              className="tp-midi-picker__select"
              value={selectedMidiPortId ?? ''}
              aria-label="MIDI Output Port"
              onChange={(e) => onSelectMidiPort(e.target.value)}
            >
              <option value="">No MIDI Out</option>
              {midiPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="tp-btn" onClick={onRequestMidiAccess}>
              Retry MIDI
            </button>
            <span className="tp-midi-status tp-midi-status--denied">Access denied</span>
          </div>
        )}
      </div>

      <button
        type="button"
        className="tp-btn tp-btn--accent"
        onClick={onExportMidi}
        disabled={!hasChordsInGrid}
      >
        Export .mid
      </button>
    </footer>
  );
}
