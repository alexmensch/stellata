// The Gaia sources the classic-ID routes can propose — the binding gate's
// candidate set, and the astrometry request's second contribution.
// See README.md § What the binding gate needs pulled.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readGaiaHipXmatch, readGaiaTycXmatch } from '../parse/gaia-xmatch';
import { parseCns5Tsv, parseTyc2HdTsv, type Cns5Row } from './classic-ids-parse';
import { REPO_ROOT as ROOT } from '../../util/paths';

export const SRC_TYC2_HD = resolve(ROOT, 'data/classic-ids/tyc2_hd.tsv');
export const SRC_CNS5 = resolve(ROOT, 'data/classic-ids/cns5.tsv');
export const SRC_TYC_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_tyc_xmatch.tsv');
export const SRC_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');

export interface ClassicIdCrossWalks {
  tyc2Hd: ReturnType<typeof parseTyc2HdTsv>;
  cns5: Cns5Row[];
  /** TYC → source_id, already narrowed to the Tycho ids IV/25 mentions. The
   *  full table is 2.5 M rows for a ~350 k-row join. */
  tycToSource: Map<string, string>;
  hipToSource: Map<number, string>;
}

export async function loadClassicIdCrossWalks(): Promise<ClassicIdCrossWalks> {
  const tyc2Hd = parseTyc2HdTsv(readFileSync(SRC_TYC2_HD, 'utf8'));
  const cns5 = parseCns5Tsv(readFileSync(SRC_CNS5, 'utf8'));
  const hipToSource = readGaiaHipXmatch(SRC_HIP_XMATCH);
  const tycToSource = await readGaiaTycXmatch(
    SRC_TYC_XMATCH,
    new Set(tyc2Hd.map((r) => r.tyc)),
  );
  return { tyc2Hd, cns5, tycToSource, hipToSource };
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
 */
export function bindingCandidateSourceIds(
  walks: ClassicIdCrossWalks,
  hipVMag: ReadonlyMap<number, number>,
): Set<string> {
  const ids = new Set<string>();
  for (const [hip, sourceId] of walks.hipToSource) {
    if (hipVMag.has(hip)) ids.add(sourceId);
  }
  for (const row of walks.cns5) {
    if (row.gaiaSourceId !== null && row.hip !== null && hipVMag.has(row.hip)) {
      ids.add(row.gaiaSourceId);
    }
  }
  return ids;
}
