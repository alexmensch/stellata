// Build public/binaries.bin from multiples.tsv and the catalogue row-index map. See README.md#runtime-side-artifact.

import { relative, resolve } from 'node:path';

import { compareCountSnapshot } from '../catalog/build-counts';
import { CATALOG_ROW_INDEX_MAP } from '../catalog/companions/record-index/catalog-row-index-map-source';
import { emitArtifacts } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { snapshotCheck } from '../util/snapshot-check';
import type { StagedCounts } from '../util/counts/count-stages-pure';
import { handedFileHash, stepInputHashes } from '../util/step-input-hashes';
import { readArtifact } from '../util/sources/source';
import { MULTIPLES_TSV } from './multiples-tsv';
import { RUNTIME_BINARIES_OUTPUTS } from './runtime-binaries-outputs';
import { encodeRuntimeBinaries, multiplesHandshake } from './runtime-binaries-pure';

const EXPECTED_COUNTS = resolve(REPO_ROOT, 'scripts/binaries/build-runtime-binaries-expected.json');

const log = (msg: string): void => console.log(`[build-runtime-binaries] ${msg}`);

export function main(): void {
  const rows = readArtifact(MULTIPLES_TSV);
  const map = CATALOG_ROW_INDEX_MAP.read();
  log(
    `row-index map: ${Object.keys(map.byGaia).length.toLocaleString()} Gaia, `
      + `${Object.keys(map.byHip).length.toLocaleString()} HIP, `
      + `${Object.keys(map.bySynth).length.toLocaleString()} synthetic entries`,
  );
  const { bytes, counts: c, nested } = encodeRuntimeBinaries(rows, map);
  log(`${c.pairs_total.toLocaleString()} physical pairs; ${nested.toLocaleString()} nest inside an outer pair`);
  log(`orbit coverage: ${c.pairs_with_orbit.toLocaleString()} with elements (${c.pairs_with_inclination.toLocaleString()} with inclination)`);
  log(
    `dropped: primary_unresolved=${c.pairs_dropped_primary_unresolved}, `
      + `secondary_unresolved=${c.pairs_dropped_secondary_unresolved}, `
      + `degenerate_idx=${c.pairs_dropped_degenerate_idx}, `
      + `same_relation_alias=${c.pairs_dropped_same_relation_alias}, `
      + `duplicate_relation=${c.pairs_dropped_duplicate_relation}`,
  );
  emitArtifacts({
    outputs: RUNTIME_BINARIES_OUTPUTS,
    files: { binaries: bytes },
    checks: [
      multiplesHandshake(map.multiplesSha1, handedFileHash(stepInputHashes(), MULTIPLES_TSV.file)),
      snapshotCheck<StagedCounts>({
        snapshotPath: EXPECTED_COUNTS,
        actual: { stages: { encode: c } },
        compare: compareCountSnapshot,
        failureLabel: 'build-runtime-binaries count',
        script: 'build:binaries-runtime',
      }),
    ],
  });
  const out = RUNTIME_BINARIES_OUTPUTS.files.binaries;
  log(`wrote ${relative(REPO_ROOT, out)} (${c.pairs_emitted.toLocaleString()} pairs, ${(bytes.length / 1024).toFixed(1)} KB)`);
}
