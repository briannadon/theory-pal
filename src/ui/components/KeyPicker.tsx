// Tonic (12 pitch classes) + scale picker. Grouped scale list (diatonic
// modes / harmonic minor family / melodic minor family) comes from
// ui/logic/scaleGroups.ts, which itself only reorganizes theory/'s own
// scale table — no new theory logic lives here.
import { noteName, type Key, type PitchClass, type ScaleId } from '../../theory/index.ts';
import { scaleGroups } from '../logic/scaleGroups.ts';

export interface KeyPickerProps {
  value: Key;
  onChange: (key: Key) => void;
}

const TONICS: PitchClass[] = Array.from({ length: 12 }, (_, i) => i);
const GROUPS = scaleGroups();

export function KeyPicker({ value, onChange }: KeyPickerProps) {
  return (
    <div className="tp-key-picker">
      <span className="tp-key-picker__label">Key</span>
      <div className="tp-tonics" role="group" aria-label="Tonic">
        {TONICS.map((pc) => (
          <button
            key={pc}
            type="button"
            className="tp-tonic-btn"
            aria-pressed={pc === value.tonic}
            onClick={() => onChange({ ...value, tonic: pc })}
          >
            {noteName(pc, 'maj')}
          </button>
        ))}
      </div>
      <select
        className="tp-scale-select"
        value={value.scale}
        aria-label="Scale"
        onChange={(e) => onChange({ ...value, scale: e.target.value as ScaleId })}
      >
        {GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.scales.map((scale) => (
              <option key={scale.id} value={scale.id}>
                {scale.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
