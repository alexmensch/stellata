// Stage 1: every reference catalogue read through its declaration, assembled into the frozen ReferenceCatalogs. See README.md.

import type { Hip2AstrometryRow } from '../../catalog/sources/hip2-source';
import { HIP2 } from '../../catalog/sources/hip2-source';
import { GAIA_HIP_XMATCH } from '../../catalog/parse/gaia-hip-xmatch-source';
import { GAIA_TYC_XMATCH } from '../../catalog/parse/gaia-tyc-xmatch-source';
import { GAIA_NSS } from '../../catalog/sources/gaia-nss-source';
import { HIP_CCDM } from '../../catalog/multiplicity/hip-ccdm-source';
import { ATHYG_CLASSIC_IDS } from '../../catalog/spine/athyg-classic-ids-source';
import { SIMBAD_WDS_XIDS } from '../../catalog/membership/binding/simbad-wds-xids-source';
import { bandCheck, type RowBand } from '../../refresh/pull/gates-pure';
import type { Check } from '../../util/emit-artifacts';
import { fold } from '../../util/counts/tally-pure';
import { parseAthygRows, type AthygRow } from './athyg-pure';
import { BINARIES_ASTROMETRY } from './binaries-astrometry-source';
import {
  BLANK_RESCUE_OUTCOMES, rescueBlankComponents, type BlankRescueOutcome,
} from './blank-rescue-pure';
import { ASTROMETRY_EXCLUSIONS, COMPONENT_SPTYPE_OVERRIDES, ORB6_COMPONENT_OVERRIDES } from './curated-source';
import { parseNssOrbits, type GaiaAstrometryRow, type NssOrbitRow } from './gaia-pure';
import {
  buildIndices, parseCcdmIndex, scrubAthygGaia, type IdentifierIndices,
} from './indices-pure';
import {
  buildMscLookup, type MscComponentRow, type MscOrbitRow, type MscSystemRow,
} from './msc-pure';
import { MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS } from './msc-source';
import { joinSimbadWdsSpectra, parseSimbadWdsXids, type SimbadWdsXid } from './simbad-pure';
import { SIMBAD_WDS_SPTYPE } from './simbad-wds-sptype-source';
import {
  MSC_SYNTHESIS_OUTCOMES, applyOrb6ComponentOverrides, synthesizeMscInnerPairs, synthesizeOrb6OrphanPairs,
  type MscSynthesisOutcome,
} from './subdivide-pure';
import { dedupWdsPairRows, type Orb6Entry, type Orb6Parse, type WdsPair } from './wds-pure';
import { ORB6, WDS_SUMM } from './wds-source';

/** Expected parse cardinalities, about 10% either side of the frozen
 *  catalogues; a new upstream release re-pins them deliberately. CCDM is the
 *  whole Hipparcos main catalogue's slice, not its double-star subset. */
export const ROW_BANDS = {
  wdsSumm: { min: 140_000, max: 174_000 },
  orb6: { min: 3_600, max: 4_500 },
  athyg: { min: 280_000, max: 345_000 },
  ccdm: { min: 100_000, max: 140_000 },
  hip2: { min: 106_000, max: 130_000 },
} as const satisfies Record<string, RowBand>;

/** Everything Stage 1 read, before any of it is combined. */
export interface Stage1Inputs {
  readonly wdsSumm: readonly WdsPair[];
  readonly orb6: Orb6Parse;
  readonly orb6ComponentOverrides: ReadonlyMap<string, string>;
  readonly athyg: readonly AthygRow[];
  readonly ccdm: ReturnType<typeof parseCcdmIndex> & { readonly rows: number };
  readonly hip2: ReadonlyMap<number, Hip2AstrometryRow>;
  readonly hipToGaia: ReadonlyMap<number, string>;
  readonly tycToGaia: ReadonlyMap<string, string>;
  readonly nss: ReadonlyMap<string, NssOrbitRow>;
  readonly astrometry: ReadonlyMap<string, GaiaAstrometryRow>;
  readonly astrometryExclusions: ReadonlyMap<string, string>;
  readonly simbadWdsXids: ReadonlyMap<string, SimbadWdsXid>;
  readonly simbadSptypeByOid: ReadonlyMap<number, string>;
  readonly componentSptypeOverrides: ReadonlyMap<string, string>;
  readonly msc: {
    readonly systems: readonly MscSystemRow[];
    readonly orbits: readonly MscOrbitRow[];
    readonly components: readonly MscComponentRow[];
  };
}

export interface ReferenceCatalogs {
  /** The deduplicated WDS rows (blank-components rows rescued to AB), then
   *  the ORB6 orphan pairs, then the MSC inner pairs. */
  readonly pairs: readonly WdsPair[];
  readonly synthesizedOrb6Pairs: readonly WdsPair[];
  readonly synthesizedMscPairs: readonly WdsPair[];
  /** Curated letters applied, blank rows under a rescued system aligned to AB. */
  readonly orb6: readonly Orb6Entry[];
  /** `gaia` emptied where the magnitude gate refused it. */
  readonly athyg: readonly AthygRow[];
  readonly indices: IdentifierIndices;
  /** Keyed `componentKey`. */
  readonly simbadWdsXids: ReadonlyMap<string, SimbadWdsXid>;
  readonly wdsDuplicatePairRowsDropped: number;
  readonly orb6OverridesApplied: number;
  readonly orb6GradeFallbacks: number;
  /** Excluded sources that were in the astrometry pull. */
  readonly astrometryExcluded: number;
  readonly blankRescue: readonly BlankRescueOutcome[];
  readonly mscSynthesis: readonly MscSynthesisOutcome[];
  /** The row-band checks; the shell hands them to emitArtifacts. */
  readonly checks: readonly Check[];
}

function freezeAll<T extends object>(rows: readonly T[]): readonly T[] {
  for (const row of rows) Object.freeze(row);
  return Object.freeze(rows);
}

/** README.md#the-order-of-the-passes */
export function assembleReferenceCatalogs(inputs: Stage1Inputs): ReferenceCatalogs {
  const deduped = dedupWdsPairRows(inputs.wdsSumm);
  const overridden = applyOrb6ComponentOverrides(inputs.orb6.entries, inputs.orb6ComponentOverrides);
  const orphans = synthesizeOrb6OrphanPairs(deduped.pairs, overridden.entries);

  const srcToAstrometry = new Map(
    [...inputs.astrometry].filter(([sourceId]) => !inputs.astrometryExclusions.has(sourceId)),
  );
  const scrubbed = scrubAthygGaia(inputs.athyg, srcToAstrometry);
  const msc = buildMscLookup(inputs.msc.systems, inputs.msc.orbits, inputs.msc.components);
  const indices = buildIndices({
    athyg: scrubbed.rows,
    hip2: inputs.hip2,
    hipToGaia: inputs.hipToGaia,
    tycToGaia: inputs.tycToGaia,
    srcToNss: inputs.nss,
    srcToAstrometry,
    ccdm: inputs.ccdm,
    simbadWdsSpectra: joinSimbadWdsSpectra(inputs.simbadSptypeByOid, inputs.simbadWdsXids),
    componentSptypeOverrides: inputs.componentSptypeOverrides,
    athygGaiaMagRejected: scrubbed.rejected,
    msc,
  });

  const simbadWdsIds = new Set([...inputs.simbadWdsXids.values()].map((x) => x.wdsId));
  const rescue = rescueBlankComponents([...deduped.pairs, ...orphans], overridden.entries, simbadWdsIds, orphans);
  const mscPairs = synthesizeMscInnerPairs(rescue.pairs, msc);

  return Object.freeze({
    pairs: freezeAll([...rescue.pairs, ...mscPairs.pairs]),
    synthesizedOrb6Pairs: freezeAll(orphans),
    synthesizedMscPairs: freezeAll(mscPairs.pairs),
    orb6: freezeAll([...rescue.orb6]),
    athyg: freezeAll([...scrubbed.rows]),
    indices: Object.freeze(indices),
    simbadWdsXids: inputs.simbadWdsXids,
    wdsDuplicatePairRowsDropped: deduped.dropped,
    orb6OverridesApplied: overridden.applied,
    orb6GradeFallbacks: inputs.orb6.gradeFallbacks,
    astrometryExcluded: inputs.astrometry.size - srcToAstrometry.size,
    blankRescue: Object.freeze([...rescue.outcomes]),
    mscSynthesis: Object.freeze(mscPairs.outcomes),
    checks: Object.freeze([
      bandCheck('WDS summary parse', inputs.wdsSumm.length, ROW_BANDS.wdsSumm),
      bandCheck('ORB6 parse', inputs.orb6.entries.length, ROW_BANDS.orb6),
      bandCheck('AT-HYG parse', inputs.athyg.length, ROW_BANDS.athyg),
      bandCheck('CCDM parse', inputs.ccdm.rows, ROW_BANDS.ccdm),
      bandCheck('HIP2 parse', inputs.hip2.size, ROW_BANDS.hip2),
    ]),
  });
}

/** Reads every Stage 1 input through its declaration, then assembles. */
export async function loadReferenceCatalogs(): Promise<ReferenceCatalogs> {
  const ccdmTable = HIP_CCDM.read();
  const simbadXids = parseSimbadWdsXids(SIMBAD_WDS_XIDS.read());
  return assembleReferenceCatalogs({
    wdsSumm: WDS_SUMM.read(),
    orb6: ORB6.read(),
    orb6ComponentOverrides: ORB6_COMPONENT_OVERRIDES.read(),
    athyg: parseAthygRows(ATHYG_CLASSIC_IDS.read()),
    ccdm: { ...parseCcdmIndex(ccdmTable), rows: countRows(ccdmTable(['HIP'] as const)) },
    hip2: HIP2.read().astrometry,
    hipToGaia: GAIA_HIP_XMATCH.read(),
    tycToGaia: await GAIA_TYC_XMATCH.read(),
    nss: parseNssOrbits(GAIA_NSS.read()),
    astrometry: BINARIES_ASTROMETRY.read(),
    astrometryExclusions: ASTROMETRY_EXCLUSIONS.read(),
    simbadWdsXids: simbadXids,
    simbadSptypeByOid: SIMBAD_WDS_SPTYPE.read(),
    componentSptypeOverrides: COMPONENT_SPTYPE_OVERRIDES.read(),
    msc: { systems: MSC_SYSTEMS.read(), orbits: MSC_ORBITS.read(), components: MSC_COMPONENTS.read() },
  });
}

function countRows(rows: Iterable<unknown>): number {
  let n = 0;
  for (const _ of rows) n++;
  return n;
}

/** README.md#checks-and-counts */
export function stage1Counts(c: ReferenceCatalogs): Record<string, number> {
  const rescue = fold(BLANK_RESCUE_OUTCOMES, c.blankRescue, (o) => o);
  const msc = fold(MSC_SYNTHESIS_OUTCOMES, c.mscSynthesis, (o) => o);
  return {
    wds_duplicate_pair_rows_dropped: c.wdsDuplicatePairRowsDropped,
    msc_orbits_unmapped: c.indices.msc.nOrbitsUnmapped,
    xwalk_hip_mag_rejected: c.indices.xwalkMagRejected.length,
    athyg_gaia_mag_rejected: c.indices.athygGaiaMagRejected.length,
    synthesized_orb6_orphan_pairs: c.synthesizedOrb6Pairs.length,
    synthesized_msc_inner_pairs: msc.synthesized,
    blank_components_rescued: rescue.rescued,
    blank_components_deferred: rescue.deferred,
  };
}
