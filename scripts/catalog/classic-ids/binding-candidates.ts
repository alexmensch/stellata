// The Gaia sources the classic-ID routes can propose — the binding gate's
// candidate set, and the astrometry request's second contribution.
// See README.md § The gate's evidence has to be pulled.

import { resolve } from 'node:path';

import { readGaiaHipXmatch, readGaiaTycXmatch } from '../parse/gaia-xmatch';
import { parseCns5Tsv, parseTyc2HdTsv, type Cns5Row } from './classic-ids-parse';
import { readRequired, requireExists, REPO_ROOT as ROOT } from '../../util/paths';

export const SRC_TYC2_HD = resolve(ROOT, 'data/classic-ids/tyc2_hd.tsv');
export const SRC_CNS5 = resolve(ROOT, 'data/classic-ids/cns5.tsv');
export const SRC_TYC_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_tyc_xmatch.tsv');
export const SRC_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');

const CDS_HINT = 'refresh the CDS inputs with `pnpm run refresh:classic-ids`.';
const XMATCH_HINT = 'refresh the cross-walk with `pnpm run refresh:gaia-hip` / `refresh:gaia-tyc`.';

/** The two cross-walk products the candidate set derives from — between them the
 *  only ways an overlay entry acquires a `hip`, which is what the gate weighs.
 *  Loading just these is why `build:astrometry-request` does not touch the 2.5 M-row
 *  TYC table (§ The request is a union in ../astrometry-request/README.md). */
export interface BindingCandidateInputs {
  cns5: Cns5Row[];
  hipToSource: Map<number, string>;
}

/** Everything the overlay join reads. The TYC half serves the HD→TYC→source_id
 *  route, which attaches no `hip` and so reaches no candidate. */
export interface ClassicIdCrossWalks extends BindingCandidateInputs {
  tyc2Hd: ReturnType<typeof parseTyc2HdTsv>;
  /** TYC → source_id, already narrowed to the Tycho ids IV/25 mentions. The
   *  full table is 2.5 M rows for a ~350 k-row join. */
  tycToSource: Map<string, string>;
}

export function loadBindingCandidateInputs(): BindingCandidateInputs {
  requireExists(SRC_HIP_XMATCH, XMATCH_HINT);
  return {
    cns5: parseCns5Tsv(readRequired(SRC_CNS5, CDS_HINT)),
    hipToSource: readGaiaHipXmatch(SRC_HIP_XMATCH),
  };
}

export async function loadClassicIdCrossWalks(): Promise<ClassicIdCrossWalks> {
  requireExists(SRC_TYC_XMATCH, XMATCH_HINT);
  const tyc2Hd = parseTyc2HdTsv(readRequired(SRC_TYC2_HD, CDS_HINT));
  const tycToSource = await readGaiaTycXmatch(
    SRC_TYC_XMATCH,
    new Set(tyc2Hd.map((r) => r.tyc)),
  );
  return { ...loadBindingCandidateInputs(), tyc2Hd, tycToSource };
}

/** The V cascade's printed tiers, as the candidate set reads them: a Tycho
 *  entry's reduced `VT` and a GJ cell's Gliese `Vmag`. Supplied by the caller
 *  because loading the two tables is I/O this pure walk should not do, and
 *  because the astrometry request already holds both. */
export interface PrintedVLookups {
  tycho2VOfTyc: (tyc: string) => number | null;
  glieseVOfGj: (gj: string) => number | null;
}

/** The source_ids the binding gate can actually weigh, and therefore the ones
 *  the astrometry pull has to carry a `phot_g_mean_mag` for.
 *
 *  **These are candidates, not members** — a route resolves a designation to
 *  whatever source the cross-walk names, which is frequently not a catalogue
 *  record and is exactly the case the gate exists to refuse. So the set is NOT
 *  a subset of the spine's column, and a pull covering only the spine leaves
 *  the gate with nothing to weigh, where it passes by default instead of
 *  rejecting.
 *
 *  **The set is the gate's own reach, restated on the request side**, so it
 *  widens exactly when the gate does: a source is a candidate where any of the
 *  V cascade's three printed tiers answers for it — a HIP the cross-walk or a
 *  CNS5 row gives it, a Tycho entry IV/25 routes to it, or a CNS5 GJ cell. Only
 *  a source no tier reaches is skipped (`gateSkippedNoPrintedV`), because
 *  without a printed V a `G` decides nothing.
 *
 *  Drifting from either producer re-opens the silent-acceptance fault, so the
 *  correspondence is pinned two ways: `binding-candidates.test.ts` walks a
 *  built overlay and asserts every source the gate weighed is in here, and
 *  `gateSkippedNoGMag` pins at zero on the real build.
 */
export function bindingCandidateSourceIds(
  inputs: BindingCandidateInputs,
  hipVMag: ReadonlyMap<number, number>,
  printedV: PrintedVLookups | null = null,
  tycToSource: ReadonlyMap<string, string> | null = null,
  tyc2Hd: readonly { tyc: string }[] = [],
): Set<string> {
  const ids = new Set<string>();
  for (const [hip, sourceId] of inputs.hipToSource) {
    if (hipVMag.has(hip)) ids.add(sourceId);
  }
  for (const row of inputs.cns5) {
    if (row.gaiaSourceId === null) continue;
    if (row.hip !== null && hipVMag.has(row.hip)) ids.add(row.gaiaSourceId);
    else if (printedV !== null
      && printedV.glieseVOfGj(`${row.gj}${row.gjComp ?? ''}`) !== null) {
      ids.add(row.gaiaSourceId);
    }
  }
  if (printedV !== null && tycToSource !== null) {
    for (const row of tyc2Hd) {
      const sourceId = tycToSource.get(row.tyc);
      if (sourceId !== undefined && printedV.tycho2VOfTyc(row.tyc) !== null) {
        ids.add(sourceId);
      }
    }
  }
  return ids;
}
