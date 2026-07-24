import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { chordName, type ChordMods, type ChordQuality, type RelChord } from '../../theory/index.ts';
import { ChordFace, type ChordAccent } from './ChordFace.tsx';

// The qualities a slot can be switched to by hand. 9ths are not members of
// ChordQuality — they are a base quality plus `mods.ninth` (see SPEC.md) — so
// an option carries both, and its stored value encodes both.
//
// Labels are derived rather than typed out: `chordName` on a C root gives the
// exact chord-symbol suffix the tile itself displays, so the dropdown can
// never drift out of step with the face above it.
interface QualityOption {
  value: string;
  label: string;
  quality: ChordQuality;
  mods?: ChordMods;
}

const NINTH: ChordMods = { ninth: true };

function optionValue(quality: ChordQuality, mods?: ChordMods): string {
  return mods?.ninth ? `${quality}+9` : quality;
}

function option(quality: ChordQuality, mods?: ChordMods): QualityOption {
  const symbol = chordName({ root: 0, quality, mods }).slice(1); // drop the "C"
  return { value: optionValue(quality, mods), label: symbol || 'maj', quality, mods };
}

const QUALITY_OPTIONS: QualityOption[] = [
  option('maj'),
  option('min'),
  option('dom7'),
  option('maj7'),
  option('min7'),
  option('m7b5'),
  option('dim7'),
  option('minMaj7'),
  option('sus2'),
  option('sus4'),
  option('dom7sus4'),
  option('dim'),
  option('aug'),
  // Added tones and true 9ths, in the same order as their base qualities.
  option('maj', NINTH), // add9
  option('min', NINTH), // m(add9)
  option('dom7', NINTH), // 9
  option('maj7', NINTH), // maj9
  option('min7', NINTH), // m9
  option('m7b5', NINTH), // m9b5
  option('dom7sus4', NINTH), // 9sus4
];

export interface GridSlotProps {
  id: string;
  index: number;
  chord: RelChord | null;
  roman?: string;
  name?: string;
  accent: ChordAccent;
  isPlaying: boolean;
  onAudition: () => void;
  onClear: () => void;
  onModifyQuality?: (quality: ChordQuality, mods?: ChordMods) => void;
  /** Hovering a chord tile resolves the melody lane to that chord — see
   * MelodyLane. Reported here rather than derived there so both the tile and
   * the lane's own bar segment drive the same highlight. */
  onHoverChange?: (hovering: boolean) => void;
}

export function GridSlot({
  id,
  index,
  chord,
  roman,
  name,
  accent,
  isPlaying,
  onAudition,
  onClear,
  onModifyQuality,
  onHoverChange,
}: GridSlotProps) {
  // Slot ids/keys are positional (`slot-0`…`slot-n`), so a reorder moves the
  // chord *content* between DOM nodes that themselves never move. dnd-kit's
  // default layout animation doesn't know that: on drop it measures the "new"
  // layout and slides each node from its dragging transform to its rest
  // position — replaying the shuffle the drag preview already showed. Opting
  // out makes the drop resolve instantly into the previewed arrangement.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { source: 'grid', index },
    disabled: !chord,
    animateLayoutChanges: () => false,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const currentValue = chord ? optionValue(chord.quality, chord.mods) : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid-slot${isDragging ? ' grid-slot--dragging' : ''}${isPlaying ? ' grid-slot--playing' : ''}`}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      <button
        type="button"
        className="grid-slot__body"
        onClick={() => {
          if (chord) onAudition();
        }}
        aria-label={chord ? `Bar ${index + 1}: ${name}, ${roman}` : `Bar ${index + 1}: empty`}
        {...(chord ? { ...attributes, ...listeners } : {})}
      >
        <ChordFace roman={roman} name={name} accent={accent} placeholder="+" />
      </button>
      {chord && (
        <button
          type="button"
          className="grid-slot__clear"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          aria-label={`Clear bar ${index + 1}`}
        >
          ×
        </button>
      )}
      {chord && onModifyQuality && (
        <select
          className="grid-slot__quality-select"
          value={currentValue}
          aria-label={`Modify quality for bar ${index + 1}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            const picked = QUALITY_OPTIONS.find((o) => o.value === e.target.value);
            if (picked) onModifyQuality(picked.quality, picked.mods);
          }}
        >
          {/* A chord dragged in with modifiers the list doesn't cover (a sus'd
              7th, say) still has to show what it is, so it gets a disabled
              entry of its own rather than silently reading as its base
              quality. */}
          {!QUALITY_OPTIONS.some((o) => o.value === currentValue) && (
            <option value={currentValue} disabled>
              {chordName({ root: 0, quality: chord.quality, mods: chord.mods }).slice(1) || 'maj'}
            </option>
          )}
          {QUALITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <span className="grid-slot__index">{index + 1}</span>
    </div>
  );
}
