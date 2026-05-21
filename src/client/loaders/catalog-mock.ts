// Test-only Catalog factory. Production code never imports this. Tests
// across multiple folders synthesise a Catalog to exercise renderers /
// pickers / camera math without spinning up the binary loader; every
// version bump of the binary format would otherwise need to thread new
// fields through every duplicated mock. Single source of truth keeps
// the next field addition to one edit.
//
// Defaults are the "valid star, no companion" baseline: physicalRadius
// = 1 Rsol, companion = -1, lumClass = 255 (unknown), Apsis fields =
// NaN (the canonical NO_APSIS sentinel). Callers mutate per-row state
// after the factory returns.

import type { Catalog } from './catalog-loader';

function nanFloat32(count: number): Float32Array {
  // Matches the on-disk Apsis null sentinel (NO_APSIS = NaN). A
  // Float32Array seeded with `new Float32Array(count)` is zeros — which
  // would silently read as Teff=0 / logg=0 in any consumer treating the
  // value as "present" rather than "null". Use NaN to mirror the
  // production loader's behaviour for records absent from gspphot ∪
  // gspspec.
  const a = new Float32Array(count);
  a.fill(NaN);
  return a;
}

export function makeEmptyCatalog(count: number): Catalog {
  return {
    count,
    positions: new Float32Array(count * 3),
    absmag: new Float32Array(count),
    ci: new Float32Array(count),
    spectClass: new Float32Array(count),
    luminosityClass: new Uint8Array(count).fill(255),
    physicalRadius: new Float32Array(count).fill(1),
    constellation: new Float32Array(count),
    flags: new Uint8Array(count),
    companion: new Int32Array(count).fill(-1),
    periodDays: new Float32Array(count),
    amplitudeMag: new Float32Array(count),
    hip: new Uint32Array(count),
    gaiaSourceId: new BigUint64Array(count),
    teffGspphot: nanFloat32(count),
    loggGspphot: nanFloat32(count),
    mhGspphot: nanFloat32(count),
    azeroGspphot: nanFloat32(count),
    teffGspspec: nanFloat32(count),
    loggGspspec: nanFloat32(count),
    mhGspspec: nanFloat32(count),
    names: new Map(),
    solIndex: -1,
    constellations: [],
  };
}
