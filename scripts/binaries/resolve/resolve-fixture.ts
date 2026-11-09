// Test-only builders for Stage 2's inputs and records.

import type { AthygRow } from '../load/athyg-pure';
import type { GaiaAstrometryRow } from '../load/gaia-pure';
import { buildIndices, type CcdmIndex, type IdentifierIndices } from '../load/indices-pure';
import { wdsPair } from '../../wds/wds-fixture';
import { athygRow, gaiaAstrometryRow } from '../load/load-fixture';
import type { SimbadWdsXid } from '../load/simbad-pure';
import { splitComponents, type WdsPair } from '../../wds/wds-pure';
import { componentsOf, type DecomposedPair, type ResolvedComponent } from './components-pure';
import { ARCSEC_PER_DEG } from '../../../src/astro-core/astronomy-constants';
import { pushTo } from '../../util/map-buckets-pure';

export function ccdmIndex(rows: readonly { hip: number; ccdm: string }[]): CcdmIndex {
  const hipToCcdm = new Map<number, string>();
  const ccdmToHips = new Map<string, number[]>();
  for (const { hip, ccdm } of rows) {
    hipToCcdm.set(hip, ccdm);
    pushTo(ccdmToHips, ccdm, hip);
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

/** Bound to a source no test asks about, so the cascade passes skip it. */
export const BYSTANDER_SOURCE = '0';

export type Side = Partial<ResolvedComponent>;

/** `pair` with its split tokens; a side not given is a bound bystander. */
export function decomposed(pair: WdsPair, sides: { primary?: Side; secondary?: Side } = {}): DecomposedPair {
  const tokens = splitComponents(pair.components)!;
  const side = (i: 0 | 1, over: Side | undefined): ResolvedComponent => resolved({
    wdsId: pair.wdsId, discoverer: pair.discoverer, component: tokens[i], isPrimary: i === 0,
    ...(over ?? { gaiaSourceId: BYSTANDER_SOURCE, resolveVia: 'orb6_hip' }),
  });
  return { pair, tokens, primary: side(0, sides.primary), secondary: side(1, sides.secondary) };
}

/** One component on a pair row of its own, partnered by a bound bystander `Q`. */
export function alone(c: ResolvedComponent): DecomposedPair {
  const pair = wdsPair({ wdsId: c.wdsId, discoverer: c.discoverer, components: c.isPrimary ? `${c.component},Q` : `Q,${c.component}` });
  return c.isPrimary ? decomposed(pair, { primary: c }) : decomposed(pair, { secondary: c });
}

/** The components `alone` wrapped, without their bystanders. */
export function lone(pairs: readonly DecomposedPair[]): ResolvedComponent[] {
  return componentsOf(pairs).filter((c) => c.component !== 'Q');
}

export function biPair(wdsId: string, components: string, rho: number | null, theta: number | null, date = 2016): WdsPair {
  return wdsPair({
    wdsId, discoverer: 'X 1', components, dateLast: date, rhoLast: rho, thetaLast: theta,
    magPri: null, magSec: null, precise: null,
  });
}

function biSide(gaia: string | null, hip: number | null): Side {
  return { gaiaSourceId: gaia, resolveVia: gaia === null ? 'unresolved' : 'simbad_xid', hip };
}

/** A Gaia row (E, N) arcsec from RA 180°, Dec 0°. */
export function biAstro(sourceId: string, eArcsec: number, nArcsec: number): GaiaAstrometryRow {
  return gaiaAstrometryRow({
    sourceId, raDeg: 180 + eArcsec / ARCSEC_PER_DEG, decDeg: nArcsec / ARCSEC_PER_DEG, parallaxErrorMas: 0.1,
    pmraErrorMasyr: 0.1, pmdecErrorMasyr: 0.1, gMag: 5, bpMag: 5, rpMag: 5,
  });
}

export type BiRow = readonly [
  components: string, rho: number | null, theta: number | null,
  primary: readonly [string | null, number | null], secondary: readonly [string | null, number | null],
];

/** One WDS system's pairs, each side bound as the row gives it. */
export function biSystem(rows: readonly BiRow[], wdsId = BI_WDS): DecomposedPair[] {
  return rows.map(([comps, rho, theta, p, s]) =>
    decomposed(biPair(wdsId, comps, rho, theta), { primary: biSide(p[0], p[1]), secondary: biSide(s[0], s[1]) }));
}

export function astrometryMap(rows: readonly GaiaAstrometryRow[]): Map<string, GaiaAstrometryRow> {
  return new Map(rows.map((r) => [r.sourceId, r]));
}
