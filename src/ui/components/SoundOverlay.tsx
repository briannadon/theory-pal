// Modal gate shown while the piano soundfont loads. The samples are fetched
// on mount (see useAudioEngine); until they arrive, every chord click is
// silent, which reads as a broken app. Rather than let the user click into
// that dead window, the overlay covers the UI and swallows input until the
// instrument is playable.
//
// The failure branch is dismissible on purpose: a load error is permanent,
// and the rest of the app (MIDI out, .mid export, building progressions
// silently) still works, so refusing to let the user past would be worse
// than the missing audio.
import { useState } from 'react';
import type { SoundLoadStatus } from '../hooks/useAudioEngine.ts';

export interface SoundOverlayProps {
  status: SoundLoadStatus;
}

export function SoundOverlay({ status }: SoundOverlayProps) {
  const [dismissed, setDismissed] = useState(false);

  if (status === 'ready' || dismissed) return null;

  const isError = status === 'error';

  return (
    <div
      className="tp-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-busy={!isError}
      aria-label={isError ? 'Piano samples failed to load' : 'Loading piano sound'}
    >
      <div className="tp-overlay__panel">
        {isError ? (
          <>
            <span className="tp-overlay__title tp-overlay__title--error">piano unavailable</span>
            <p className="tp-overlay__note">
              The soundfont failed to load. MIDI out and .mid export still work; reload the page to
              retry the internal piano.
            </p>
            <button type="button" className="tp-btn" onClick={() => setDismissed(true)}>
              Continue without sound
            </button>
          </>
        ) : (
          <>
            <span className="tp-overlay__spinner" aria-hidden="true" />
            <span className="tp-overlay__title">loading piano sound…</span>
            <p className="tp-overlay__note">Fetching the sampled grand. This only happens once.</p>
          </>
        )}
      </div>
    </div>
  );
}
