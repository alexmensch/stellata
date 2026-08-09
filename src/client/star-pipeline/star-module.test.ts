// Star kind-module contract: absence before load, the load pair with
// the onProgress leg, and every capability leg over the injected
// runtime + name tables.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  CATALOG_MANIFEST_FILENAME,
  type SearchEntry,
} from '../../../scripts/catalog/catalog-pure';
import type { BinariesData } from '../binaries/binaries-loader';
import { NO_PARENT } from '../binaries/binaries-loader';
import { makeKindContext } from '../kinds/kind-context-mock';
import { makeEmptyCatalog } from '../loaders/catalog-mock';
import type { Catalog } from '../loaders/catalog-loader';
import { MIN_PHYSICAL_RADIUS_R_SUN, R_SUN_PC } from '../util/astronomy-constants';
import { createStarKindModule, type StarModuleRuntime } from './star-module';

const loadCatalogMock = vi.hoisted(() => vi.fn());
vi.mock('../loaders/catalog-loader', () => ({ loadCatalog: loadCatalogMock }));

function makeMockCatalog(): Catalog {
  const cat = makeEmptyCatalog(4);
  cat.constellation.fill(255);
  cat.positions.set([0, 0, 0, 1, 2, 3, 0, 0, 9, 0, 0, 0]);
  cat.sid.set([7, 42, 43, 0]);
  cat.gaiaSourceId[2] = 123n;
  return cat;
}

function makeRuntime(overrides: Partial<StarModuleRuntime> = {}): StarModuleRuntime {
  return {
    localPositionInto: (idx, out) => out.set(idx, 0, 0),
    parkDistForStar: () => 1.5,
    renderedSizePx: () => 12,
    pickStarHit: () => null,
    getBinaries: () => null,
    ...overrides,
  };
}

async function loadedModule(searchRows: SearchEntry[] = []) {
  const cat = makeMockCatalog();
  loadCatalogMock.mockResolvedValue(cat);
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => searchRows })));
  const m = createStarKindModule();
  await m.load('/base/');
  return { m, cat };
}

afterEach(() => {
  vi.unstubAllGlobals();
  loadCatalogMock.mockReset();
});

describe('star kind module', () => {
  it('is the critical module and degrades to absence before load', () => {
    const m = createStarKindModule();
    expect(m.critical).toBe(true);
    expect(m.pinnable(0)).toBe(false);
    expect(m.displayName(0)).toBe('');
    expect(m.sids()).toBeNull();
    expect(m.searchEntries()).toEqual([]);
    expect(m.photometry(0)).toBeNull();
    expect(() => m.catalog).toThrow(/before load/);
    expect(() => m.searchIndex).toThrow(/before load/);
    expect(() => m.starLabels).toThrow(/before load/);
  });

  it('answers photometry once, for the arrival radius and KindContext alike', async () => {
    const { m } = await loadedModule();
    const radiusPc = Math.max(1, MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC;
    expect(m.photometry(1)).toEqual({ absMag: 0, radiusPc });
    expect(m.photometry(-1)).toBeNull();
    expect(m.photometry(4)).toBeNull();
    expect(m.focusable().arrivalRadiusPc?.(1)).toBe(radiusPc);
    expect(m.focusable().arrivalRadiusPc?.(4)).toBeNull();
  });

  it('loads the catalog + search index pair, forwarding onProgress', async () => {
    const cat = makeMockCatalog();
    loadCatalogMock.mockResolvedValue(cat);
    const fetchMock = vi.fn(async () => ({ json: async () => [{ i: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);
    const m = createStarKindModule();
    const onProgress = () => {};
    await m.load('/base/', onProgress);
    expect(loadCatalogMock).toHaveBeenCalledWith(
      `/base/${CATALOG_MANIFEST_FILENAME}`,
      '/base/constellations.json',
      onProgress,
    );
    expect(fetchMock).toHaveBeenCalledWith('/base/search-index.json');
    expect(m.catalog).toBe(cat);
    expect(m.searchIndex).toEqual([{ i: 1 }]);
  });

  it('answers the SID domain as the catalog column itself', async () => {
    const { m, cat } = await loadedModule();
    expect(m.sids()).toBe(cat.sid);
  });

  it('pins only in-range records with an allocated SID', async () => {
    const { m } = await loadedModule();
    expect(m.pinnable(1)).toBe(true);
    expect(m.pinnable(3)).toBe(false);
    expect(m.pinnable(-1)).toBe(false);
    expect(m.pinnable(4)).toBe(false);
  });

  it('derives its name tables at load, then resolves the label tier ladder', async () => {
    const { m } = await loadedModule([{ i: 1, hip: 91262 }]);
    expect(m.starLabels.get(1)).toBe('HIP 91262');
    expect(m.displayName(1)).toBe('HIP 91262');
    expect(m.displayName(2)).toBe('Gaia DR3 123');
    expect(m.displayName(0)).toBe('Unnamed (SID #7)');
  });

  it('attaches layer-less and drives the uHideFocusIdx pin', async () => {
    const { m } = await loadedModule();
    const ctx = makeKindContext();
    m.setFocalHidden?.(5);
    expect(m.attach(ctx)).toBeNull();
    m.setFocalHidden?.(5);
    expect((ctx.sharedUniforms.uHideFocusIdx as { value: number }).value).toBe(5);
    m.setFocalHidden?.(-1);
    expect((ctx.sharedUniforms.uHideFocusIdx as { value: number }).value).toBe(-1);
  });

  it('serves the focusable legs from catalog + runtime', async () => {
    const { m } = await loadedModule();
    const ctx = makeKindContext();
    m.attach(ctx);
    m.setRuntime(makeRuntime());
    const f = m.focusable();
    const out = new THREE.Vector3();

    expect(f.anchorInto(1, out)).toBe(true);
    expect(out.toArray()).toEqual([1, 2, 3]);
    expect(f.anchorInto(-1, out)).toBe(false);
    expect(f.anchorInto(4, out)).toBe(false);

    expect(f.localPositionInto(2, out)).toBe(true);
    expect(out.x).toBe(2);
    expect(f.localPositionInto(4, out)).toBe(false);

    expect(f.focusParkDistance(0)).toBe(1.5);
    expect(f.renderedSizePx(0)).toBe(12);
    expect(f.orbitFloor(0)).toBeGreaterThan(0);
    expect(f.arrivalRadiusPc?.(0)).toBe(
      Math.max(1, MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC,
    );
    expect(f.chartPlateauDistance?.(0, 2)).toBeGreaterThan(0);
    expect(f.planetSystemHost?.(2)).toBe(2);
  });

  it('hover pick IS the runtime star pick; format answers a payload', async () => {
    const { m } = await loadedModule();
    const ctx = makeKindContext();
    m.attach(ctx);
    const hit = { idx: 2, cameraDistancePc: 4, tier: 'prime' as const };
    const pickStarHit = vi.fn(() => hit);
    m.setRuntime(makeRuntime({ pickStarHit }));
    const hover = m.hover!();
    expect(hover.pick(10, 20, 14)).toBe(hit);
    expect(pickStarHit).toHaveBeenCalledWith(10, 20, 14);
    const payload = hover.format(hit);
    expect(payload?.name).toBe('Gaia DR3 123');
  });

  it('reads binaries per format call, so a late attach reaches a built card', async () => {
    const { m } = await loadedModule([{ i: 1, hip: 91262 }]);
    const ctx = makeKindContext();
    m.attach(ctx);
    let binaries: BinariesData | null = null;
    m.setRuntime(makeRuntime({ getBinaries: () => binaries }));
    const card = m.card();
    const companionsOf = (idx: number) =>
      card.format(idx).rows.find((r) => r.label === 'Known companions')?.value;

    expect(companionsOf(0)).toBeUndefined();
    binaries = {
      version: 1,
      relations: [{
        primaryIdx: 0,
        secondaryIdx: 1,
        flags: 0,
        parentRelation: NO_PARENT,
        pDays: NaN,
        tJd: NaN,
        e: NaN,
        aAU: NaN,
        iRad: NaN,
        omegaRad: NaN,
        OmegaRad: NaN,
        q: NaN,
        sepArcsec: 5.3,
        paDeg: 132,
        sepPaEpochJd: 0,
      }],
      primaryIdxToRelations: new Map([[0, [0]]]),
      secondaryIdxToRelations: new Map([[1, [0]]]),
    };
    expect(companionsOf(0)).toBe('HIP 91262');
  });

  it('card rows read the runtime local frame for the live distance', async () => {
    const { m } = await loadedModule();
    const ctx = makeKindContext();
    ctx.camera.position.set(0, 0, 0);
    m.attach(ctx);
    m.setRuntime(makeRuntime());
    const content = m.card().format(2);
    expect(content.name).toBe('Gaia DR3 123');
    const distance = content.rows.find((r) => r.label === 'Distance')!;
    expect((distance.value as () => string)()).toBe('6.5 ly');
  });
});
