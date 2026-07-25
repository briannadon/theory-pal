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
import { exportMidiFile, MIDI_CHANNEL } from '../../midi/index.ts';
import { suggest, surprise, type Suggestion } from '../../model/index.ts';
import {
  clampMelody,
  emptyMelody,
  melodyPitchToMidi,
  melodyToBars,
  melodyToSegments,
  toAbsolute,
  voiceChord,
  DEFAULT_BAR_STYLE,
  type BarStyle,
  type Key,
  type MelodyLane,
  type RelChord,
} from '../../theory/index.ts';
import { useAudioEngine } from '../hooks/useAudioEngine.ts';
import { useMidiOut } from '../hooks/useMidiOut.ts';
import { useModel } from '../hooks/useModel.ts';
import { deriveContext } from '../logic/context.ts';
import {
  BEATS_PER_BAR,
  clearSlot,
  createGrid,
  parseSlotIndex,
  placeChord,
  reorderGrid,
  resizeGrid,
  resizeSlot,
  setSlot,
  setSlotStart,
  slotStarts,
  type Division,
  type GridSize,
  type GridState,
} from '../logic/grid.ts';
import { voiceGrid } from '../logic/voicing.ts';
import { DiatonicStrip } from './DiatonicStrip.tsx';
import { GridContainer } from './GridContainer.tsx';
import { KeyPicker } from './KeyPicker.tsx';
import { MelodySection } from './MelodySection.tsx';
import { ModelBadge } from './ModelBadge.tsx';
import { SoundOverlay } from './SoundOverlay.tsx';
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
  const [style, setStyle] = useState<BarStyle>(DEFAULT_BAR_STYLE);
  const [melody, setMelody] = useState<MelodyLane>(() => emptyMelody(8));
  const [melodySurprise, setMelodySurprise] = useState<number>(0.25);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [division, setDivision] = useState<Division>(0.5);
  const [volumes, setVolumes] = useState<{ chords: number; melody: number }>({
    chords: 0.85,
    melody: 1,
  });

  const playbackRef = useRef<Playback | null>(null);

  const { engine, ensureInit, soundStatus } = useAudioEngine();
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
  // Chords alone, for everything that reasons about harmony rather than time:
  // the suggestion context, voice leading, and the melody lane's coloring.
  const chords = useMemo(() => grid.slots.map((s) => s.chord), [grid.slots]);
  const segments = useMemo(() => {
    const starts = slotStarts(grid);
    return grid.slots.map((slot, i) => ({ chord: slot.chord, start: starts[i], beats: slot.beats }));
  }, [grid]);
  // The lane's columns are beats wide, and the progression grid draws its
  // tiles at the same scale, so a chord tile sits over exactly the melody
  // steps it sounds against.
  const beatWidth = melody.stepsPerBar === 8 ? 36 : 44;

  const context = useMemo(() => deriveContext(chords), [chords]);
  const suggestions = useMemo(() => suggest(model, { context, key, limit: 7 }), [model, context, key]);
  const anyFromCorpus = suggestions.some((s) => s.fromCorpus);

  // Update surprise suggestion when model, context, key, or reroll count changes
  useEffect(() => {
    setSurpriseChord(surprise(model, { context, key }));
  }, [model, context, key, surpriseRerollCount]);

  // A shorter grid can leave melody notes stranded past its end, where they
  // would keep sounding with nothing to play against.
  useEffect(() => {
    setMelody((m) => clampMelody(m, grid.size));
  }, [grid.size]);

  // Mixer levels reach both sinks: the piano's per-voice output channels and,
  // for MIDI, channel volume (CC 7) on each channel — the standard meaning of
  // a fader for a receiving instrument.
  useEffect(() => {
    engine.setVolume('chords', volumes.chords);
    engine.setVolume('melody', volumes.melody);
    if (midi.available) {
      midi.setVolume(MIDI_CHANNEL.chords, volumes.chords);
      midi.setVolume(MIDI_CHANNEL.melody, volumes.melody);
    }
  }, [engine, midi, volumes]);

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

  const handleAuditionPitch = useCallback(
    (pitch: number) => {
      void ensureInit();
      const note = melodyPitchToMidi(pitch, key);
      const quarterNoteSec = 60 / bpm;
      if (isPianoEnabled) engine.playChord([note], quarterNoteSec, undefined, 'melody');
      if (midi.available)
        midi.sendChord([note], quarterNoteSec * 1000, undefined, undefined, MIDI_CHANNEL.melody);
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
        if (targetIndex !== null && targetIndex >= 0 && targetIndex < grid.slots.length) {
          setGrid((g) => placeChord(g, targetIndex, activeData.chord as RelChord));
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
    [grid.slots.length],
  );

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      playbackRef.current?.stop();
      playbackRef.current = null;
      setIsPlaying(false);
      setPlayingIndex(null);
      return;
    }

    const lastFilled = grid.slots.reduce((last, s, i) => (s.chord !== null ? i : last), -1);
    if (lastFilled < 0) return;

    await ensureInit();
    engine.setEnabled(isPianoEnabled);

    const activeSlots = grid.slots.slice(0, lastFilled + 1);
    const slotBeats = activeSlots.map((s) => s.beats);
    const voicedChords = voiceGrid(
      activeSlots.map((s) => s.chord),
      key,
    );
    const playback = playProgression({
      chords: voicedChords,
      slotBeats,
      bpm,
      loop: isLooping,
      style,
      melody: melodyToSegments(melody, key, slotBeats),
      audio: engine,
      midi: midi.available ? midi : undefined,
      onStep: (index) => setPlayingIndex(index),
    });

    playbackRef.current = playback;
    playback.start();
    setIsPlaying(true);
  }, [isPlaying, grid.slots, ensureInit, engine, isPianoEnabled, key, bpm, isLooping, midi, style, melody]);

  const handleExportMidi = useCallback(() => {
    const lastFilled = grid.slots.reduce((last, s, i) => (s.chord !== null ? i : last), -1);
    if (lastFilled < 0) return;

    const activeSlots = grid.slots.slice(0, lastFilled + 1);
    const slotBeats = activeSlots.map((s) => s.beats);
    const absChords = activeSlots.map((s) => (s.chord !== null ? toAbsolute(s.chord, key) : null));
    // Chords export on their own uneven timeline; the melody exports on the
    // bars it was written against, which is every bar the chords cover.
    const bars = Math.ceil(slotBeats.reduce((t, b) => t + b, 0) / BEATS_PER_BAR);
    const blob = exportMidiFile(absChords, bpm, {
      style,
      slotBeats,
      melody: melodyToBars(melody, key, bars),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `progression-${key.tonic}-${key.scale}.mid`;
    a.click();
    URL.revokeObjectURL(url);
  }, [grid.slots, key, bpm, style, melody]);

  // The slot popover hands back the whole rewritten chord — it owns the
  // quality/mods split (see ui/logic/chordMods.ts), so there is nothing to
  // reassemble here.
  const handleModifySlot = useCallback((index: number, chord: RelChord) => {
    setGrid((g) => (g.slots[index]?.chord ? setSlot(g, index, chord) : g));
  }, []);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="tp-app">
        <SoundOverlay status={soundStatus} />
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
            onModifySlot={handleModifySlot}
            onHoverSlot={setHoveredSlot}
            onResizeSlot={(idx: number, beats: number) =>
              setGrid((g) => resizeSlot(g, idx, beats))
            }
            onSetSlotStart={(idx: number, start: number) =>
              setGrid((g) => setSlotStart(g, idx, start))
            }
            division={division}
            onDivisionChange={setDivision}
            beatWidth={beatWidth}
          />
          <MelodySection
            lane={melody}
            keyValue={key}
            segments={segments}
            bars={grid.size}
            playingSlot={playingIndex}
            hoveredSlot={hoveredSlot}
            onHoverSlot={setHoveredSlot}
            beatWidth={beatWidth}
            surprise={melodySurprise}
            onSurpriseChange={setMelodySurprise}
            onChange={setMelody}
            onAuditionPitch={handleAuditionPitch}
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
          style={style}
          onStyleChange={setStyle}
          chordVolume={volumes.chords}
          melodyVolume={volumes.melody}
          onVolumeChange={(voice, level) => setVolumes((v) => ({ ...v, [voice]: level }))}
          midiStatus={midiStatus}
          midiPorts={midiPorts}
          selectedMidiPortId={selectedPortId}
          onRequestMidiAccess={requestMidiAccess}
          onSelectMidiPort={selectMidiPort}
          onExportMidi={handleExportMidi}
          hasChordsInGrid={chords.some((c) => c !== null)}
        />
      </div>
    </DndContext>
  );
}
