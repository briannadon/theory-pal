import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModel } from './loadModel.ts';
import type { TransitionModel } from './types.ts';

const validModel: TransitionModel = {
  version: 1,
  generatedAt: '2026-07-23T00:00:00Z',
  source: 'test',
  songCount: 1,
  modes: { ionian: { order1: {}, order2: {}, totals1: {}, totals2: {} } },
};

describe('loadModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the parsed model on a successful fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(validModel), { status: 200 })),
    );
    const model = await loadModel('model/transitions.json');
    expect(model).toEqual(validModel);
  });

  it('resolves to null (not throw) when fetch rejects — network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(loadModel()).resolves.toBeNull();
  });

  it('resolves to null when the response is not ok (e.g. 404 — model not built yet)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    await expect(loadModel()).resolves.toBeNull();
  });

  it('resolves to null when the response body is not a well-formed TransitionModel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );
    await expect(loadModel()).resolves.toBeNull();
  });

  it('resolves to null when the response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json{{{', { status: 200 })),
    );
    await expect(loadModel()).resolves.toBeNull();
  });

  it('uses the provided url', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(validModel), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await loadModel('https://example.test/custom.json');
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/custom.json');
  });
});
