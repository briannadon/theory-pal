// One bar-slot in the progression grid: a sortable (dnd-kit) drag source/
// drop target for reordering, and also a valid drop target for chords
// dragged in from either strip (TheoryPal's onDragEnd tells the two apart
// via `active.data.current.source`). Click auditions a filled slot; the
// small "x" clears it.
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RelChord } from '../../theory/index.ts';
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
}

export function GridSlot({ id, index, chord, roman, name, accent, isPlaying, onAudition, onClear }: GridSlotProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { source: 'grid', index },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid-slot${isDragging ? ' grid-slot--dragging' : ''}${isPlaying ? ' grid-slot--playing' : ''}`}
    >
      <button
        type="button"
        className="grid-slot__body"
        onClick={onAudition}
        disabled={!chord}
        aria-label={chord ? `Bar ${index + 1}: ${name}, ${roman}` : `Bar ${index + 1}: empty`}
        {...attributes}
        {...listeners}
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
      <span className="grid-slot__index">{index + 1}</span>
    </div>
  );
}
