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
import { MelodyLane, type LaneSegment } from './MelodyLane.tsx';

export interface MelodySectionProps {
  lane: MelodyLaneData;
  keyValue: Key;
  /** The chord timeline: what sounds when, in beats. */
  segments: readonly LaneSegment[];
  /** Bars in the progression. The lane keeps its own even bar grid however
   * the chords above it are cut. */
  bars: number;
  playingSlot: number | null;
  hoveredSlot: number | null;
  onHoverSlot: (slot: number | null) => void;
  surprise: number;
  onSurpriseChange: (value: number) => void;
  onChange: (lane: MelodyLaneData) => void;
  onAuditionPitch: (pitch: number) => void;
  beatWidth: number;
}

const RESOLUTIONS: { value: 8 | 16; label: string }[] = [
  { value: 8, label: '1/8' },
  { value: 16, label: '1/16' },
];

export function MelodySection({
  lane,
  keyValue,
  segments,
  bars,
  playingSlot,
  hoveredSlot,
  onHoverSlot,
  surprise,
  onSurpriseChange,
  onChange,
  onAuditionPitch,
  beatWidth,
}: MelodySectionProps) {
  const hasChords = segments.some((s) => s.chord !== null);

  /** The chord sounding at a beat, and so at a lane step. The generator wants
   * both views: one chord per bar to shape the phrase, and the real chord at
   * each note for choosing its pitch. */
  const chordAtBeat = (beat: number): RelChord | null => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (beat >= segments[i].start - 1e-9) return segments[i].chord;
    }
    return null;
  };
  const beatsPerStep = 4 / lane.stepsPerBar;

  const generate = () => {
    onChange(
      generateMelody({
        slots: Array.from({ length: bars }, (_, bar) => chordAtBeat(bar * 4)),
        chordAtStep: (step) => chordAtBeat(step * beatsPerStep),
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
          hover a chord to see its tones
        </span>
      </div>

      <MelodyLane
        lane={lane}
        keyValue={keyValue}
        segments={segments}
        bars={bars}
        playingSlot={playingSlot}
        hoveredSlot={hoveredSlot}
        onHoverSlot={onHoverSlot}
        onChange={onChange}
        onAuditionPitch={onAuditionPitch}
        beatWidth={beatWidth}
      />
    </section>
  );
}
