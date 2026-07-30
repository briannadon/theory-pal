// The in-key chord row. Rather than picking one prebuilt family (triads /
// 7ths / sus), the user stacks independent modifiers onto the key's diatonic
// chords and the whole row re-renders. Every toggle is free to combine,
// including sus2 with sus4 — both replace the third, and together they give
// the 2nd and the 4th over the fifth.
//
// The 7 toggle is not a `ChordMods` field: "add the 7th" means *this degree's
// diatonic 7th* — V gets a dom7, I a maj7 — which only the key knows, so it
// selects the 7th-chord set from `diatonicChords` instead. The rest are
// key-independent alterations and ride along as mods.
//
// The toggles themselves are `ModifierBar`, shared with each grid slot's
// popover so the two can't drift apart.
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
import { ModifierBar, NO_MODIFIERS, type ChordModifier, type ModifierState } from './ModifierBar.tsx';
import { StripCell } from './StripCell.tsx';

export interface DiatonicStripProps {
  keyValue: Key;
  onAudition: (chord: RelChord) => void;
}

export function DiatonicStrip({ keyValue, onAudition }: DiatonicStripProps) {
  const [mods, setMods] = useState<ModifierState>(NO_MODIFIERS);

  const chordMods: ChordMods = {
    ...(mods.sus2 && { sus2: true }),
    ...(mods.sus4 && { sus4: true }),
    ...(mods.sixth && { sixth: true }),
    ...(mods.ninth && { ninth: true }),
    ...(mods.eleventh && { eleventh: true }),
    ...(mods.thirteenth && { thirteenth: true }),
  };
  const hasMods = Object.keys(chordMods).length > 0;

  const chords: RelChord[] = diatonicChords(keyValue, mods.seventh).map((rc) =>
    hasMods ? { ...rc, mods: chordMods } : rc,
  );

  const toggle = (modifier: ChordModifier) =>
    setMods((current) => ({ ...current, [modifier]: !current[modifier] }));

  // Re-key the cells whenever the modifier set changes, so a restyled row
  // mounts fresh rather than animating a chord into a different chord.
  const modKey = Object.entries(mods)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join('-');

  return (
    <section className="tp-strip">
      <div className="tp-strip__header">
        <div className="tp-panel__legend">
          <span className="tp-strip__eyebrow">In key</span>
          <span className="tp-strip__hint">
            <span className="tp-hint--fine">Click to hear. Drag into the grid.</span>
            <span className="tp-hint--coarse">Tap to hear. Hold, then drag into the grid.</span>
          </span>
        </div>
        <div className="tp-rail__end">
          <ModifierBar value={mods} onToggle={toggle} ariaLabel="Chord modifiers" />
        </div>
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
