// Bottom strip: ranked next-chord suggestions from model/suggest, given the
// grid's current context, plus a rightmost "surprise me" slot sampled from
// model/surprise. Non-diatonic suggestions get the borrowed accent color so
// they read as distinct from in-key chords at a glance.
import { chordName, romanNumeral, toAbsolute, type Key } from '../../theory/index.ts';
import type { Suggestion } from '../../model/index.ts';
import { StripCell } from './StripCell.tsx';
import { ChordFace } from './ChordFace.tsx';
import { useDraggable } from '@dnd-kit/core';

export interface SuggestionStripProps {
  keyValue: Key;
  suggestions: Suggestion[];
  surprise: Suggestion | null;
  onAudition: (chord: Suggestion['chord']) => void;
  onReroll: () => void;
}

export function SuggestionStrip({ keyValue, suggestions, surprise, onAudition, onReroll }: SuggestionStripProps) {
  return (
    <section className="tp-strip">
      <div className="tp-strip__header">
        <span className="tp-strip__eyebrow">Next</span>
        <span className="tp-strip__hint">ranked by likelihood · drag into the grid</span>
      </div>
      <div className="tp-strip__cells">
        {suggestions.map((s, i) => {
          const roman = romanNumeral(s.chord, keyValue);
          const name = chordName(toAbsolute(s.chord, keyValue));
          return (
            <StripCell
              key={i}
              id={`suggestion-${i}`}
              chord={s.chord}
              roman={roman}
              name={name}
              accent={s.diatonic ? 'diatonic' : 'borrowed'}
              probability={s.probability}
              fromCorpus={s.fromCorpus}
              onAudition={onAudition}
              ariaLabel={`${roman}, ${name}, ${Math.round(s.probability * 100)}% likely${s.diatonic ? '' : ', borrowed'}. Click to audition, drag to add to the grid.`}
            />
          );
        })}
        {surprise && <SurpriseCell keyValue={keyValue} suggestion={surprise} onAudition={onAudition} onReroll={onReroll} />}
      </div>
    </section>
  );
}

interface SurpriseCellProps {
  keyValue: Key;
  suggestion: Suggestion;
  onAudition: (chord: Suggestion['chord']) => void;
  onReroll: () => void;
}

function SurpriseCell({ keyValue, suggestion, onAudition, onReroll }: SurpriseCellProps) {
  const roman = romanNumeral(suggestion.chord, keyValue);
  const name = chordName(toAbsolute(suggestion.chord, keyValue));
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: 'suggestion-surprise',
    data: { source: 'strip', chord: suggestion.chord },
  });

  return (
    <div className="tp-surprise-cell">
      <button
        type="button"
        ref={setNodeRef}
        className={`strip-cell${isDragging ? ' strip-cell--dragging' : ''}`}
        onClick={() => onAudition(suggestion.chord)}
        aria-label={`Surprise me: ${roman}, ${name}. Click to audition or drag to add to the grid.`}
        {...attributes}
        {...listeners}
      >
        <ChordFace roman={roman} name={name} accent="surprise">
          <span className="tp-surprise-label">surprise</span>
        </ChordFace>
      </button>
      <button
        type="button"
        className="tp-reroll-btn"
        aria-label="Reroll surprise suggestion"
        onClick={onReroll}
      >
        ⟳ reroll
      </button>
    </div>
  );
}
