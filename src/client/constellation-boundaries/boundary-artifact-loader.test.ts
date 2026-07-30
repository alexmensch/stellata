import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundaryArtifactFixture as artifact } from '../../../scripts/catalog/boundaries/boundary-artifact-fixture';
import { loadBoundaries, validateBoundaryArtifact } from './boundary-artifact-loader';

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

  // A short label list is a partial sky: the missing names read as a
  // declutter decision rather than as a stale artifact.
  it('rejects a label list that does not cover every region', () => {
    expect(() => validateBoundaryArtifact(artifact({ labels: [] })))
      .toThrow(/0 label anchors for 89 regions/);
    const truncated = { c: 'AND', d: [1, 0] as unknown as [number, number, number], a: 1 };
    expect(() => validateBoundaryArtifact(artifact({
      labels: [...artifact().labels.slice(1), truncated],
    }))).toThrow(/label AND carries no direction/);
  });

  // The runtime membership lookup decodes this grid without a failure path of
  // its own, so a run list that stops short has to die here — decoded, its
  // unfilled cells resolve as a constellation named "undefined".
  it('rejects a region grid whose runs do not tile it', () => {
    const regions = artifact().regions;
    expect(() => validateBoundaryArtifact(artifact({
      regions: { ...regions, runs: regions.runs.slice(0, 2) },
    }))).toThrow(/region grid run 1 is malformed/);
    expect(() => validateBoundaryArtifact(artifact({
      regions: { ...regions, runs: [...regions.runs, 1, 0] },
    }))).toThrow(/carries 4 runs, 3 tile the grid/);
    expect(() => validateBoundaryArtifact(artifact({
      regions: { ...regions, runs: [3, 0, 1, 1, 2, 0] },
    }))).toThrow(/band 0 overruns 2 columns/);
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
      fade: { ...a.fade, quantilePcts: [0.1, 50], offsetsPc: [[0.14, 7], [0.31, 10]] },
    })).toThrow(/no 1% quantile/);
  });

  // A row narrower than the column header resolves a quantile to undefined,
  // which reaches the fade factor as NaN and stops the layer ever hiding —
  // the wrong partition then draws from every distance.
  it('rejects an offset row narrower than the quantile header', () => {
    const a = artifact();
    expect(() => validateBoundaryArtifact({
      ...a,
      fade: { ...a.fade, offsetsPc: [[0.14, 0.4], a.fade.offsetsPc[1]] },
    })).toThrow(/fade row 0 carries 2 offsets for 4 quantile columns/);
  });

  it('rejects magnitude rows that do not ascend — bracketing walks forwards', () => {
    const a = artifact();
    expect(() => validateBoundaryArtifact({
      ...a,
      fade: { ...a.fade, magLimits: [8, 6] },
    })).toThrow(/magLimits must ascend/);
  });

  // The unguarded dereference reports a raw TypeError instead of the named
  // diagnostic this function exists to produce.
  it('names the missing field rather than throwing a TypeError', () => {
    const a = artifact();
    expect(() => validateBoundaryArtifact({
      ...a,
      fade: { magLimits: [6], quantilePcts: [0.1, 1, 5, 50] },
    })).toThrow(/but no offset rows/);
    expect(() => validateBoundaryArtifact({
      ...a,
      fade: { ...a.fade, quantilePcts: undefined },
    })).toThrow(/no quantile columns/);
  });
});

// main.ts loads this inside a Promise.all alongside the catalog, so every
// failure mode here has to resolve null: a rejection would take the whole
// app's boot with it rather than dropping one optional layer.
describe('loadBoundaries', () => {
  const URL = '/constellation-boundaries.json';

  it('resolves the validated artifact on the happy path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => artifact() }));
    expect((await loadBoundaries(URL))?.segments.length).toBe(1);
  });

  it('resolves null when the artifact is absent — the layer is optional', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await loadBoundaries(URL)).toBeNull();
  });

  // `not_found_handling = "single-page-application"` (wrangler.toml) answers a
  // missing asset with index.html at 200, so a deployed build that never ran
  // build:catalog reaches the parse, not the !ok branch. Rejecting here blanked
  // the entire app instead of dropping the arcs.
  it('resolves null when the SPA fallback serves index.html at 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token \'<\''); },
    }));
    expect(await loadBoundaries(URL)).toBeNull();
  });

  it('resolves null when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));
    expect(await loadBoundaries(URL)).toBeNull();
  });

  it('warns and draws nothing on an artifact in the wrong frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...artifact(), frame: 'B1875' }),
    }));
    expect(await loadBoundaries(URL)).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/expected ICRS/);
    warn.mockRestore();
  });
});
