// Melody lane plus its controls: resolution, the procedural generator, and
// the single "surprise" knob that loosens the generator's rules.
//
// One slider rather than a rack of rule toggles was a deliberate call: the
// individual liberties (weak-beat passing tones, appoggiaturas, wide leaps,
// chromatic approaches, abandoning the phrase-final target) unlock in stages
// as it rises, so there is one thing to turn and it always means "more".
// See theory/generate.ts for the staging.
import {
  generateMelody,
  setMelodyResolution,
  type Key,
  type MelodyLane as MelodyLaneData,
  type RelChord,
} from '../../theory/index.ts';
import { MelodyLane } from './MelodyLane.tsx';

export interface MelodySectionProps {
  lane: MelodyLaneData;
  keyValue: Key;
  slots: readonly (RelChord | null)[];
  playingBar: number | null;
  hoveredBar: number | null;
  onHoverBar: (bar: number | null) => void;
  surprise: number;
  onSurpriseChange: (value: number) => void;
  onChange: (lane: MelodyLaneData) => void;
  onAuditionPitch: (pitch: number) => void;
}

const RESOLUTIONS: { value: 8 | 16; label: string }[] = [
  { value: 8, label: '1/8' },
  { value: 16, label: '1/16' },
];

export function MelodySection({
  lane,
  keyValue,
  slots,
  playingBar,
  hoveredBar,
  onHoverBar,
  surprise,
  onSurpriseChange,
  onChange,
  onAuditionPitch,
}: MelodySectionProps) {
  const hasChords = slots.some((s) => s !== null);

  const generate = () => {
    onChange(
      generateMelody({
        slots,
        key: keyValue,
        stepsPerBar: lane.stepsPerBar,
        surprise,
        // A fresh seed per press is what makes this a reroll; the slider then
        // morphs that melody rather than replacing it.
        seed: Math.floor(Math.random() * 1e9),
      }),
    );
  };

  return (
    <section className="tp-strip">
      <div className="tp-strip__header">
        <span className="tp-strip__eyebrow">Melody</span>

        <div className="tp-size-group" role="group" aria-label="Melody grid resolution">
          {RESOLUTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              className="tp-size-btn"
              aria-pressed={lane.stepsPerBar === r.value}
              onClick={() => onChange(setMelodyResolution(lane, r.value))}
            >
              {r.label}
            </button>
          ))}
        </div>

        <button type="button" className="tp-btn" onClick={generate} disabled={!hasChords}>
          ⚄ Generate
        </button>

        <label className="tp-lane__slider">
          surprise
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(surprise * 100)}
            aria-label="Melody surprise"
            onChange={(e) => onSurpriseChange(Number(e.target.value) / 100)}
          />
          <span className="tp-lane__slider-value">{Math.round(surprise * 100)}%</span>
        </label>

        <button
          type="button"
          className="tp-btn"
          onClick={() => onChange({ ...lane, notes: [] })}
          disabled={lane.notes.length === 0}
        >
          Clear
        </button>

        <span className="tp-strip__hint" style={{ marginLeft: 'auto' }}>
          click to add · drag to move · drag the right edge to lengthen · click a note to delete ·
          hover a bar to see its chord tones
        </span>
      </div>

      <MelodyLane
        lane={lane}
        keyValue={keyValue}
        slots={slots}
        playingBar={playingBar}
        hoveredBar={hoveredBar}
        onHoverBar={onHoverBar}
        onChange={onChange}
        onAuditionPitch={onAuditionPitch}
      />
    </section>
  );
}
