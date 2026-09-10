// Emit data/gaia/gaia_catalog_source_id_request.tsv — every Gaia source the
// build needs a row for: the membership manifest's bindings, both gates'
// candidates, bound-pair siblings. See README.md.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sortSourceIdsNumeric } from './export-astrometry-request-pure';
import {
  SRC_TYC2_HD,
  bindingCandidateSourceIds,
  loadBindingCandidateInputs,
} from '../classic-ids/binding-candidates';
import { parseTyc2HdTsv } from '../classic-ids/classic-ids-parse';
import {
  HIP_VMAG_HINT, SRC_GLIESE, SRC_HIP_VMAG, SRC_TYCHO2_MAIN, SRC_TYCHO2_SUPPL1,
} from '../classic-ids/binding-evidence';
import { MULTIPLES_TSV, readMultiplesTsv } from '../companions/companion-promotion';
import { pairMemberSourceIds } from '../distance/parallax/pair-member-parallax';
import {
  derivationCandidateSourceIds,
  indexSimbadSources,
} from '../membership/binding-derivation-pure';
import {
  MEMBERSHIP_MANIFEST_FILE,
  iterManifestTsv,
} from '../membership/membership-manifest-pure';
import { parseGlieseTsv } from '../gliese-parse';
import { parseHipPhotometryTsv } from '../photometry/hip-photometry-parse';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { parseTycho2Tsvs } from '../tycho2-parse';
import { INHERITED_SPINE_FILE, parseSpineTsv } from '../spine/inherited-spine-pure';
import { indexCns5 } from '../spine/primaries-audit-pure';
import { LFS_HINT, loadBindingTables } from '../spine/primaries-tables';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';

const SRC_MANIFEST = resolve(ROOT, MEMBERSHIP_MANIFEST_FILE);
const OUT = resolve(ROOT, 'data/gaia/gaia_catalog_source_id_request.tsv');

const MANIFEST_HINT = 'run `pnpm run build:membership`, or `git lfs pull` if it is an LFS stub.';

async function main(): Promise<void> {
  const ids = new Set<string>();
  let rows = 0;
  let withoutSourceId = 0;
  for (const row of iterManifestTsv(readRequired(SRC_MANIFEST, MANIFEST_HINT))) {
    rows++;
    if (row.gaia_source_id === '') withoutSourceId++;
    else ids.add(row.gaia_source_id);
  }
  const membership = ids.size;

  const { vmag: hipVMag } = parseHipPhotometryTsv(readRequired(SRC_HIP_VMAG, HIP_VMAG_HINT));

  // One table load for both contributions: the gate's Tycho-2 / Gliese arms
  // read the same tables the derivation's do, and the TYC cross-walk has to
  // cover IV/25's Tycho ids as well as the spine's for the gate's arm.
  const spine = parseSpineTsv(readRequired(resolve(ROOT, INHERITED_SPINE_FILE), LFS_HINT));
  const iv25 = parseTyc2HdTsv(readRequired(SRC_TYC2_HD, LFS_HINT));
  const keepTycs = new Set(iv25.map((r) => r.tyc));
  for (const row of spine) if (row.tyc !== '') keepTycs.add(row.tyc);
  const tables = await loadBindingTables(keepTycs);
  const tycho2 = parseTycho2Tsvs(
    readRequired(SRC_TYCHO2_MAIN, LFS_HINT), readRequired(SRC_TYCHO2_SUPPL1, LFS_HINT),
  );
  const gliese = parseGlieseTsv(readRequired(SRC_GLIESE, LFS_HINT));

  const candidates = bindingCandidateSourceIds({
    inputs: loadBindingCandidateInputs(),
    hipVMag,
    printedV: printedVLookups(tycho2, gliese),
    tycToSource: tables.tycToSource,
    tyc2Hd: iv25,
  });
  for (const id of candidates) ids.add(id);
  const afterGate = ids.size;

  const derivation = derivationCandidateSourceIds(
    spine, tables, indexCns5(tables.cns5).cns5ByOwnKey, indexSimbadSources(tables.simbadBySourceId),
  );
  for (const id of derivation) ids.add(id);
  const afterDerivation = ids.size;

  const siblings = pairMemberSourceIds(readMultiplesTsv(MULTIPLES_TSV));
  for (const id of siblings) ids.add(id);

  const sorted = sortSourceIdsNumeric(ids);
  writeFileSync(OUT, `gaia_source_id\n${sorted.join('\n')}\n`);
  console.log(
    `manifest: ${rows} rows → ${membership} source_ids (${withoutSourceId} carry none)`,
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

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
