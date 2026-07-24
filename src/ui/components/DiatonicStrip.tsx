import { useState } from 'react';
import { chordName, diatonicChords, romanNumeral, toAbsolute, type ChordQuality, type Key, type RelChord } from '../../theory/index.ts';
import { StripCell } from './StripCell.tsx';

export interface DiatonicStripProps {
  keyValue: Key;
  onAudition: (chord: RelChord) => void;
}

type Flavor = 'triads' | 'sevenths' | 'sus';

export function DiatonicStrip({ keyValue, onAudition }: DiatonicStripProps) {
  const [flavor, setFlavor] = useState<Flavor>('triads');

  let chords: RelChord[];
  if (flavor === 'sevenths') {
    chords = diatonicChords(keyValue, true);
  } else if (flavor === 'sus') {
    const triads = diatonicChords(keyValue, false);
    chords = triads.map((rc, i) => {
      if (i === 4) return { degree: rc.degree, quality: 'dom7sus4' as ChordQuality };
      return { degree: rc.degree, quality: (i % 2 === 0 ? 'sus4' : 'sus2') as ChordQuality };
    });
  } else {
    chords = diatonicChords(keyValue, false);
  }

  return (
    <section className="tp-strip">
      <div className="tp-strip__header">
        <span className="tp-strip__eyebrow">In key</span>
        <div className="tp-size-group" role="group" aria-label="In-key chord family">
          <button
            type="button"
            className="tp-size-btn"
            aria-pressed={flavor === 'triads'}
            onClick={() => setFlavor('triads')}
          >
            Triads
          </button>
          <button
            type="button"
            className="tp-size-btn"
            aria-pressed={flavor === 'sevenths'}
            onClick={() => setFlavor('sevenths')}
          >
            7ths
          </button>
          <button
            type="button"
            className="tp-size-btn"
            aria-pressed={flavor === 'sus'}
            onClick={() => setFlavor('sus')}
          >
            Sus
          </button>
        </div>
        <span className="tp-strip__hint" style={{ marginLeft: 'auto' }}>
          click to hear · drag into the grid
        </span>
      </div>
      <div className="tp-strip__cells">
        {chords.map((chord, i) => {
          const roman = romanNumeral(chord, keyValue);
          const name = chordName(toAbsolute(chord, keyValue));
          return (
            <StripCell
              key={`${flavor}-${i}`}
              id={`diatonic-${flavor}-${i}`}
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
