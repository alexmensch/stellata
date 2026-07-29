import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoundaryArtifact } from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { loadBoundaries, validateBoundaryArtifact } from './boundary-artifact-loader';

function artifact(): BoundaryArtifact {
  return {
    epoch: 'B1875',
    frame: 'ICRS',
    stepDeg: 0.5,
    segments: [{ k: 'M', c: ['DEL', 'AQL'], d: [1, 0, 0, 0, 1, 0] }],
    fade: {
      magLimits: [6, 8],
      quantilePcts: [0.1, 1, 5, 50],
      offsetsPc: [[0.14, 0.4, 0.9, 7], [0.31, 0.6, 1.5, 10]],
      sampleCounts: [3000, 20000],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateBoundaryArtifact', () => {
  it('accepts the shipped wire shape', () => {
    expect(validateBoundaryArtifact(artifact()).segments.length).toBe(1);
  });

  // The arcs are drawn at equinox B1875 but the directions are emitted in
  // ICRS. B1875 directions rendered as ICRS give a plausible sky ~1.4° off
  // every star, which no spot check catches.
  it('rejects a frame other than ICRS', () => {
    expect(() => validateBoundaryArtifact({ ...artifact(), frame: 'B1875' }))
      .toThrow(/frame is B1875, expected ICRS/);
    expect(() => validateBoundaryArtifact(null)).toThrow(/expected ICRS/);
  });

  it('rejects an empty segment list', () => {
    expect(() => validateBoundaryArtifact({ ...artifact(), segments: [] }))
      .toThrow(/no boundary segments/);
  });

  it('rejects a fade table with no rows', () => {
    const a = artifact();
    expect(() => validateBoundaryArtifact({
      ...a,
      fade: { ...a.fade, magLimits: [], offsetsPc: [] },
    })).toThrow(/no magnitude rows/);
  });

  it('rejects offset rows that disagree with the magnitude rows', () => {
    const a = artifact();
    expect(() => validateBoundaryArtifact({
      ...a,
      fade: { ...a.fade, offsetsPc: [a.fade.offsetsPc[0]] },
    })).toThrow(/2 magnitude rows but 1 offset rows/);
  });

  it('rejects a table missing a quantile the layer reads', () => {
    const a = artifact();
    expect(() => validateBoundaryArtifact({
      ...a,
      fade: { ...a.fade, quantilePcts: [0.1, 50] },
    })).toThrow(/no 1% quantile/);
  });
});

describe('loadBoundaries', () => {
  it('resolves null when the artifact is absent — the layer is optional', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await loadBoundaries('/constellation-boundaries.json')).toBeNull();
  });

  it('validates what it fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...artifact(), frame: 'B1875' }),
    }));
    await expect(loadBoundaries('/constellation-boundaries.json'))
      .rejects.toThrow(/expected ICRS/);
  });
});
