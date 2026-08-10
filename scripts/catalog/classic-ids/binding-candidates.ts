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
 *  Two narrowings make it a few hundred ids rather than tens of thousands, and
 *  both are properties of `applyBindingGate` rather than economies:
 *
 *  - **A candidate with no HIP is skipped outright.** An overlay entry takes
 *    its `hip` only from the HIP cross-walk or a CNS5 row's own hip, so a
 *    source reached solely through the TYC→HD route never carries one.
 *  - **A HIP with no printed V is skipped too** (`gateSkippedNoHipVMag`) —
 *    the gate compares G against that V, so without it a G decides nothing.
 *
 *  Drifting from either producer re-opens the silent-acceptance fault, so the
 *  correspondence is pinned two ways: `binding-candidates.test.ts` walks a
 *  built overlay and asserts every source the gate weighed is in here, and
 *  `gateSkippedNoGMag` pins at zero on the real build.
 */
export function bindingCandidateSourceIds(
  inputs: BindingCandidateInputs,
  hipVMag: ReadonlyMap<number, number>,
): Set<string> {
  const ids = new Set<string>();
  for (const [hip, sourceId] of inputs.hipToSource) {
    if (hipVMag.has(hip)) ids.add(sourceId);
  }
  for (const row of inputs.cns5) {
    if (row.gaiaSourceId !== null && row.hip !== null && hipVMag.has(row.hip)) {
      ids.add(row.gaiaSourceId);
    }
  }
  return ids;
}
