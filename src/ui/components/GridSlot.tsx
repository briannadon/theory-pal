import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ChordQuality, RelChord } from '../../theory/index.ts';
import { ChordFace, type ChordAccent } from './ChordFace.tsx';

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
  onModifyQuality?: (quality: ChordQuality) => void;
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
          value={chord.quality}
          aria-label={`Modify quality for bar ${index + 1}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onModifyQuality(e.target.value as ChordQuality);
          }}
        >
          <option value="maj">maj</option>
          <option value="min">min</option>
          <option value="dom7">dom7</option>
          <option value="maj7">maj7</option>
          <option value="min7">min7</option>
          <option value="m7b5">m7b5</option>
          <option value="dim7">dim7</option>
          <option value="sus2">sus2</option>
          <option value="sus4">sus4</option>
          <option value="dom7sus4">dom7sus4</option>
          <option value="dim">dim</option>
          <option value="aug">aug</option>
        </select>
      )}
      <span className="grid-slot__index">{index + 1}</span>
    </div>
  );
}
