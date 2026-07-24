// Top strip: the 7 diatonic chords of the selected key/mode, always
// visible. Click auditions; drag adds to the grid (handled by dnd-kit at
// the TheoryPal level — this component only supplies draggable cells).
import { chordName, diatonicChords, romanNumeral, toAbsolute, type Key, type RelChord } from '../../theory/index.ts';
import { StripCell } from './StripCell.tsx';

export interface DiatonicStripProps {
  keyValue: Key;
  onAudition: (chord: RelChord) => void;
}

export function DiatonicStrip({ keyValue, onAudition }: DiatonicStripProps) {
  const chords = diatonicChords(keyValue);

  return (
    <section className="tp-strip">
      <div className="tp-strip__header">
        <span className="tp-strip__eyebrow">In key</span>
        <span className="tp-strip__hint">click to hear · drag into the grid</span>
      </div>
      <div className="tp-strip__cells">
        {chords.map((chord, i) => {
          const roman = romanNumeral(chord, keyValue);
          const name = chordName(toAbsolute(chord, keyValue));
          return (
            <StripCell
              key={i}
              id={`diatonic-${i}`}
              chord={chord}
              roman={roman}
              name={name}
              accent="diatonic"
              onAudition={onAudition}
              ariaLabel={`${roman}, ${name}. Click to audition, drag to add to the grid.`}
            />
          );
        })}
      </div>
    </section>
  );
}
