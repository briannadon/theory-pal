// The chord-modifier toggles, shared by the in-key strip (where they restyle
// all seven chords at once) and each grid slot's popover (where they restyle
// that one chord). One component so the two never drift apart: a modifier that
// exists in the strip exists in the grid, looking and behaving identically.
//
// Every toggle is independent — including sus2 and sus4, which both replace
// the third and together give the 2nd and the 4th over the fifth.
export type ChordModifier =
  | 'sus2'
  | 'sus4'
  | 'sixth'
  | 'seventh'
  | 'ninth'
  | 'eleventh'
  | 'thirteenth';

export type ModifierState = Record<ChordModifier, boolean>;

export const NO_MODIFIERS: ModifierState = {
  sus2: false,
  sus4: false,
  sixth: false,
  seventh: false,
  ninth: false,
  eleventh: false,
  thirteenth: false,
};

const BUTTONS: { key: ChordModifier; label: string }[] = [
  { key: 'sus2', label: 'sus2' },
  { key: 'sus4', label: 'sus4' },
  { key: 'sixth', label: '6' },
  { key: 'seventh', label: '7' },
  { key: 'ninth', label: '9' },
  { key: 'eleventh', label: '11' },
  { key: 'thirteenth', label: '13' },
];

export interface ModifierBarProps {
  value: ModifierState;
  onToggle: (modifier: ChordModifier) => void;
  ariaLabel: string;
}

export function ModifierBar({ value, onToggle, ariaLabel }: ModifierBarProps) {
  return (
    <div className="tp-size-group" role="group" aria-label={ariaLabel}>
      {BUTTONS.map((b) => (
        <button
          key={b.key}
          type="button"
          className="tp-size-btn"
          aria-pressed={value[b.key]}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(b.key);
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
