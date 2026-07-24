import { describe, expect, it, vi } from 'vitest';
import { WebMidiOut } from './out.ts';

interface FakeOutput {
  id: string;
  name: string;
  manufacturer: string | null;
  send: ReturnType<typeof vi.fn>;
  clear?: ReturnType<typeof vi.fn>;
}

function makeFakeOutput(id: string, name = id): FakeOutput {
  return { id, name, manufacturer: null, send: vi.fn(), clear: vi.fn() };
}

function fakeAccess(outputs: FakeOutput[]): MIDIAccess {
  const map = new Map(outputs.map((o) => [o.id, o]));
  return { outputs: map } as unknown as MIDIAccess;
}

describe('WebMidiOut', () => {
  it('never calls requestMIDIAccess at construction time', () => {
    const requestMIDIAccessFn = vi.fn();
    new WebMidiOut({ requestMIDIAccessFn });
    expect(requestMIDIAccessFn).not.toHaveBeenCalled();
  });

  it('available is false until requestAccess() succeeds', async () => {
    const outA = makeFakeOutput('a', 'Virtual Out A');
    const requestMIDIAccessFn = vi.fn(async () => fakeAccess([outA]));
    const midi = new WebMidiOut({ requestMIDIAccessFn });
    expect(midi.available).toBe(false);

    const ports = await midi.requestAccess();
    expect(midi.available).toBe(true);
    expect(ports).toEqual([{ id: 'a', name: 'Virtual Out A', manufacturer: undefined }]);
  });

  it('degrades quietly on denial: available stays false, no throw, empty port list', async () => {
    const requestMIDIAccessFn = vi.fn(async () => {
      throw new DOMException('denied', 'SecurityError');
    });
    const midi = new WebMidiOut({ requestMIDIAccessFn });
    await expect(midi.requestAccess()).resolves.toEqual([]);
    expect(midi.available).toBe(false);
  });

  it('degrades quietly when requestMIDIAccess is unsupported entirely (rejects/throws)', async () => {
    const requestMIDIAccessFn = vi.fn(async () => {
      throw new Error('requestMIDIAccess is not a function');
    });
    const midi = new WebMidiOut({ requestMIDIAccessFn });
    await expect(midi.requestAccess()).resolves.toEqual([]);
    expect(midi.available).toBe(false);
  });

  it('sendChord / selectPort / stopAll no-op safely when unavailable or no port selected', async () => {
    const midi = new WebMidiOut({ requestMIDIAccessFn: vi.fn(async () => fakeAccess([])) });
    expect(() => midi.selectPort('nonexistent')).not.toThrow();
    expect(() => midi.sendChord([60, 64, 67], 500)).not.toThrow();
    expect(() => midi.stopAll()).not.toThrow();

    await midi.requestAccess(); // available, but no ports exist to select
    midi.selectPort('anything');
    expect(() => midi.sendChord([60], 500)).not.toThrow();
  });

  it('selectPort switches the active output; sendChord targets only the selected one', async () => {
    const outA = makeFakeOutput('a');
    const outB = makeFakeOutput('b');
    const midi = new WebMidiOut({ requestMIDIAccessFn: vi.fn(async () => fakeAccess([outA, outB])) });
    await midi.requestAccess();

    midi.selectPort('b');
    midi.sendChord([60], 200, 90);
    expect(outA.send).not.toHaveBeenCalled();
    expect(outB.send).toHaveBeenCalled();
  });

  it('sendChord sends note-on then a matching note-off, timed from durationMs', async () => {
    const out = makeFakeOutput('a');
    const now = vi.fn(() => 1000);
    const midi = new WebMidiOut({ requestMIDIAccessFn: vi.fn(async () => fakeAccess([out])), now });
    await midi.requestAccess();
    midi.selectPort('a');

    midi.sendChord([60, 64, 67], 500, 90);

    expect(out.send).toHaveBeenCalledTimes(6); // 3 note-ons + 3 note-offs
    expect(out.send).toHaveBeenNthCalledWith(1, [0x90, 60, 90], undefined);
    expect(out.send).toHaveBeenNthCalledWith(2, [0x90, 64, 90], undefined);
    expect(out.send).toHaveBeenNthCalledWith(3, [0x90, 67, 90], undefined);
    expect(out.send).toHaveBeenNthCalledWith(4, [0x80, 60, 0], 1500);
    expect(out.send).toHaveBeenNthCalledWith(5, [0x80, 64, 0], 1500);
    expect(out.send).toHaveBeenNthCalledWith(6, [0x80, 67, 0], 1500);
  });

  it('sendChord with an explicit whenMs schedules both note-on and note-off via timestamps', async () => {
    const out = makeFakeOutput('a');
    const midi = new WebMidiOut({ requestMIDIAccessFn: vi.fn(async () => fakeAccess([out])) });
    await midi.requestAccess();
    midi.selectPort('a');

    midi.sendChord([60], 250, 100, 5000);

    expect(out.send).toHaveBeenNthCalledWith(1, [0x90, 60, 100], 5000);
    expect(out.send).toHaveBeenNthCalledWith(2, [0x80, 60, 0], 5250);
  });

  it('sendChord defaults velocity to 100', async () => {
    const out = makeFakeOutput('a');
    const midi = new WebMidiOut({ requestMIDIAccessFn: vi.fn(async () => fakeAccess([out])) });
    await midi.requestAccess();
    midi.selectPort('a');

    midi.sendChord([60], 100);
    expect(out.send).toHaveBeenNthCalledWith(1, [0x90, 60, 100], undefined);
  });

  it('stopAll sends All Sound Off and All Notes Off, and calls clear() if present', async () => {
    const out = makeFakeOutput('a');
    const midi = new WebMidiOut({ requestMIDIAccessFn: vi.fn(async () => fakeAccess([out])) });
    await midi.requestAccess();
    midi.selectPort('a');

    midi.stopAll();

    expect(out.clear).toHaveBeenCalledTimes(1);
    expect(out.send).toHaveBeenCalledWith([0xb0, 120, 0]);
    expect(out.send).toHaveBeenCalledWith([0xb0, 123, 0]);
  });

  it('stopAll tolerates an output with no clear() method', async () => {
    const out = makeFakeOutput('a');
    delete out.clear;
    const midi = new WebMidiOut({ requestMIDIAccessFn: vi.fn(async () => fakeAccess([out])) });
    await midi.requestAccess();
    midi.selectPort('a');
    expect(() => midi.stopAll()).not.toThrow();
  });
});
