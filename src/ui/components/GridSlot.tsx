import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Key, RelChord } from '../../theory/index.ts';
import { modifierState, toggleModifier } from '../logic/chordMods.ts';
import { beatsLabel, BEATS_PER_BAR, MIN_SLOT_BEATS, type Division } from '../logic/grid.ts';
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
  /** Where this slot starts and how long it lasts, in beats. */
  start: number;
  beats: number;
  /** Pixels per beat: the tile's width is its duration, to scale. */
  beatWidth: number;
  /** What the resize grip snaps to, in beats. */
  division: Division;
  onResize?: (beats: number) => void;
}

/** Below these widths the tile cannot hold its text, so it sheds it rather
 * than clipping: first the chord name, then everything but the color. */
const NARROW_PX = 52;
const TINY_PX = 30;

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
  start,
  beats,
  beatWidth,
  division,
  onResize,
}: GridSlotProps) {
  const [modsOpen, setModsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const dragStart = useRef<{ x: number; beats: number } | null>(null);

  // The panel is centered on its button, which pushes it off-screen for slots
  // near either edge of the grid — the leftmost tile clipped its first toggle.
  // Measure once on open and slide it back inside the viewport.
  useLayoutEffect(() => {
    if (!modsOpen) {
      setShift(0);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    if (rect.left < margin) setShift(margin - rect.left);
    else if (rect.right > window.innerWidth - margin) {
      setShift(window.innerWidth - margin - rect.right);
    }
  }, [modsOpen]);

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
  // An empty slot can't be *dragged*, but it must stay droppable: it is where
  // a chord from the strip lands, and shrinking a tile makes more of them.
  // dnd-kit reads a bare `disabled: true` as both, and a disabled droppable is
  // left out of collision detection entirely — which silently makes empty
  // space refuse drops.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { source: 'grid', index },
    disabled: { draggable: !chord, droppable: false },
    animateLayoutChanges: () => false,
  });

  const width = beats * beatWidth;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width,
    minWidth: width,
    maxWidth: width,
  };

  // Bar and beat this slot lands on, 1-based — the tile's own address, which
  // is no longer just its index now that a bar can hold several chords.
  const bar = Math.floor(start / BEATS_PER_BAR) + 1;
  const beatInBar = start - (bar - 1) * BEATS_PER_BAR;
  const position = `${bar}.${beatsLabel(beatInBar + 1)}`;
  const lengthText = `${beatsLabel(beats)} ${beats === 1 ? 'beat' : 'beats'}`;
  const label = chord ? `${name}, ${roman}` : 'empty';

  // Dragging the grip: the pointer's travel *is* the new length, snapped to the
  // current division, so the tile tracks the cursor 1:1 rather than through
  // some accumulating delta that would drift as the snap rounds.
  const handleGripDown = (e: React.PointerEvent) => {
    if (!onResize) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, beats };
  };

  const handleGripMove = (e: React.PointerEvent) => {
    const origin = dragStart.current;
    if (!origin || !onResize) return;
    const raw = origin.beats + (e.clientX - origin.x) / beatWidth;
    const snapped = Math.max(MIN_SLOT_BEATS, Math.round(raw / division) * division);
    if (snapped !== beats) onResize(snapped);
  };

  const handleGripUp = (e: React.PointerEvent) => {
    dragStart.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const handleGripKey = (e: React.KeyboardEvent) => {
    if (!onResize) return;
    if (e.key === 'ArrowRight') onResize(beats + division);
    else if (e.key === 'ArrowLeft') onResize(Math.max(MIN_SLOT_BEATS, beats - division));
    else return;
    e.preventDefault();
  };

  const sizeClass = width < TINY_PX ? ' grid-slot--tiny' : width < NARROW_PX ? ' grid-slot--narrow' : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid-slot${isDragging ? ' grid-slot--dragging' : ''}${isPlaying ? ' grid-slot--playing' : ''}${chord ? '' : ' grid-slot--empty'}${sizeClass}`}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      <button
        type="button"
        className="grid-slot__body"
        onClick={() => {
          if (chord) onAudition();
        }}
        title={`${label} · ${lengthText} · bar ${position}`}
        aria-label={`Bar ${position}, ${lengthText}: ${label}`}
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
          aria-label={`Clear the chord at bar ${position}`}
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
            aria-label={`Modifiers for the chord at bar ${position}`}
            onClick={(e) => {
              e.stopPropagation();
              setModsOpen((open) => !open);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            mods
          </button>
          {modsOpen && (
            <div
              className="grid-slot__popover"
              ref={panelRef}
              style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ModifierBar
                value={modifierState(chord)}
                onToggle={(modifier: ChordModifier) =>
                  onModifyChord(toggleModifier(chord, keyValue, modifier))
                }
                ariaLabel={`Modifiers for the chord at bar ${position}`}
              />
            </div>
          )}
        </div>
      )}
      {/* The tile's address is the ruler's job and its own place on the
          timeline; what it shows here is the one number the grip is setting. */}
      <span className="grid-slot__beats">{beatsLabel(beats)}</span>
      {onResize && (
        <button
          type="button"
          className="grid-slot__grip"
          aria-label={`Length of the slot at bar ${position}: ${lengthText}. Arrow keys to change.`}
          onPointerDown={handleGripDown}
          onPointerMove={handleGripMove}
          onPointerUp={handleGripUp}
          onPointerCancel={handleGripUp}
          onKeyDown={handleGripKey}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
