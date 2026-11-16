// Stage 1: every reference catalogue read through its declaration, assembled into the frozen ReferenceCatalogs. See README.md.

import type { Hip2AstrometryRow } from '../../catalog/sources/hip2-source';
import { HIP2 } from '../../catalog/sources/hip2-source';
import { GAIA_HIP_XMATCH } from '../../catalog/parse/gaia-hip-xmatch-source';
import { GAIA_TYC_XMATCH } from '../../catalog/parse/gaia-tyc-xmatch-source';
import { GAIA_ASTROMETRY } from '../../catalog/sources/gaia-astrometry-source';
import { GAIA_NSS } from '../../catalog/sources/gaia-nss-source';
import { HIP_CCDM } from '../../catalog/multiplicity/hip-ccdm-source';
import { ATHYG_CLASSIC_IDS } from '../../catalog/spine/athyg-classic-ids-source';
import { SIMBAD_WDS_XIDS } from '../../catalog/membership/binding/simbad-wds-xids-source';
import { bandCheck, type RowBand } from '../../refresh/pull/gates-pure';
import type { Check } from '../../util/emit-artifacts';
import { fold } from '../../util/counts/tally-pure';
import type { ComponentKey, DiscovererKey } from '../component-tokens-pure';
import { parseAthygRows, type AthygRow } from './athyg-pure';
import {
  BLANK_RESCUE_OUTCOMES, rescueBlankComponents, type BlankRescueDecision,
} from './blank-rescue-pure';
import { ASTROMETRY_EXCLUSIONS, COMPONENT_SPTYPE_OVERRIDES, ORB6_COMPONENT_OVERRIDES } from './curated-source';
import { applyAstrometryExclusions, parseNssOrbits, type AstrometryExclusionOutcome, type NssOrbitRow } from './gaia-pure';
import {
  buildIndices, parseCcdmIndex, scrubAthygGaia, type CcdmIndex, type IdentifierIndices,
} from './indices-pure';
import {
  buildMscLookup, type MscComponentRow, type MscOrbitRow, type MscSystemRow,
} from './msc-pure';
import { MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS } from './msc-source';
import { joinSimbadWdsSpectra, parseSimbadWdsXids, type SimbadWdsXid } from './simbad-pure';
import { SIMBAD_WDS_SPTYPE } from './simbad-wds-sptype-source';
import {
  MSC_SYNTHESIS_OUTCOMES, applyOrb6ComponentOverrides, synthesizeMscInnerPairs, synthesizeOrb6OrphanPairs,
  type MscSynthesisOutcome, type Orb6OverrideOutcome,
} from './subdivide-pure';
import {
  dedupWdsPairRows, type Orb6Entry, type Orb6GradeOutcome, type Orb6Parse, type WdsDedupDecision,
  type WdsPair,
} from '../../wds/wds-pure';
import { ORB6, WDS_SUMM } from '../../wds/wds-source';
import type { GaiaAstrometryRow } from '../../catalog/sources/gaia-astrometry-source';
import { MEMBERSHIP_MANIFEST, type ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import { addMagnitudeTermAstrometry } from '../../catalog/membership/magnitude-term/magnitude-term';
import { TYCHO2 } from '../../catalog/tycho2-source';
import type { Tycho2Row } from '../../catalog/tycho2-parse';
import { artifactRows } from '../../util/sources/source';
import { WITHHELD_MANIFEST, buildManifestIndex, type ManifestStar } from './manifest-stars-pure';

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

/** README.md#the-manifest */
export type ManifestInput =
  | { readonly kind: 'read'; readonly records: Iterable<ManifestRecord>; readonly tycho2: ReadonlyMap<string, Tycho2Row> }
  | { readonly kind: 'withheld' };

/** Everything Stage 1 read, before any of it is combined. */
export interface Stage1Inputs {
  readonly wdsSumm: readonly WdsPair[];
  readonly orb6: Orb6Parse;
  readonly orb6ComponentOverrides: ReadonlyMap<DiscovererKey, string>;
  readonly athyg: readonly AthygRow[];
  readonly ccdm: CcdmIndex;
  readonly hip2: ReadonlyMap<number, Hip2AstrometryRow>;
  readonly hipToGaia: ReadonlyMap<number, string>;
  readonly tycToGaia: ReadonlyMap<string, string>;
  readonly nss: ReadonlyMap<string, NssOrbitRow>;
  readonly astrometry: ReadonlyMap<string, GaiaAstrometryRow>;
  readonly astrometryExclusions: ReadonlyMap<string, string>;
  readonly simbadWdsXids: ReadonlyMap<ComponentKey, SimbadWdsXid>;
  readonly simbadSptypeByOid: ReadonlyMap<number, string>;
  readonly componentSptypeOverrides: ReadonlyMap<ComponentKey, string>;
  readonly manifest: ManifestInput;
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
  /** README.md#the-manifest */
  readonly manifestStars: readonly ManifestStar[];
  readonly simbadWdsXids: ReadonlyMap<ComponentKey, SimbadWdsXid>;
  readonly wdsDedup: readonly WdsDedupDecision[];
  readonly orb6Grades: readonly Orb6GradeOutcome[];
  readonly orb6Overrides: readonly Orb6OverrideOutcome[];
  /** One per source in the astrometry pull. */
  readonly astrometryExclusion: readonly AstrometryExclusionOutcome[];
  readonly blankRescue: readonly BlankRescueDecision[];
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

  const exclusion = applyAstrometryExclusions(inputs.astrometry, inputs.astrometryExclusions);
  const srcToAstrometry = exclusion.kept;
  const scrubbed = scrubAthygGaia(inputs.athyg, srcToAstrometry);
  const manifest = inputs.manifest.kind === 'withheld' ? WITHHELD_MANIFEST : buildManifestIndex(inputs.manifest.records, {
    gaiaAstrometry: srcToAstrometry,
    hip2: inputs.hip2,
    nss: new Map([...inputs.nss].map(([sourceId, row]) => [sourceId, row.origin])),
    tycho2: inputs.manifest.tycho2,
  });

  const msc = buildMscLookup(inputs.msc.systems, inputs.msc.orbits, inputs.msc.components);
  const indices = buildIndices({
    athyg: scrubbed.rows,
    hip2: inputs.hip2,
    hipToGaia: inputs.hipToGaia,
    hipToManifestGaia: manifest.hipToGaia,
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
    manifestStars: manifest.stars,
    simbadWdsXids: inputs.simbadWdsXids,
    wdsDedup: Object.freeze([...deduped.decisions]),
    orb6Grades: Object.freeze([...inputs.orb6.grades]),
    orb6Overrides: Object.freeze([...overridden.outcomes]),
    astrometryExclusion: Object.freeze([...exclusion.outcomes]),
    blankRescue: Object.freeze([...rescue.decisions]),
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

/** Reads every Stage 1 input through its declaration, then assembles. A
 *  withheld manifest reads neither it nor the astrometry only it selects. */
export async function loadReferenceCatalogs(manifest: ManifestInput['kind']): Promise<ReferenceCatalogs> {
  const simbadXids = parseSimbadWdsXids(SIMBAD_WDS_XIDS.read());
  const astrometry = GAIA_ASTROMETRY.read();
  if (manifest === 'read') await addMagnitudeTermAstrometry(astrometry);
  return assembleReferenceCatalogs({
    wdsSumm: WDS_SUMM.read(),
    orb6: ORB6.read(),
    orb6ComponentOverrides: ORB6_COMPONENT_OVERRIDES.read(),
    athyg: parseAthygRows(ATHYG_CLASSIC_IDS.read(), ATHYG_CLASSIC_IDS),
    ccdm: parseCcdmIndex(HIP_CCDM.read()),
    hip2: HIP2.read().astrometry,
    hipToGaia: GAIA_HIP_XMATCH.read(),
    tycToGaia: await GAIA_TYC_XMATCH.read(),
    nss: parseNssOrbits(GAIA_NSS.read(), GAIA_NSS),
    astrometry,
    astrometryExclusions: ASTROMETRY_EXCLUSIONS.read(),
    simbadWdsXids: simbadXids,
    simbadSptypeByOid: SIMBAD_WDS_SPTYPE.read(),
    componentSptypeOverrides: COMPONENT_SPTYPE_OVERRIDES.read(),
    msc: { systems: MSC_SYSTEMS.read(), orbits: MSC_ORBITS.read(), components: MSC_COMPONENTS.read() },
    manifest: manifest === 'read'
      ? { kind: 'read', records: artifactRows(MEMBERSHIP_MANIFEST), tycho2: TYCHO2.read() }
      : { kind: 'withheld' },
  });
}

/** README.md#checks-and-counts */
export function stage1Counts(c: ReferenceCatalogs) {
  const rescue = fold(BLANK_RESCUE_OUTCOMES, c.blankRescue, (d) => d.outcome);
  const msc = fold(MSC_SYNTHESIS_OUTCOMES, c.mscSynthesis, (o) => o);
  return {
    msc_orbits_unmapped: c.indices.msc.nOrbitsUnmapped,
    xwalk_hip_mag_rejected: c.indices.xwalkMagRejected.length,
    athyg_gaia_mag_rejected: c.indices.athygGaiaMagRejected.length,
    synthesized_orb6_orphan_pairs: c.synthesizedOrb6Pairs.length,
    synthesized_msc_inner_pairs: msc.synthesized,
    blank_components_rescued: rescue.rescued,
  };
}
