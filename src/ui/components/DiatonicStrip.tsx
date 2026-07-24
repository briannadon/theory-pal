// The in-key chord row. Rather than picking one prebuilt family (triads /
// 7ths / sus), the user stacks independent modifiers onto the key's diatonic
// chords and the whole row re-renders: sus2 and sus4 are mutually exclusive
// (both replace the third, so only one can win), while 7 and 9 are free.
//
// The 7 toggle is not a `ChordMods` field: "add the 7th" means *this degree's
// diatonic 7th* — V gets a dom7, I a maj7 — which only the key knows, so it
// selects the 7th-chord set from `diatonicChords` instead. sus and 9 are
// key-independent alterations and ride along as mods.
import { useState } from 'react';
import {
  chordName,
  diatonicChords,
  romanNumeral,
  toAbsolute,
  type ChordMods,
  type Key,
  type RelChord,
} from '../../theory/index.ts';
import { StripCell } from './StripCell.tsx';

export interface DiatonicStripProps {
  keyValue: Key;
  onAudition: (chord: RelChord) => void;
}

type Sus = 2 | 4 | null;

export function DiatonicStrip({ keyValue, onAudition }: DiatonicStripProps) {
  const [sus, setSus] = useState<Sus>(null);
  const [seventh, setSeventh] = useState(false);
  const [ninth, setNinth] = useState(false);

  const mods: ChordMods | undefined =
    sus === null && !ninth ? undefined : { ...(sus !== null && { sus }), ...(ninth && { ninth }) };

  const chords: RelChord[] = diatonicChords(keyValue, seventh).map((rc) =>
    mods ? { ...rc, mods } : rc,
  );

  // Clicking the active sus clears it; clicking the other one swaps.
  const toggleSus = (value: 2 | 4) => setSus((cur) => (cur === value ? null : value));

  const modKey = `${sus ?? 'x'}-${seventh ? '7' : ''}-${ninth ? '9' : ''}`;

  return (
    <section className="tp-strip">
      <div className="tp-strip__header">
        <span className="tp-strip__eyebrow">In key</span>
        <div className="tp-size-group" role="group" aria-label="Chord modifiers">
          <button
            type="button"
            className="tp-size-btn"
            aria-pressed={sus === 2}
            onClick={() => toggleSus(2)}
          >
            sus2
          </button>
          <button
            type="button"
            className="tp-size-btn"
            aria-pressed={sus === 4}
            onClick={() => toggleSus(4)}
          >
            sus4
          </button>
          <button
            type="button"
            className="tp-size-btn"
            aria-pressed={seventh}
            onClick={() => setSeventh((v) => !v)}
          >
            7
          </button>
          <button
            type="button"
            className="tp-size-btn"
            aria-pressed={ninth}
            onClick={() => setNinth((v) => !v)}
          >
            9
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
              key={`${modKey}-${i}`}
              id={`diatonic-${modKey}-${i}`}
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
