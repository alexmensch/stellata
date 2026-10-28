// Emit data/gaia/gaia_catalog_source_id_request.tsv — every Gaia source the
// build needs a row for: the membership manifest's bindings, both gates'
// candidates, bound-pair siblings. See README.md.
import { resolve } from 'node:path';

import { ASTROMETRY_REQUEST_OUTPUTS } from './astrometry-request-outputs';
import { sortSourceIdsNumeric } from './export-astrometry-request-pure';
import {
  joinOverlayCandidates,
  magnitudeWeighableSourceIds,
} from '../classic-ids/classic-id-overlay-pure';
import { loadHipVMag } from '../membership/binding/binding-evidence';
import { readMultiplesTsv } from '../companions/companion-promotion';
import { pairMemberSourceIds } from '../distance/parallax/pair-member-parallax';
import {
  derivationCandidateSourceIds,
  indexSimbadSources,
} from '../membership/binding/binding-derivation-pure';
import {
  SPINE_CORRECTIONS_FILE,
  additionItemCells,
  applySpineCorrections,
  parseSpineCorrectionsTsv,
} from '../membership/membership-manifest-pure';
import { MEMBERSHIP_MANIFEST, MEMBERSHIP_MANIFEST_FILE } from '../membership/membership-manifest-tsv';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { INHERITED_SPINE } from '../spine/inherited-spine-tsv';
import { indexCns5 } from '../spine/primaries-audit-pure';
import { loadPrimaryTables } from '../spine/primaries-tables';
import { readArtifact } from '../../util/sources/source';
import { emitArtifacts, runStep } from '../../util/emit-artifacts';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';

const SRC_MANIFEST = resolve(ROOT, MEMBERSHIP_MANIFEST_FILE);
const OUT = ASTROMETRY_REQUEST_OUTPUTS.files.request;

const MANIFEST_HINT = 'run `pnpm run build:membership`, or `git lfs pull` if it is an LFS stub.';
const CORRECTIONS_HINT = 'it is committed and hand-curated (../membership/README.md#correcting-a-merge-decision).';

async function main(): Promise<void> {
  const ids = new Set<string>();
  let rows = 0;
  let withoutSourceId = 0;
  for (const row of MEMBERSHIP_MANIFEST.rows(readRequired(SRC_MANIFEST, MANIFEST_HINT))) {
    if (row.term === 'magnitude') continue;
    rows++;
    if (row.gaiaSourceId === null) withoutSourceId++;
    else ids.add(row.gaiaSourceId);
  }
  const membership = ids.size;

  const hipVMag = loadHipVMag();

  // One table load for both contributions: the gate's Tycho-2 / Gliese arms
  // read the same tables the derivation's do, and the TYC cross-walk has to
  // cover IV/25's Tycho ids as well as the spine's for the gate's arm.
  const spine = readArtifact(INHERITED_SPINE);
  const { kept } = applySpineCorrections(spine, parseSpineCorrectionsTsv(
    readRequired(resolve(ROOT, SPINE_CORRECTIONS_FILE), CORRECTIONS_HINT),
  ));
  const tables = await loadPrimaryTables(kept.map((r) => r.tyc).filter((t) => t !== ''));

  const candidates = magnitudeWeighableSourceIds(
    joinOverlayCandidates({
      tyc2Hd: tables.iv25,
      crossIndex: tables.iv27a,
      bsc5: tables.v50,
      cns5: tables.cns5,
      tycToSource: tables.tycToSource,
      hipToSource: tables.hipToSource,
    }),
    printedVLookups(hipVMag, tables.tycho2, tables.gliese),
  );
  for (const id of candidates) ids.add(id);
  const afterGate = ids.size;

  const derivation = derivationCandidateSourceIds(
    [...kept, ...additionItemCells(tables, kept)], tables, indexCns5(tables.cns5).cns5ByOwnKey,
    indexSimbadSources(tables.simbadBySourceId),
  );
  for (const id of derivation) ids.add(id);
  const afterDerivation = ids.size;

  const siblings = pairMemberSourceIds(readMultiplesTsv());
  for (const id of siblings) ids.add(id);

  const sorted = sortSourceIdsNumeric(ids);
  emitArtifacts({
    outputs: ASTROMETRY_REQUEST_OUTPUTS,
    files: { request: `gaia_source_id\n${sorted.join('\n')}\n` },
  });
  console.log(
    `manifest primaries rows: ${rows} → ${membership} source_ids (${withoutSourceId} carry none; the magnitude term reads its own pull)`,
  );
  console.log(
    `classic-ID gate candidates: ${candidates.size} ` +
      `(+${afterGate - membership} beyond the manifest)`,
  );
  console.log(
    `binding-derivation candidates: ${derivation.size} ` +
      `(+${afterDerivation - afterGate} beyond the two above)`,
  );
  console.log(
    `bound-pair siblings: ${siblings.size} ` +
      `(+${sorted.length - afterDerivation} beyond the three above)`,
  );
  console.log(`wrote ${OUT} (${sorted.length} source_ids)`);
}

runStep(main);
