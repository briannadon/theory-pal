// Everything you can do to one chord already on the grid, in a single panel:
// move it to any chromatic degree, set its quality outright, stack modifiers,
// and duplicate it.
//
// One panel rather than one button per concern, because these are three views
// of the same chord and the user is deciding between them, not doing them in
// sequence — and because a grid tile is a duration wide, so tile chrome is the
// scarcest space in the app. The tile carries one button; the panel carries
// the vocabulary.
//
// Degree and quality are deliberately not symmetric. Picking a degree re-snaps
// the quality (see `setDegree`): vii° is diminished because of where it sits,
// so "make this the VII chord" should give the VII chord this key actually
// has. Picking a quality overrules that, and nothing re-derives it afterwards.
import {
  chordName,
  romanNumeral,
  toAbsolute,
  type ChordQuality,
  type Key,
  type RelChord,
} from '../../theory/index.ts';
import { baseQuality, modifierState, setDegree, setQuality, toggleModifier } from '../logic/chordMods.ts';
import { ModifierBar, type ChordModifier } from './ModifierBar.tsx';

/** Where the copy will land, so the button can say so before it is pressed —
 * the grid knows this, the tile doesn't (see `duplicateSlot`). */
export type DuplicateMode = 'gap' | 'split';

const DEGREES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// The quality vocabulary, minus the sus qualities: those are spelled as
// modifiers throughout this UI (see ui/logic/chordMods.ts), and offering them
// twice would let the two spellings disagree on screen.
const QUALITIES: { quality: ChordQuality; label: string }[] = [
  { quality: 'maj', label: 'maj' },
  { quality: 'min', label: 'min' },
  { quality: 'dim', label: 'dim' },
  { quality: 'aug', label: 'aug' },
  { quality: 'maj7', label: 'maj7' },
  { quality: 'min7', label: 'm7' },
  { quality: 'dom7', label: '7' },
  { quality: 'm7b5', label: 'ø7' },
  { quality: 'dim7', label: 'o7' },
  { quality: 'minMaj7', label: 'mMaj7' },
];

export interface ChordEditorProps {
  chord: RelChord;
  keyValue: Key;
  onChange: (chord: RelChord) => void;
  /** Absent when the grid has no duplicate handler wired. */
  onDuplicate?: () => void;
  duplicateMode?: DuplicateMode;
  /** Bar.beat address of the slot being edited, for labels. */
  position: string;
}

export function ChordEditor({
  chord,
  keyValue,
  onChange,
  onDuplicate,
  duplicateMode = 'split',
  position,
}: ChordEditorProps) {
  const current = baseQuality(chord);
  const degree = ((chord.degree % 12) + 12) % 12;

  return (
    <div className="chord-editor">
      <section className="chord-editor__section">
        <span className="chord-editor__label">Degree</span>
        <div className="chord-editor__degrees" role="group" aria-label={`Scale degree of the chord at bar ${position}`}>
          {DEGREES.map((d) => {
            // Each button previews the chord it would produce, rather than
            // showing a bare degree number: the numeral carries its own case
            // and quality (vii°, bVI), and the letter name says what that is
            // in this key — the same two lines the tile itself shows.
            const preview = setDegree(chord, keyValue, d);
            return (
              <button
                key={d}
                type="button"
                className="chord-editor__degree"
                aria-pressed={degree === d}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(preview);
                }}
              >
                <span className="chord-editor__degree-roman">{romanNumeral(preview, keyValue)}</span>
                <span className="chord-editor__degree-name">
                  {chordName(toAbsolute(preview, keyValue))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="chord-editor__section">
        <span className="chord-editor__label">Quality</span>
        <div className="tp-size-group" role="group" aria-label={`Quality of the chord at bar ${position}`}>
          {QUALITIES.map((q) => (
            <button
              key={q.quality}
              type="button"
              className="tp-size-btn"
              aria-pressed={current === q.quality}
              onClick={(e) => {
                e.stopPropagation();
                onChange(setQuality(chord, q.quality));
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </section>

      <section className="chord-editor__section">
        <span className="chord-editor__label">Modifiers</span>
        <ModifierBar
          value={modifierState(chord)}
          onToggle={(modifier: ChordModifier) => onChange(toggleModifier(chord, keyValue, modifier))}
          ariaLabel={`Modifiers for the chord at bar ${position}`}
        />
      </section>

      {onDuplicate && (
        <button
          type="button"
          className="chord-editor__duplicate"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          title={
            duplicateMode === 'gap'
              ? 'Copy this chord into the empty space after it'
              : 'No empty space after it — this chord splits into two copies'
          }
        >
          <span>duplicate</span>
          <span className="chord-editor__duplicate-mode">
            {duplicateMode === 'gap' ? 'into the gap after it' : 'by splitting it in two'}
          </span>
        </button>
      )}
    </div>
  );
}
