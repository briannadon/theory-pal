// Main top-level TheoryPal interface component. Coordinates state across key selection,
// suggestion engine, progression grid, Web Audio / SoundFont piano, Web MIDI output,
// and drag-and-drop interaction via dnd-kit.
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playProgression, type Playback } from '../../audio/index.ts';
import { exportMidiFile } from '../../midi/index.ts';
import { suggest, surprise, type Suggestion } from '../../model/index.ts';
import { toAbsolute, voiceChord, type Key, type RelChord } from '../../theory/index.ts';
import { useAudioEngine } from '../hooks/useAudioEngine.ts';
import { useMidiOut } from '../hooks/useMidiOut.ts';
import { useModel } from '../hooks/useModel.ts';
import { deriveContext } from '../logic/context.ts';
import {
  clearSlot,
  createGrid,
  parseSlotIndex,
  reorderGrid,
  resizeGrid,
  setSlot,
  type GridSize,
  type GridState,
} from '../logic/grid.ts';
import { voiceGrid } from '../logic/voicing.ts';
import { DiatonicStrip } from './DiatonicStrip.tsx';
import { GridContainer } from './GridContainer.tsx';
import { KeyPicker } from './KeyPicker.tsx';
import { ModelBadge } from './ModelBadge.tsx';
import { SuggestionStrip } from './SuggestionStrip.tsx';
import { Transport } from './Transport.tsx';

export function TheoryPal() {
  const [key, setKey] = useState<Key>({ tonic: 0, scale: 'ionian' });
  const [grid, setGrid] = useState<GridState>(() => createGrid(4));
  const [bpm, setBpm] = useState<number>(120);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [isPianoEnabled, setIsPianoEnabled] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [surpriseRerollCount, setSurpriseRerollCount] = useState<number>(0);
  const [surpriseChord, setSurpriseChord] = useState<Suggestion | null>(null);

  const playbackRef = useRef<Playback | null>(null);

  const { engine, ensureInit } = useAudioEngine();
  const {
    midi,
    status: midiStatus,
    ports: midiPorts,
    selectedPortId,
    requestAccess: requestMidiAccess,
    selectPort: selectMidiPort,
  } = useMidiOut();
  const { model, status: modelStatus } = useModel();

  // Derived context & suggestions (memoized to prevent unstable object/array references causing re-render loops)
  const context = useMemo(() => deriveContext(grid.slots), [grid.slots]);
  const suggestions = useMemo(() => suggest(model, { context, key, limit: 7 }), [model, context, key]);
  const anyFromCorpus = suggestions.some((s) => s.fromCorpus);

  // Update surprise suggestion when model, context, key, or reroll count changes
  useEffect(() => {
    setSurpriseChord(surprise(model, { context, key }));
  }, [model, context, key, surpriseRerollCount]);

  // Keep piano toggle in sync with engine
  useEffect(() => {
    engine.setEnabled(isPianoEnabled);
  }, [engine, isPianoEnabled]);

  // Monitor playback status to stop when non-looping sequence completes
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      if (playbackRef.current && !playbackRef.current.playing) {
        setIsPlaying(false);
        setPlayingIndex(null);
        playbackRef.current = null;
      }
    }, 100);
    return () => clearInterval(timer);
  }, [isPlaying]);

  // dnd-kit sensors: distance constraint of 5px allows click and drag to coexist on chord buttons
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleAudition = useCallback(
    async (chord: RelChord) => {
      void ensureInit();
      const abs = toAbsolute(chord, key);
      const voiced = voiceChord(abs);
      const quarterNoteSec = 60 / bpm;
      if (isPianoEnabled) {
        engine.playChord(voiced.notes, quarterNoteSec);
      }
      if (midi.available) {
        midi.sendChord(voiced.notes, quarterNoteSec * 1000);
      }
    },
    [ensureInit, key, bpm, isPianoEnabled, engine, midi],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      // Case 1: Dragged from a strip (diatonic, suggestion, or surprise) onto a grid slot
      if (activeData?.source === 'strip' && activeData.chord) {
        let targetIndex: number | null = null;
        if (overData?.source === 'grid' && typeof overData.index === 'number') {
          targetIndex = overData.index;
        } else if (typeof over.id === 'string') {
          targetIndex = parseSlotIndex(over.id);
        }
        if (targetIndex !== null && targetIndex >= 0 && targetIndex < grid.size) {
          setGrid((g) => setSlot(g, targetIndex, activeData.chord as RelChord));
        }
      }

      // Case 2: Reordering within the grid
      if (activeData?.source === 'grid' && typeof activeData.index === 'number') {
        const fromIndex = activeData.index;
        let toIndex: number | null = null;
        if (overData?.source === 'grid' && typeof overData.index === 'number') {
          toIndex = overData.index;
        } else if (typeof over.id === 'string') {
          toIndex = parseSlotIndex(over.id);
        }
        if (toIndex !== null && fromIndex !== toIndex) {
          setGrid((g) => reorderGrid(g, fromIndex, toIndex));
        }
      }
    },
    [grid.size],
  );

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      playbackRef.current?.stop();
      playbackRef.current = null;
      setIsPlaying(false);
      setPlayingIndex(null);
      return;
    }

    if (!grid.slots.some((s) => s !== null)) return;

    await ensureInit();
    engine.setEnabled(isPianoEnabled);

    const voicedChords = voiceGrid(grid.slots, key);
    const playback = playProgression({
      chords: voicedChords,
      bpm,
      loop: isLooping,
      audio: engine,
      midi: midi.available ? midi : undefined,
      onStep: (index) => setPlayingIndex(index),
    });

    playbackRef.current = playback;
    playback.start();
    setIsPlaying(true);
  }, [isPlaying, grid.slots, ensureInit, engine, isPianoEnabled, key, bpm, isLooping, midi]);

  const handleExportMidi = useCallback(() => {
    const absBars = grid.slots.map((s) => (s !== null ? toAbsolute(s, key) : null));
    const blob = exportMidiFile(absBars, bpm);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `progression-${key.tonic}-${key.scale}.mid`;
    a.click();
    URL.revokeObjectURL(url);
  }, [grid.slots, key, bpm]);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="tp-app">
        <header className="tp-header">
          <h1 className="tp-header__brand">
            theory<span className="tp-header__brand-mark">•</span>pal
          </h1>
          <KeyPicker value={key} onChange={setKey} />
          <ModelBadge status={modelStatus} anyFromCorpus={anyFromCorpus} />
        </header>

        <main style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <DiatonicStrip keyValue={key} onAudition={handleAudition} />
          <SuggestionStrip
            keyValue={key}
            suggestions={suggestions}
            surprise={surpriseChord}
            onAudition={handleAudition}
            onReroll={() => setSurpriseRerollCount((c) => c + 1)}
          />
          <GridContainer
            state={grid}
            keyValue={key}
            playingIndex={playingIndex}
            onSetSize={(sz: GridSize) => setGrid((g) => resizeGrid(g, sz))}
            onClearGrid={() => setGrid((g) => createGrid(g.size))}
            onAuditionSlot={handleAudition}
            onClearSlot={(idx: number) => setGrid((g) => clearSlot(g, idx))}
          />
        </main>

        <Transport
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          bpm={bpm}
          onBpmChange={setBpm}
          isLooping={isLooping}
          onToggleLoop={() => setIsLooping((l) => !l)}
          isPianoEnabled={isPianoEnabled}
          onTogglePiano={() => setIsPianoEnabled((p) => !p)}
          midiStatus={midiStatus}
          midiPorts={midiPorts}
          selectedMidiPortId={selectedPortId}
          onRequestMidiAccess={requestMidiAccess}
          onSelectMidiPort={selectMidiPort}
          onExportMidi={handleExportMidi}
          hasChordsInGrid={grid.slots.some((s) => s !== null)}
        />
      </div>
    </DndContext>
  );
}
