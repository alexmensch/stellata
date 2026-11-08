// Test-only builders for Stage 2's inputs and records.

import { splitComponents } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import type { GaiaAstrometryRow } from '../load/gaia-pure';
import { buildIndices, type CcdmIndex, type IdentifierIndices } from '../load/indices-pure';
import { athygRow, gaiaAstrometryRow, wdsPair } from '../load/load-fixture';
import type { SimbadWdsXid } from '../load/simbad-pure';
import type { WdsPair } from '../load/wds-pure';
import type { ResolvedComponent } from './components-pure';

export function ccdmIndex(rows: readonly { hip: number; ccdm: string }[]): CcdmIndex {
  const hipToCcdm = new Map<number, string>();
  const ccdmToHips = new Map<string, number[]>();
  for (const { hip, ccdm } of rows) {
    hipToCcdm.set(hip, ccdm);
    ccdmToHips.set(ccdm, [...(ccdmToHips.get(ccdm) ?? []), hip]);
  }
  return { hipToCcdm, ccdmToHips, rows: rows.length };
}

export function indices(over: {
  athyg?: readonly AthygRow[];
  hipToGaia?: ReadonlyMap<number, string>;
  srcToAstrometry?: ReadonlyMap<string, GaiaAstrometryRow>;
  ccdm?: readonly { hip: number; ccdm: string }[];
} = {}): IdentifierIndices {
  return buildIndices({
    athyg: over.athyg ?? [],
    hip2: new Map(),
    hipToGaia: over.hipToGaia ?? new Map(),
    tycToGaia: new Map(),
    srcToNss: new Map(),
    srcToAstrometry: over.srcToAstrometry ?? new Map(),
    ccdm: ccdmIndex(over.ccdm ?? []),
    simbadWdsSpectra: new Map(),
    componentSptypeOverrides: new Map(),
    athygGaiaMagRejected: [],
    msc: { orbitsByPair: new Map(), pairMags: new Map(), spectByComp: new Map(), nOrbitsUnmapped: 0 },
  });
}

export function resolved(over: Partial<ResolvedComponent> = {}): ResolvedComponent {
  return {
    wdsId: 'WDS-1', discoverer: 'TST   1', component: 'A', isPrimary: true,
    gaiaSourceId: null, resolveVia: 'unresolved', hip: null, athygRow: null, hd: null,
    ...over,
  };
}

/** A pair at a precise coord (none without `ra`/`dec`), no date or photometry. */
export function pairAt(over: Partial<WdsPair> & { ra?: number; dec?: number }): WdsPair {
  const { ra, dec, ...rest } = over;
  return wdsPair({
    wdsId: '14296-6241', components: 'Ca,Cb', dateLast: null, rhoLast: null, thetaLast: null,
    magPri: null, magSec: null, precise: ra === undefined || dec === undefined ? null : { raDeg: ra, decDeg: dec },
    ...rest,
  });
}

export function athygAt(over: Partial<AthygRow> & { ra: number; dec: number }): AthygRow {
  const { ra, dec, ...rest } = over;
  return athygRow({ raDeg: ra, decDeg: dec, ...rest });
}

export function xid(wdsId: string, component: string, gaiaSourceId: string | null, hip: number | null = null): SimbadWdsXid {
  return { wdsId, component, simbadOid: 1, simbadMainId: '* tst', gaiaSourceId, hip };
}

export const BI_WDS = '10000+0000';

export function biPair(wdsId: string, components: string, rho: number | null, theta: number | null, date = 2016): WdsPair {
  return wdsPair({
    wdsId, discoverer: 'X 1', components, dateLast: date, rhoLast: rho, thetaLast: theta,
    magPri: null, magSec: null, precise: null,
  });
}

export function biComp(
  wdsId: string, component: string, isPrimary: boolean, gaia: string | null, hip: number | null = null,
): ResolvedComponent {
  return resolved({
    wdsId, discoverer: 'X 1', component, isPrimary, gaiaSourceId: gaia,
    resolveVia: gaia === null ? 'unresolved' : 'simbad_xid', hip,
  });
}

/** A Gaia row (E, N) arcsec from RA 180°, Dec 0°. */
export function biAstro(sourceId: string, eArcsec: number, nArcsec: number): GaiaAstrometryRow {
  return gaiaAstrometryRow({
    sourceId, raDeg: 180 + eArcsec / 3600, decDeg: nArcsec / 3600, parallaxErrorMas: 0.1,
    pmraErrorMasyr: 0.1, pmdecErrorMasyr: 0.1, gMag: 5, bpMag: 5, rpMag: 5,
  });
}

export type BiRow = readonly [
  components: string, rho: number | null, theta: number | null,
  primary: readonly [string | null, number | null], secondary: readonly [string | null, number | null],
];

/** Pairs and their components in pair order, one WDS system. */
export function biSystem(rows: readonly BiRow[], wdsId = BI_WDS): { pairs: WdsPair[]; components: ResolvedComponent[] } {
  const pairs: WdsPair[] = [];
  const components: ResolvedComponent[] = [];
  for (const [comps, rho, theta, p, s] of rows) {
    const [pTok, sTok] = splitComponents(comps)!;
    pairs.push(biPair(wdsId, comps, rho, theta));
    components.push(biComp(wdsId, pTok, true, p[0], p[1]), biComp(wdsId, sTok, false, s[0], s[1]));
  }
  return { pairs, components };
}

export function astrometryMap(rows: readonly GaiaAstrometryRow[]): Map<string, GaiaAstrometryRow> {
  return new Map(rows.map((r) => [r.sourceId, r]));
}
