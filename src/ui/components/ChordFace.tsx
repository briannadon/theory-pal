// Presentational-only chord cell face: the roman numeral, absolute chord
// name, diatonic/borrowed/surprise accent, and (when given) a probability
// read out both as text and as a small level-meter bar. No dnd-kit, no
// click handling, and no music theory here — callers (StripCell, GridSlot)
// own interaction; this only renders whatever they pass in.
import type { ReactNode } from 'react';

export type ChordAccent = 'diatonic' | 'borrowed' | 'surprise' | 'empty';

export interface ChordFaceProps {
  roman?: string;
  name?: string;
  accent: ChordAccent;
  probability?: number; // 0-1
  fromCorpus?: boolean;
  placeholder?: string;
  children?: ReactNode; // overlay controls: reroll button, clear button, bar index
}

export function ChordFace({
  roman,
  name,
  accent,
  probability,
  fromCorpus,
  placeholder,
  children,
}: ChordFaceProps) {
  return (
    <div className={`chord-face chord-face--${accent}`}>
      {roman ? (
        <>
          <span className="chord-face__roman">{roman}</span>
          {name && <span className="chord-face__name">{name}</span>}
          {probability !== undefined && (
            <span className="chord-face__prob">
              <span className="chord-face__prob-bar-track">
                <span
                  className="chord-face__prob-bar"
                  style={{ width: `${Math.round(probability * 100)}%` }}
                />
              </span>
              <span className="chord-face__prob-text">{Math.round(probability * 100)}%</span>
            </span>
          )}
          {fromCorpus !== undefined && (
            <span className="chord-face__corpus-mark" data-corpus={fromCorpus} aria-hidden="true" />
          )}
        </>
      ) : (
        <span className="chord-face__placeholder">{placeholder ?? '+'}</span>
      )}
      {children}
    </div>
  );
}
