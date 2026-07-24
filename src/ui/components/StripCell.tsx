// A draggable, clickable chord cell used by both the diatonic strip and the
// suggestion strip. Click auditions; drag (dnd-kit) hands the chord off to
// whichever grid slot it's dropped on. A small `distance` activation
// constraint on the DndContext's PointerSensor (see TheoryPal.tsx) is what
// lets a plain click and a drag coexist on the same element.
import { useDraggable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import type { RelChord } from '../../theory/index.ts';
import { ChordFace, type ChordAccent } from './ChordFace.tsx';

export interface StripCellProps {
  id: string;
  chord: RelChord;
  roman: string;
  name: string;
  accent: ChordAccent;
  probability?: number;
  fromCorpus?: boolean;
  onAudition: (chord: RelChord) => void;
  ariaLabel: string;
  children?: ReactNode;
}

export function StripCell({
  id,
  chord,
  roman,
  name,
  accent,
  probability,
  fromCorpus,
  onAudition,
  ariaLabel,
  children,
}: StripCellProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { source: 'strip', chord },
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`strip-cell${isDragging ? ' strip-cell--dragging' : ''}`}
      onClick={() => onAudition(chord)}
      aria-label={ariaLabel}
      {...attributes}
      {...listeners}
    >
      <ChordFace roman={roman} name={name} accent={accent} probability={probability} fromCorpus={fromCorpus}>
        {children}
      </ChordFace>
    </button>
  );
}
