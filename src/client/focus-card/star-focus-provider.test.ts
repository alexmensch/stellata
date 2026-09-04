import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeEmptyCatalog } from '../loaders/catalog-mock';
import { setUnit } from '../ui/distance-util';
import { galacticDirToIcrs } from '../galactic/galactic-coords';
import { J2000_JD } from '../util/astronomy-constants';
import type { SearchEntry } from '../typeahead/search';
import type { BinariesData, BinaryRelation } from '../binaries/binaries-loader';
import { NO_PARENT } from '../binaries/binaries-loader';
import { KMS_PER_PC_YR } from '../format/velocity-format';
import {
  createStarFocusProvider,
  type StarFocusProviderConfig,
} from './star-focus-provider';
import type { FocusCardRow } from './focus-card-types';

// Vega-like fixture at idx 0: A0V dwarf with the full identity set.
function buildConfig(overrides: Partial<StarFocusProviderConfig> = {}): StarFocusProviderConfig {
  const catalog = makeEmptyCatalog(3);
  catalog.constellations = [{ code: 'Lyr', name: 'Lyra' }];
  catalog.constellation.set([0, 255, 255]);
  catalog.absmag.set([0.58, 1.43, 4.83]);
  catalog.physicalRadius.set([2.362, 1.71, 1]);
  catalog.spectClass.set([2, 2, 4]);
  catalog.luminosityClass.set([2, 2, 2]);
  catalog.teffGspphot[0] = 9602;
  catalog.hip.set([91262, 0, 0]);
  catalog.gaiaSourceId[1] = 123456789n;
  const searchEntries = new Map<number, SearchEntry>([
    [0, { i: 0, p: 'Vega', b: 'α', c: 0, hr: 7001, hd: 172167, hip: 91262 }],
  ]);
  return {
    catalog,
    starLabels: new Map([[0, 'Vega'], [1, 'Star B'], [2, 'Star C']]),
    spectralMap: new Map([[0, 'A0V']]),
    searchEntries,
    getBinaries: () => null,
    cameraDistancePc: () => 7.68,
    nowJd: () => J2000_JD,
    ...overrides,
  };
}

function rowValue(rows: FocusCardRow[], label: string): string | undefined {
  const row = rows.find((r) => r.label === label);
  if (!row) return undefined;
  return typeof row.value === 'function' ? row.value() : row.value;
}

describe('createStarFocusProvider', () => {
  beforeEach(() => setUnit('pc'));

  it('assembles the identity block: name, alternate designations, cleaned spectral', () => {
    const out = createStarFocusProvider(buildConfig()).format(0);
    expect(out.name).toBe('Vega');
    expect(out.identityLines[0]).toBe('α Lyr · HR 7001 · HD 172167 · HIP 91262');
    expect(out.identityLines[1]).toBe('A0 V · white main-sequence star');
  });

  it('renders intrinsic rows: radius, temperature, abs mag, constellation', () => {
    const out = createStarFocusProvider(buildConfig()).format(0);
    expect(rowValue(out.rows, 'Radius')).toBe('2.4 R☉');
    expect(rowValue(out.rows, 'Temperature')).toBe('9,602 K');
    expect(rowValue(out.rows, 'Abs mag')).toBe('0.58');
    expect(rowValue(out.rows, 'Constellation')).toBe('Lyra');
  });

  it('camera-frame rows are live and read the injected distance', () => {
    let d = 7.68;
    const provider = createStarFocusProvider(buildConfig({ cameraDistancePc: () => d }));
    const out = provider.format(0);
    expect(rowValue(out.rows, 'Distance')).toBe('7.7 pc');
    // App mag at 7.68 pc: 0.58 + 5·log10(7.68) − 5 ≈ +0.01.
    expect(rowValue(out.rows, 'App mag')).toBe('+0.0');
    d = 100;
    expect(rowValue(out.rows, 'Distance')).toBe('100 pc');
    expect(rowValue(out.rows, 'App mag')).toBe('+5.6');
    d = 10;
    // At 10 pc appMag equals absMag by definition — still shown.
    expect(rowValue(out.rows, 'App mag')).toBe('+0.6');
  });

  it('temperature: measured gspphot/gspspec first, else derived from the spectral class', () => {
    const config = buildConfig();
    // idx 2: no Gaia teff, no spectral string → no row.
    expect(rowValue(createStarFocusProvider(config).format(2).rows, 'Temperature')).toBeUndefined();
    // gspspec fallback when gspphot is absent.
    config.catalog.teffGspspec[2] = 5772;
    expect(rowValue(createStarFocusProvider(config).format(2).rows, 'Temperature')).toBe('5,772 K');
    // Derived (marked ~) from the raw classification when no Gaia teff.
    config.catalog.teffGspspec[2] = NaN;
    config.spectralMap.set(2, 'K0III');
    expect(rowValue(createStarFocusProvider(config).format(2).rows, 'Temperature')).toBe('~5,150 K');
    // Vega without its measured value would derive from A0V.
    config.catalog.teffGspphot[0] = NaN;
    expect(rowValue(createStarFocusProvider(config).format(0).rows, 'Temperature')).toBe('~9,790 K');
  });

  it('adds a Variable row for GCVS-matched variables', () => {
    const config = buildConfig();
    expect(rowValue(createStarFocusProvider(config).format(0).rows, 'Variable')).toBeUndefined();
    config.catalog.periodDays[0] = 332;
    config.catalog.amplitudeMag[0] = 7.6;
    expect(rowValue(createStarFocusProvider(config).format(0).rows, 'Variable')).toBe(
      'Period 332d · Δmag 7.6',
    );
  });

  it('renders velocity from the catalog space motion', () => {
    const config = buildConfig();
    // 14 km/s straight toward the galactic centre (ℓ=0, b=0): the ICRS
    // GC direction from galactic-coords, scaled to pc/yr.
    const dir = new THREE.Vector3();
    galacticDirToIcrs(0, 0, dir).multiplyScalar(14 / KMS_PER_PC_YR);
    config.catalog.velocities.set([dir.x, dir.y, dir.z], 0);
    const out = createStarFocusProvider(config).format(0);
    expect(rowValue(out.rows, 'Velocity')).toBe('14 km/s\nℓ 0° · b +0°');
  });

  it('coarse provenance reflects populated id fields, Tycho-2 when none, WDS for synths', () => {
    const config = buildConfig();
    expect(rowValue(createStarFocusProvider(config).format(0).rows, 'Known from')).toBe(
      'Hipparcos · HD',
    );
    expect(rowValue(createStarFocusProvider(config).format(1).rows, 'Known from')).toBe(
      'Gaia DR3',
    );
    // No ids at all: an AT-HYG Tycho-2-only star.
    expect(rowValue(createStarFocusProvider(config).format(2).rows, 'Known from')).toBe('Tycho-2');
    // Synthetic promoted companion: minted from a WDS measurement.
    config.catalog.flags[2] = 0x20;
    expect(rowValue(createStarFocusProvider(config).format(2).rows, 'Known from')).toBe('WDS');
  });

  it('omits the provenance row for Sol', () => {
    const config = buildConfig();
    config.catalog.solIndex = 2;
    expect(rowValue(createStarFocusProvider(config).format(2).rows, 'Known from')).toBeUndefined();
  });

  it('lists companions in a Known-companions row, one name per line', () => {
    const rel: BinaryRelation = {
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
      sepPaEpochJd: J2000_JD,
    };
    const rel2: BinaryRelation = { ...rel, secondaryIdx: 2 };
    const binaries: BinariesData = {
      version: 1,
      relations: [rel, rel2],
      primaryIdxToRelations: new Map([[0, [0, 1]]]),
      secondaryIdxToRelations: new Map([[1, [0]], [2, [1]]]),
    };
    const out = createStarFocusProvider(buildConfig({ getBinaries: () => binaries })).format(0);
    expect(rowValue(out.rows, 'Known companions')).toBe('Star B\nStar C');
    // Primary side renders as a row, not a full-width line block.
    expect(out.lines).toHaveLength(0);
  });

  it('appends a live companion block when binaries carry the star', () => {
    const rel: BinaryRelation = {
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
      sepPaEpochJd: J2000_JD,
    };
    const binaries: BinariesData = {
      version: 1,
      relations: [rel],
      primaryIdxToRelations: new Map([[0, [0]]]),
      secondaryIdxToRelations: new Map([[1, [0]]]),
    };
    const out = createStarFocusProvider(buildConfig({ getBinaries: () => binaries })).format(1);
    expect(out.lines).toHaveLength(1);
    const line = out.lines[0];
    const text = typeof line === 'function' ? line() : line;
    expect(text).toBe('Visual companion of Vega\nρ = 5.3″ · PA 132° at J2000.0');
  });

  it('no companion block when the star is in no relation', () => {
    expect(createStarFocusProvider(buildConfig()).format(0).lines).toHaveLength(0);
  });
});
