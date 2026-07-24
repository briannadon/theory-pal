// Wraps `midi/`'s `WebMidiOut` with the React state the port picker needs.
// CRITICAL (SPEC.md / PLAN.md Firefox specifics): `requestAccess()` must
// only be invoked from inside a user-gesture handler — Firefox gates Web
// MIDI behind a per-site permission add-on and auto-denies when no MIDI
// device is visible, so this hook never calls it itself (no effect, no
// mount-time call); it only exposes `requestAccess` for a click handler to
// call directly. The app stays fully usable when access is denied or
// unavailable — `available` (and this hook's `status`) just report that.
import { useCallback, useRef, useState } from 'react';
import { WebMidiOut, type MidiOut, type MidiPort } from '../../midi/index.ts';

export type MidiAccessStatus = 'idle' | 'requesting' | 'granted' | 'denied';

export interface UseMidiOutResult {
  midi: MidiOut;
  status: MidiAccessStatus;
  ports: MidiPort[];
  selectedPortId: string | null;
  requestAccess: () => Promise<void>;
  selectPort: (id: string) => void;
}

export function useMidiOut(): UseMidiOutResult {
  const ref = useRef<MidiOut | null>(null);
  if (!ref.current) ref.current = new WebMidiOut();
  const midi = ref.current;

  const [status, setStatus] = useState<MidiAccessStatus>('idle');
  const [ports, setPorts] = useState<MidiPort[]>([]);
  const [selectedPortId, setSelectedPortId] = useState<string | null>(null);

  const requestAccess = useCallback(async () => {
    setStatus('requesting');
    const found = await midi.requestAccess();
    setPorts(found);
    setStatus(midi.available ? 'granted' : 'denied');
  }, [midi]);

  const selectPort = useCallback(
    (id: string) => {
      midi.selectPort(id);
      setSelectedPortId(id);
    },
    [midi],
  );

  return { midi, status, ports, selectedPortId, requestAccess, selectPort };
}
