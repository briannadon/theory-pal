import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState } from 'react';
import type { Key, RelChord } from '../../theory/index.ts';
import { modifierState, toggleModifier } from '../logic/chordMods.ts';
import { ChordFace, type ChordAccent } from './ChordFace.tsx';
import { ModifierBar, type ChordModifier } from './ModifierBar.tsx';

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
  /** The key decides what "add the 7th" means for this degree. */
  keyValue: Key;
  onModifyChord?: (chord: RelChord) => void;
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
  keyValue,
  onModifyChord,
  onHoverChange,
}: GridSlotProps) {
  const [modsOpen, setModsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click anywhere else — including another slot's button — closes this one.
  // Pointerdown rather than click so the popover is gone before whatever was
  // clicked reacts, and Escape for the keyboard.
  useEffect(() => {
    if (!modsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setModsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modsOpen]);
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
      {chord && onModifyChord && (
        <div className="grid-slot__mods" ref={popoverRef}>
          <button
            type="button"
            className="grid-slot__mods-btn"
            aria-expanded={modsOpen}
            aria-label={`Modifiers for bar ${index + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              setModsOpen((open) => !open);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            mods
          </button>
          {modsOpen && (
            <div className="grid-slot__popover" onPointerDown={(e) => e.stopPropagation()}>
              <ModifierBar
                value={modifierState(chord)}
                onToggle={(modifier: ChordModifier) =>
                  onModifyChord(toggleModifier(chord, keyValue, modifier))
                }
                ariaLabel={`Modifiers for bar ${index + 1}`}
              />
            </div>
          )}
        </div>
      )}
      <span className="grid-slot__index">{index + 1}</span>
    </div>
  );
}
