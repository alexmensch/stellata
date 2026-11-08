// The identifier indices every later stage looks up through, and the magnitude gate on HIP-anchored Gaia bindings.

import type { Hip2AstrometryRow } from '../../catalog/sources/hip2-source';
import { GAIA_BINDING_G_MINUS_V_REJECT_MAG } from '../../catalog/membership/binding/binding-gate-pure';
import type { ColumnTable } from '../../util/tsv/table-pure';
import type { AthygRow } from './athyg-pure';
import type { GaiaAstrometryRow, NssOrbitRow } from './gaia-pure';
import type { MscLookup } from './msc-pure';

export interface RejectedBinding {
  readonly hip: number | null;
  readonly sourceId: string;
}

export interface IdentifierIndices {
  readonly hipToGaia: ReadonlyMap<number, string>;
  readonly tycToGaia: ReadonlyMap<string, string>;
  /** The inverse of `hipToGaia`; a source several HIPs reach keeps the first. */
  readonly srcToHip: ReadonlyMap<string, number>;
  readonly srcToNss: ReadonlyMap<string, NssOrbitRow>;
  readonly srcToAstrometry: ReadonlyMap<string, GaiaAstrometryRow>;
  readonly hipToAthyg: ReadonlyMap<number, AthygRow>;
  readonly tycToAthyg: ReadonlyMap<string, AthygRow>;
  readonly srcToAthyg: ReadonlyMap<string, AthygRow>;
  readonly hipToHip2: ReadonlyMap<number, Hip2AstrometryRow>;
  /** The CCDM identifier anchors one multiple system; WDS ids match it for
   *  most systems, which is what the `ccdm_hip` tier keys on. */
  readonly hipToCcdm: ReadonlyMap<number, string>;
  readonly ccdmToHips: ReadonlyMap<string, readonly number[]>;
  /** `componentKey` → SIMBAD's per-component sp_type. */
  readonly simbadWdsSpectra: ReadonlyMap<string, string>;
  /** `componentKey` (raw multiples.tsv comp form) → curated MK type. */
  readonly componentSptypeOverrides: ReadonlyMap<string, string>;
  readonly xwalkMagRejected: readonly RejectedBinding[];
  readonly athygGaiaMagRejected: readonly RejectedBinding[];
  readonly msc: MscLookup;
}

/** A bound source more than the threshold fainter in G than the star's V
 *  cannot carry the light the HIP names. Missing V, an unpulled source or a
 *  missing G is unverifiable, and trusted. */
function magInconsistent(
  vMag: number | null, sourceId: string, astrometry: ReadonlyMap<string, GaiaAstrometryRow>,
): boolean {
  if (vMag === null) return false;
  const gMag = astrometry.get(sourceId)?.gMag ?? null;
  return gMag !== null && gMag - vMag > GAIA_BINDING_G_MINUS_V_REJECT_MAG;
}

export function scrubAthygGaia(
  athyg: readonly AthygRow[], astrometry: ReadonlyMap<string, GaiaAstrometryRow>,
): { rows: readonly AthygRow[]; rejected: readonly RejectedBinding[] } {
  const rejected: RejectedBinding[] = [];
  const rows = athyg.map((row) => {
    if (row.gaia === null || !magInconsistent(row.vMag, row.gaia, astrometry)) return row;
    rejected.push({ hip: row.hip, sourceId: row.gaia });
    return { ...row, gaia: null };
  });
  return { rows, rejected };
}

/** Every HIP → CCDM row with a CCDM identifier, in file order. */
export function parseCcdmIndex(table: ColumnTable): { hipToCcdm: Map<number, string>; ccdmToHips: Map<string, number[]> } {
  const hipToCcdm = new Map<number, string>();
  const ccdmToHips = new Map<string, number[]>();
  for (const row of table(['HIP', 'CCDM'] as const)) {
    const hip = row.int('HIP');
    const ccdm = row.text('CCDM');
    if (hip === null || ccdm === null) continue;
    hipToCcdm.set(hip, ccdm);
    const hips = ccdmToHips.get(ccdm);
    if (hips) hips.push(hip);
    else ccdmToHips.set(ccdm, [hip]);
  }
  return { hipToCcdm, ccdmToHips };
}

export interface IndexInputs {
  /** Already through `scrubAthygGaia`. */
  readonly athyg: readonly AthygRow[];
  readonly hip2: ReadonlyMap<number, Hip2AstrometryRow>;
  readonly hipToGaia: ReadonlyMap<number, string>;
  readonly tycToGaia: ReadonlyMap<string, string>;
  readonly srcToNss: ReadonlyMap<string, NssOrbitRow>;
  readonly srcToAstrometry: ReadonlyMap<string, GaiaAstrometryRow>;
  readonly ccdm: { readonly hipToCcdm: ReadonlyMap<number, string>; readonly ccdmToHips: ReadonlyMap<string, readonly number[]> };
  readonly simbadWdsSpectra: ReadonlyMap<string, string>;
  readonly componentSptypeOverrides: ReadonlyMap<string, string>;
  readonly athygGaiaMagRejected: readonly RejectedBinding[];
  readonly msc: MscLookup;
}

/** The lookups, with the magnitude gate applied to the HIP → DR3 cross-walk
 *  (keyed on the HIP's AT-HYG V) before its inverse is taken, so no rejected
 *  source is ever attributed to the HIP. A later AT-HYG row wins a shared
 *  identifier. */
export function buildIndices(inputs: IndexInputs): IdentifierIndices {
  const hipToAthyg = new Map<number, AthygRow>();
  const tycToAthyg = new Map<string, AthygRow>();
  const srcToAthyg = new Map<string, AthygRow>();
  for (const row of inputs.athyg) {
    if (row.hip !== null) hipToAthyg.set(row.hip, row);
    if (row.tyc !== null) tycToAthyg.set(row.tyc, row);
    if (row.gaia !== null) srcToAthyg.set(row.gaia, row);
  }

  const xwalkMagRejected: RejectedBinding[] = [];
  const hipToGaia = new Map<number, string>();
  for (const [hip, sourceId] of inputs.hipToGaia) {
    const athygRow = hipToAthyg.get(hip);
    if (athygRow !== undefined && magInconsistent(athygRow.vMag, sourceId, inputs.srcToAstrometry)) {
      xwalkMagRejected.push({ hip, sourceId });
      continue;
    }
    hipToGaia.set(hip, sourceId);
  }
  const srcToHip = new Map<string, number>();
  for (const [hip, sourceId] of hipToGaia) if (!srcToHip.has(sourceId)) srcToHip.set(sourceId, hip);

  return {
    hipToGaia,
    tycToGaia: inputs.tycToGaia,
    srcToHip,
    srcToNss: inputs.srcToNss,
    srcToAstrometry: inputs.srcToAstrometry,
    hipToAthyg,
    tycToAthyg,
    srcToAthyg,
    hipToHip2: inputs.hip2,
    hipToCcdm: inputs.ccdm.hipToCcdm,
    ccdmToHips: inputs.ccdm.ccdmToHips,
    simbadWdsSpectra: inputs.simbadWdsSpectra,
    componentSptypeOverrides: inputs.componentSptypeOverrides,
    xwalkMagRejected,
    athygGaiaMagRejected: inputs.athygGaiaMagRejected,
    msc: inputs.msc,
  };
}
