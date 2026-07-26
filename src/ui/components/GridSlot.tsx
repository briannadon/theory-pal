import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  /** Move this chord's downbeat, keeping its end where it is — the keyboard
   * half of the left grip. Filled slots only: an empty span is the gap
   * between chords, and has no edges of its own to move. */
  onSetStart?: (start: number) => void;
  /** Hand a left-edge pointer drag to the grid, which tracks it (see below). */
  onStartEdgeDrag?: (clientX: number) => void;
  /** Empty slots only. Clicking one selects it, which reveals the control that
   * aims the suggestion strip at this slot instead of at the end of the
   * progression. Selection is the intermediate step on purpose: a stray click
   * on empty track should not silently rewrite what the strip is answering. */
  isSelected?: boolean;
  onSelect?: () => void;
  /** Set while this slot is the one the suggestion strip is ranking for. */
  isTargeted?: boolean;
  onSuggestHere?: () => void;
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
  onSetStart,
  onStartEdgeDrag,
  isSelected = false,
  isTargeted = false,
  onSelect,
  onSuggestHere,
}: GridSlotProps) {
  const [modsOpen, setModsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragStart = useRef<{ x: number; beats: number } | null>(null);

  // The grid scrolls horizontally, and a scroll container clips both axes: a
  // panel anchored inside a tile is cut off at the scroller's bottom edge,
  // which is where the melody lane starts. So the panel lives on the body and
  // is positioned against the button's viewport rect — centered on it, then
  // clamped inside the viewport (edge tiles used to lose their first toggle),
  // and flipped above the button when there's no room below.
  const place = useCallback(() => {
    const btn = btnRef.current;
    const panel = panelRef.current;
    if (!btn || !panel) return;
    const b = btn.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const margin = 8;
    const gap = 5;
    const maxLeft = Math.max(margin, window.innerWidth - margin - p.width);
    const left = Math.min(Math.max(margin, b.left + b.width / 2 - p.width / 2), maxLeft);
    const below = b.bottom + gap;
    const top = below + p.height > window.innerHeight - margin ? b.top - gap - p.height : below;
    setPos({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!modsOpen) {
      setPos(null);
      return;
    }
    place();
    // Scrolling the grid (or the page) moves the button out from under the
    // panel, so the panel has to follow it.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [modsOpen, place]);

  // Click anywhere else — including another slot's button — closes this one.
  // Pointerdown rather than click so the popover is gone before whatever was
  // clicked reacts, and Escape for the keyboard. The panel is portalled, so it
  // is not inside popoverRef and has to be tested separately.
  useEffect(() => {
    if (!modsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setModsOpen(false);
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

  // The left grip is the same gesture against the other edge: it sets where
  // the chord *starts*, holding its end still, which is how a chord left
  // stranded after a gap gets pulled back onto the previous chord's downbeat
  // without re-dragging everything after it.
  //
  // Its pointer drag is run by the grid rather than here. Moving this edge
  // splices slots out in front of it, and slot keys are positional, so *this*
  // tile is unmounted the moment the gap it is closing disappears — a drag
  // owned by the tile would die mid-gesture, right at the beat the user was
  // aiming for. The grid outlives that. Keyboard nudges are still local:
  // between two keypresses there is no gesture to lose.
  const handleStartDown = (e: React.PointerEvent) => {
    if (!onStartEdgeDrag) return;
    e.preventDefault();
    e.stopPropagation();
    // The grid tracks the rest of this gesture on window listeners (see
    // GridContainer — this tile can be unmounted mid-drag), but capturing
    // here too means a finger that slides off the 7px grip doesn't lose the
    // gesture to whatever it slid onto in the meantime.
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    onStartEdgeDrag(e.clientX);
  };

  const handleStartKey = (e: React.KeyboardEvent) => {
    if (!onSetStart) return;
    if (e.key === 'ArrowLeft') onSetStart(Math.max(0, start - division));
    else if (e.key === 'ArrowRight') onSetStart(start + division);
    else return;
    e.preventDefault();
  };

  const sizeClass = width < TINY_PX ? ' grid-slot--tiny' : width < NARROW_PX ? ' grid-slot--narrow' : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid-slot${isDragging ? ' grid-slot--dragging' : ''}${isPlaying ? ' grid-slot--playing' : ''}${chord ? '' : ' grid-slot--empty'}${isSelected ? ' grid-slot--selected' : ''}${isTargeted ? ' grid-slot--targeted' : ''}${sizeClass}`}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      <button
        type="button"
        className="grid-slot__body"
        onClick={() => {
          if (chord) onAudition();
          else onSelect?.();
        }}
        title={`${label} · ${lengthText} · bar ${position}`}
        aria-label={
          chord
            ? `Bar ${position}, ${lengthText}: ${label}`
            : `Empty slot at bar ${position}. Select it to get suggestions for it.`
        }
        {...(chord ? {} : { 'aria-pressed': isSelected || isTargeted })}
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
      {!chord && isSelected && !isTargeted && onSuggestHere && (
        <button
          type="button"
          className="grid-slot__suggest-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSuggestHere();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Rank suggestions for the empty slot at bar ${position}`}
        >
          suggest chord here
        </button>
      )}
      {chord && onModifyChord && (
        <div className="grid-slot__mods" ref={popoverRef}>
          <button
            type="button"
            ref={btnRef}
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
          {modsOpen &&
            createPortal(
              <div
                className="grid-slot__popover"
                ref={panelRef}
                style={{
                  left: pos?.left ?? 0,
                  top: pos?.top ?? 0,
                  // Hidden for the one layout pass that measures it.
                  visibility: pos ? 'visible' : 'hidden',
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {/* Tap-outside already closes this (see the pointerdown listener
                    above), but that's invisible until you find it by accident on
                    a phone — an explicit close control is the one a thumb can see. */}
                <div className="grid-slot__popover-head">
                  <span className="grid-slot__popover-title">Modifiers</span>
                  <button
                    type="button"
                    className="grid-slot__popover-close"
                    aria-label="Close modifiers"
                    onClick={() => setModsOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <ModifierBar
                  value={modifierState(chord)}
                  onToggle={(modifier: ChordModifier) =>
                    onModifyChord(toggleModifier(chord, keyValue, modifier))
                  }
                  ariaLabel={`Modifiers for the chord at bar ${position}`}
                />
              </div>,
              document.body,
            )}
        </div>
      )}
      {/* The tile's address is the ruler's job and its own place on the
          timeline; what it shows here is the one number the grip is setting. */}
      <span className="grid-slot__beats">{beatsLabel(beats)}</span>
      {chord && (onSetStart || onStartEdgeDrag) && (
        <button
          type="button"
          className="grid-slot__grip grid-slot__grip--start"
          aria-label={`Start of the chord at bar ${position}. Arrow keys to move it.`}
          onPointerDown={handleStartDown}
          onKeyDown={handleStartKey}
          onClick={(e) => e.stopPropagation()}
        />
      )}
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
