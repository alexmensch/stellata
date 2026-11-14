// Emit data/gaia/gaia_catalog_source_id_request.tsv, the one Gaia 5p request. See README.md.

import { ASTROMETRY_REQUEST_OUTPUTS } from './astrometry-request-outputs';
import { serialiseSourceIdRequest } from './export-astrometry-request-pure';
import {
  joinOverlayCandidates,
  magnitudeWeighableSourceIds,
} from '../classic-ids/classic-id-overlay-pure';
import { loadHipVMag } from '../membership/binding/binding-evidence';
import { loadReferenceCatalogs } from '../../binaries/load/reference-catalogs';
import { astrometryRequestIds, resolveStage2 } from '../../binaries/resolve/resolve-pairs';
import {
  derivationCandidateSourceIds,
  indexSimbadSources,
} from '../membership/binding/binding-derivation-pure';
import { BINDING_REVIEW_DISPOSITIONS } from '../membership/binding-review-dispositions-source';
import { additionItemCells } from '../membership/additions/addition-items-pure';
import { applySpineCorrections } from '../membership/spine-corrections/spine-corrections-pure';
import { SPINE_CORRECTIONS } from '../membership/spine-corrections/spine-corrections-source';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { INHERITED_SPINE } from '../spine/inherited-spine-tsv';
import { indexCns5 } from '../spine/primaries-audit-pure';
import { loadPrimaryTables } from '../spine/primaries-tables';
import { readArtifact } from '../../util/sources/source';
import { emitArtifacts } from '../../util/emit-artifacts';

const OUT = ASTROMETRY_REQUEST_OUTPUTS.files.request;

export async function main(): Promise<void> {
  const ids = new Set<string>();
  const hipVMag = loadHipVMag();

  // One table load for both contributions: the gate's Tycho-2 / Gliese arms
  // read the same tables the derivation's do, and the TYC cross-walk has to
  // cover IV/25's Tycho ids as well as the spine's for the gate's arm.
  const spine = readArtifact(INHERITED_SPINE);
  const { kept } = applySpineCorrections(spine, SPINE_CORRECTIONS.read());
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

  const derivation = derivationCandidateSourceIds(
    [...kept, ...additionItemCells(tables, kept)], tables, indexCns5(tables.cns5).cns5ByOwnKey,
    indexSimbadSources(tables.simbadBySourceId, tables.simbadSourceless),
  );
  for (const id of derivation) ids.add(id);
  const afterDerivation = ids.size;

  const reference = await loadReferenceCatalogs();
  const binaries = astrometryRequestIds(resolveStage2(reference), reference.indices);
  for (const id of binaries) ids.add(id);
  const afterBinaries = ids.size;

  const reviewed = new Set(
    [...BINDING_REVIEW_DISPOSITIONS.read().values()]
      .map((d) => d.keep_source_id)
      .filter((id) => id !== ''),
  );
  for (const id of reviewed) ids.add(id);

  emitArtifacts({
    outputs: ASTROMETRY_REQUEST_OUTPUTS,
    files: { request: serialiseSourceIdRequest(ids) },
  });
  console.log(`classic-ID gate candidates: ${candidates.size}`);
  console.log(
    `binding-derivation candidates: ${derivation.size} ` +
      `(+${afterDerivation - candidates.size} beyond the gate's)`,
  );
  console.log(
    `binaries candidates: ${binaries.size} ` +
      `(+${afterBinaries - afterDerivation} beyond the two above)`,
  );
  console.log(
    `reviewed bindings kept: ${reviewed.size} ` +
      `(+${ids.size - afterBinaries} beyond the three above)`,
  );
  console.log(`wrote ${OUT} (${ids.size} source_ids)`);
}

