// The step table: one entry per producer of a file the build or a pull depends on. See README.md#the-step-table--stepsts.

import { MANUAL_STEPS } from './manual-step-outputs';
import { PUBLIC_FILES } from '../../../src/catalog-format/public-artifacts/public-artifacts';
import { publicRepoPath } from '../../util/paths';
import type { StepTable, TsBuildStep } from './step-table-pure';
import { registryPaths, REGISTRY_PARTITIONS } from '../../../src/catalog-format/pipeline-outputs/data-files';

/** A `data/<layer>` → `public/` copy: `scripts/<layer>/sync-<layer>.ts` over its `<layer>-mirror-outputs.ts`. */
const mirrorStep = (layer: string): TsBuildStep => ({
  name: `build:${layer}-sync`,
  kind: 'build',
  language: 'ts',
  entry: `scripts/${layer}/sync-${layer}.ts`,
  outputs: { module: `scripts/${layer}/${layer}-mirror-outputs.ts`, name: 'MIRROR_OUTPUTS' },
});

export const MIRROR_STEPS: readonly TsBuildStep[] = ['dust', 'probes', 'ephemerides', 'local-bubble', 'cloud-surfaces', 'textures'].map(mirrorStep);

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
      after: [
        'refresh:gaia-astrometry', 'refresh:gaia-hip', 'refresh:gaia-nss', 'refresh:gaia-tyc',
        'refresh:hip2', 'refresh:msc', 'refresh:simbad-sptype', 'refresh:simbad-wds-xids',
      ],
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
      outputs: [publicRepoPath(PUBLIC_FILES.binaries)],
      after: ['build:binaries', 'build:catalog'],
      snapshots: ['scripts/binaries/build-runtime-binaries-expected.json'],
    },
    {
      name: 'build:clouds',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/clouds/build-clouds.ts',
      outputs: { module: 'scripts/clouds/clouds-outputs.ts', name: 'CLOUDS_OUTPUTS' },
    },
    {
      name: 'build:local-group',
      kind: 'build',
      language: 'ts',
      entry: 'scripts/local-group/build-local-group.ts',
      outputs: { module: 'scripts/local-group/local-group-outputs.ts', name: 'LOCAL_GROUP_OUTPUTS' },
    },
    ...MIRROR_STEPS,
    ...MANUAL_STEPS,
  ],
  registryFiles: REGISTRY_PARTITIONS.flatMap((p) => [registryPaths(p).ledger, registryPaths(p).events]),
};
