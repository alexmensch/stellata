import { describe, expect, it } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { STAR_FORWARDED_ATTRIBUTES, STAR_STATIC_FIELDS } from '../star-attribute-roster';
import { StarTables } from './star-tables';
import { staticElement } from './star-tables-pure';
import { makeFakeStarRenderer, makeStarLayerSources } from './star-sources-mock';

function make(count = 8) {
  const { sources } = makeStarLayerSources(count);
  return { sources, tables: new StarTables(sources) };
}

describe('StarTables statics', () => {
  it('interleaves the catalogue and star-frame arrays once, at the roster slots', () => {
    const { sources } = makeStarLayerSources(4);
    sources.catalog.absmag[2] = 5.5;
    sources.distSol[1] = 42;
    sources.catalog.pulsColorSwing[3] = 0.25;
    const { statics } = new StarTables(sources);
    const table = statics.array as Float32Array;
    expect(table[staticElement(2, 'iAbsmag')]).toBe(5.5);
    expect(table[staticElement(1, 'iDistSol')]).toBe(42);
    expect(table[staticElement(3, 'iPulsColorSwing')]).toBe(0.25);
    expect(statics.isStorageBufferAttribute).toBe(true);
    expect(statics.itemSize).toBe(1);
  });
});

describe('StarTables forwarded attributes', () => {
  // Same array, itemSize 1: no copy to keep current, and no itemSize-3
  // storage attribute for three to re-stride behind the uploader
  // (../README.md § One writer per buffer per submit).
  // The two rosters partition every per-star field, and the partition is
  // what a new field has to join: `stat`, `forwardedAttribute`,
  // `StaticFieldSources` and `forwardedSourceAttrs` are all typed over
  // them, so a field the graph reads without a roster entry fails to
  // compile. What a type cannot say is that neither roster silently
  // shrank.
  it('partition every per-star field, four forwarded and eleven static', () => {
    expect(STAR_FORWARDED_ATTRIBUTES).toHaveLength(4);
    expect(STAR_STATIC_FIELDS).toHaveLength(11);
    const both = STAR_FORWARDED_ATTRIBUTES.filter(
      (n) => (STAR_STATIC_FIELDS as readonly string[]).includes(n));
    expect(both, 'a field in both rosters uploads twice and diverges').toEqual([]);
  });

  it('wrap the shell attribute arrays by identity as itemSize-1 storage', () => {
    const { sources, tables } = make();
    expect(tables.forwardedAttribute('iPosition').array).toBe(sources.iPositionAttr.array);
    expect(tables.forwardedAttribute('iEclipseDim').array).toBe(sources.iEclipseDimAttr.array);
    for (const name of STAR_FORWARDED_ATTRIBUTES) {
      const attr = tables.forwardedAttribute(name);
      expect(attr.itemSize).toBe(1);
      expect(attr.isStorageBufferAttribute).toBe(true);
    }
    expect(tables.forwardedAttribute('iPosition').count).toBe(8 * 3);
  });

  it('the first sync forwards every table — the sentinel fails first write', () => {
    const { tables } = make();
    const before = STAR_FORWARDED_ATTRIBUTES.map((n) => tables.forwardedAttribute(n).version);
    tables.syncSources();
    STAR_FORWARDED_ATTRIBUTES.forEach((n, i) => {
      expect(tables.forwardedAttribute(n).version).toBe(before[i] + 1);
    });
    tables.syncSources();
    STAR_FORWARDED_ATTRIBUTES.forEach((n, i) => {
      expect(tables.forwardedAttribute(n).version).toBe(before[i] + 1);
    });
  });

  it('forwards a ranged write verbatim, in element units, and consumes the source ranges', () => {
    const { sources, tables } = make();
    tables.syncSources();
    tables.endFrame();
    const src = sources.iPositionAttr;
    const dst = tables.forwardedAttribute('iPosition');
    (src.array as Float32Array).set([7, 8, 9], 5 * 3);
    src.addUpdateRange(15, 3);
    src.needsUpdate = true;
    const version = dst.version;
    tables.syncSources();
    expect(dst.version).toBe(version + 1);
    expect(dst.updateRanges).toEqual([{ start: 15, count: 3 }]);
    expect(src.updateRanges).toHaveLength(0);
  });

  it('leaves a table alone on a frame where its source was not flagged', () => {
    const { sources, tables } = make();
    tables.syncSources();
    tables.endFrame();
    const dst = tables.forwardedAttribute('iEclipseDim');
    const version = dst.version;
    (sources.iEclipseDimAttr.array as Float32Array)[2] = 0.25;
    tables.syncSources();
    expect(dst.version).toBe(version);
  });

  // three honours a non-empty range list INSTEAD of the full array, so a
  // range appended behind an unconsumed full upload would shrink it.
  it('drops ranges forwarded behind a pending full upload, until the frame ends', () => {
    const { sources, tables } = make();
    tables.syncSources();
    tables.endFrame();
    const src = sources.iCompositeSuppressAttr;
    const dst = tables.forwardedAttribute('iCompositeSuppress');
    src.needsUpdate = true;
    tables.syncSources();
    expect(dst.updateRanges).toHaveLength(0);
    src.addUpdateRange(2, 1);
    src.needsUpdate = true;
    tables.syncSources();
    expect(dst.updateRanges).toHaveLength(0);
    expect(src.updateRanges).toHaveLength(0);
    tables.endFrame();
    src.addUpdateRange(3, 1);
    src.needsUpdate = true;
    tables.syncSources();
    expect(dst.updateRanges).toEqual([{ start: 3, count: 1 }]);
  });

  it('a full write after pending ranges clears them — the full array wins', () => {
    const { sources, tables } = make();
    tables.syncSources();
    tables.endFrame();
    const src = sources.iEclipseDimAttr;
    const dst = tables.forwardedAttribute('iEclipseDim');
    src.addUpdateRange(1, 1);
    src.needsUpdate = true;
    tables.syncSources();
    expect(dst.updateRanges).toHaveLength(1);
    src.needsUpdate = true;
    tables.syncSources();
    expect(dst.updateRanges).toHaveLength(0);
  });
});

describe('StarTables dispose', () => {
  // None of these sits in a geometry, so only this call frees them
  // (../tsl/README.md § Storage attributes).
  it('releases the static table and every forwarded table through the renderer registry', () => {
    const { tables } = make();
    const fake = makeFakeStarRenderer();
    tables.dispose(fake.renderer as unknown as WebGPURenderer);
    expect(fake.released).toHaveLength(1 + STAR_FORWARDED_ATTRIBUTES.length);
    expect(fake.released).toContain(tables.statics);
    for (const n of STAR_FORWARDED_ATTRIBUTES) {
      expect(fake.released).toContain(tables.forwardedAttribute(n));
    }
  });

  it('resets the sentinels so a re-sync forwards everything again', () => {
    const { tables } = make();
    tables.syncSources();
    const dst = tables.forwardedAttribute('iPosition');
    const version = dst.version;
    tables.dispose(makeFakeStarRenderer().renderer as unknown as WebGPURenderer);
    tables.syncSources();
    expect(dst.version).toBe(version + 1);
  });
});
