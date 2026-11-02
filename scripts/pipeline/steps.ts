// The step table: one entry per producer of a file the build or a pull depends on. See README.md#the-step-table--stepsts.

import { registryPaths } from '../sid/registry-outputs';
import { REGISTRY_PARTITIONS } from '../sid/registry-partitions-pure';
import type { StepTable } from './step-table-pure';

export const STEPS: StepTable = {
  steps: [
    {
      name: 'build:binaries',
      kind: 'build',
      language: 'python',
      entry: 'scripts/binaries/build-binaries.py',
      outputs: [
        'data/binaries/multiples.tsv',
        'data/gaia/gaia_astrometry_source_id_request.tsv',
        'build/binding-integrity-verdicts.tsv',
      ],
      after: [],
      snapshots: ['scripts/binaries/build-binaries-expected.json', 'scripts/binaries/build-binaries-rates-expected.json'],
    },
    {
      name: 'lineage:codes',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/catalog/lineage/generate-reason-codes.ts',
      outputs: { module: 'scripts/catalog/lineage/reason-codes-outputs.ts', name: 'REASON_CODES_OUTPUTS' },
    },
    {
      name: 'build:classic-ids',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/catalog/classic-ids/build-classic-id-overlay.ts',
      outputs: { module: 'scripts/catalog/classic-ids/classic-id-overlay-outputs.ts', name: 'CLASSIC_ID_OUTPUTS' },
    },
    {
      name: 'build:wgsn',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/catalog/naming/build-wgsn-tables.ts',
      outputs: { module: 'scripts/catalog/naming/wgsn-tables-outputs.ts', name: 'WGSN_OUTPUTS' },
    },
    {
      name: 'build:astrometry-request',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/catalog/astrometry-request/export-astrometry-request.ts',
      outputs: { module: 'scripts/catalog/astrometry-request/astrometry-request-outputs.ts', name: 'ASTROMETRY_REQUEST_OUTPUTS' },
    },
    {
      name: 'build:membership',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/catalog/membership/build-membership-manifest.ts',
      outputs: { module: 'scripts/catalog/membership/membership-manifest-outputs.ts', name: 'MEMBERSHIP_OUTPUTS' },
    },
    {
      name: 'build:catalog',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/catalog/build-catalog.ts',
      outputs: { module: 'scripts/catalog/catalog-outputs.ts', name: 'CATALOG_OUTPUTS' },
    },
    {
      name: 'build:binaries-runtime',
      kind: 'build',
      language: 'python',
      entry: 'scripts/binaries/build-runtime-binaries.py',
      outputs: ['public/binaries.bin'],
      after: ['build:binaries', 'build:catalog'],
      snapshots: ['scripts/binaries/build-runtime-binaries-expected.json'],
    },
  ],
  registryFiles: REGISTRY_PARTITIONS.flatMap((p) => [registryPaths(p).ledger, registryPaths(p).events]),
};
