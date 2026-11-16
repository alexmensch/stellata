// Every pull and bake in the step table, each with the files it writes. See README.md#the-step-table--stepsts.

import {
  DUST_CHUNK, DUST_MANIFEST, PUBLIC_FILES, TEXTURE_MEMBERS,
} from '../../../src/catalog-format/public-artifacts/public-artifacts';
import type { OutputFamily } from '../../util/emit-artifacts';
import { publicRepoPath } from '../../util/paths';
import type { ManualKind, ManualStep } from './step-table-pure';

const pull = (name: string, entry: string, outputs: readonly string[]): ManualStep => ({
  name, kind: 'pull', language: 'python', entry: `scripts/refresh/${entry}`, outputs,
});

const tsManual = (kind: ManualKind, name: string, entry: string, module: string, constant: string): ManualStep => ({
  name, ...kind, language: 'ts', entry, outputs: { module, name: constant },
});

const vizierPull = (name: string, entry: string, constant: string): ManualStep => tsManual(
  { kind: 'pull' }, name, `scripts/refresh/vizier/${entry}`, 'scripts/refresh/vizier/vizier-outputs.ts', constant,
);

const bake = (
  name: string, entry: string, outputs: readonly string[],
  { describes = false, families = [] }: { describes?: boolean; families?: readonly OutputFamily[] } = {},
): ManualStep => ({ name, kind: 'bake', describes, language: 'python', entry, outputs, families });

const textures = (dir: string, member: RegExp): OutputFamily => ({ dir: `data/textures${dir}`, member, stamped: true });

export const MANUAL_STEPS: readonly ManualStep[] = [
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-hip', 'scripts/refresh/gaia-whole-table/refresh-gaia-hip-xmatch.ts',
    'scripts/refresh/gaia-whole-table/gaia-whole-table-outputs.ts', 'GAIA_HIP_XMATCH_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-tyc', 'scripts/refresh/gaia-whole-table/refresh-gaia-tyc-xmatch.ts',
    'scripts/refresh/gaia-whole-table/gaia-whole-table-outputs.ts', 'GAIA_TYC_XMATCH_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-nss', 'scripts/refresh/gaia-whole-table/refresh-gaia-nss.ts',
    'scripts/refresh/gaia-whole-table/gaia-whole-table-outputs.ts', 'GAIA_NSS_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-astrometry', 'scripts/refresh/gaia-request/refresh-gaia-astrometry.ts',
    'scripts/refresh/gaia-request/gaia-request-outputs.ts', 'GAIA_ASTROMETRY_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-magnitude', 'scripts/refresh/magnitude/refresh-gaia-magnitude.ts',
    'scripts/refresh/magnitude/magnitude-outputs.ts', 'GAIA_MAGNITUDE_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-apsis', 'scripts/refresh/magnitude/refresh-gaia-apsis.ts',
    'scripts/refresh/magnitude/magnitude-outputs.ts', 'GAIA_APSIS_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-gspc', 'scripts/refresh/gaia-request/refresh-gaia-gspc.ts',
    'scripts/refresh/gaia-request/gaia-request-outputs.ts', 'GAIA_GSPC_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:gaia-dr2-neighbourhood', 'scripts/refresh/gaia-request/refresh-gaia-dr2-neighbourhood.ts',
    'scripts/refresh/gaia-request/gaia-request-outputs.ts', 'GAIA_DR2_NEIGHBOURHOOD_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:bailer-jones', 'scripts/refresh/magnitude/refresh-bailer-jones.ts',
    'scripts/refresh/magnitude/magnitude-outputs.ts', 'BAILER_JONES_OUTPUTS',
  ),
  vizierPull('refresh:hip2', 'refresh-hipparcos2.ts', 'HIP2_OUTPUTS'),
  vizierPull('refresh:hip-vmag', 'refresh-hipparcos-vmag.ts', 'HIP_VMAG_OUTPUTS'),
  vizierPull('refresh:classic-ids', 'refresh-classic-ids.ts', 'CLASSIC_IDS_OUTPUTS'),
  tsManual(
    { kind: 'pull' }, 'refresh:iau-wgsn', 'scripts/refresh/iau-wgsn/refresh-iau-wgsn.ts', 'scripts/refresh/iau-wgsn/iau-wgsn-outputs.ts', 'IAU_WGSN_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:tycho2', 'scripts/refresh/tycho2/refresh-tycho2.ts', 'scripts/refresh/tycho2/tycho2-outputs.ts', 'TYCHO2_OUTPUTS',
  ),
  vizierPull('refresh:gliese', 'refresh-gliese.ts', 'GLIESE_OUTPUTS'),
  vizierPull('refresh:msc', 'refresh-msc.ts', 'MSC_OUTPUTS'),
  tsManual(
    { kind: 'pull' }, 'refresh:simbad', 'scripts/refresh/simbad-sample/refresh-simbad-sample.ts',
    'scripts/refresh/simbad-sample/simbad-sample-outputs.ts', 'SIMBAD_SAMPLE_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:simbad-wds-xids', 'scripts/refresh/simbad-wds-xids/refresh-simbad-wds-xids.ts',
    'scripts/refresh/simbad-wds-xids/simbad-wds-xids-outputs.ts', 'SIMBAD_WDS_XIDS_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:simbad-wds-sptype', 'scripts/refresh/simbad-wds-sptype/refresh-simbad-wds-sptype.ts',
    'scripts/refresh/simbad-wds-sptype/simbad-wds-sptype-outputs.ts', 'SIMBAD_WDS_SPTYPE_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:simbad-sptype', 'scripts/refresh/simbad-sptype/refresh-simbad-sptype.ts',
    'scripts/refresh/simbad-sptype/simbad-sptype-outputs.ts', 'SIMBAD_SPTYPE_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:simbad-values', 'scripts/refresh/simbad-values/refresh-simbad-values.ts',
    'scripts/refresh/simbad-values/simbad-values-outputs.ts', 'SIMBAD_VALUES_OUTPUTS',
  ),
  tsManual(
    { kind: 'pull' }, 'refresh:simbad-tyc-hd', 'scripts/refresh/simbad-tyc-hd/refresh-simbad-tyc-hd.ts',
    'scripts/refresh/simbad-tyc-hd/simbad-tyc-hd-outputs.ts', 'SIMBAD_TYC_HD_OUTPUTS',
  ),
  pull('refresh:edenhofer2024-main', 'refresh-edenhofer2024-main.py', ['data/dust/edenhofer2024-main.json']),
  pull('refresh:edenhofer2024-2kpc', 'refresh-edenhofer2024-2kpc.py', ['data/dust/edenhofer2024-2kpc.json']),
  tsManual({ kind: 'pull' }, 'fetch:probes', 'scripts/probes/fetch-probe-trajectories.ts', 'scripts/probes/probe-trajectory-outputs.ts', 'PROBE_OUTPUTS'),
  tsManual({ kind: 'pull' }, 'fetch:ephemerides', 'scripts/ephemerides/fetch-planet-elements.ts', 'scripts/ephemerides/planet-element-outputs.ts', 'ELEMENT_TABLE_OUTPUTS'),
  tsManual({ kind: 'bake', describes: true }, 'measure:band-resolved', 'scripts/milkyway-calibration/measure-resolved-light.ts', 'scripts/milkyway-calibration/resolved-hole-table-outputs.ts', 'RESOLVED_HOLE_TABLE_OUTPUTS'),
  bake('build:dust', 'scripts/dust/build-dust.py', [`data/dust/${DUST_MANIFEST}`], {
    families: [{ dir: 'data/dust', member: DUST_CHUNK, stamped: true }],
  }),
  bake('build:local-bubble', 'scripts/local-bubble/build-local-bubble.py', [`data/local-bubble/${PUBLIC_FILES.localBubble}`]),
  bake('build:cloud-surfaces', 'scripts/cloud-surfaces/build-cloud-surfaces.py', [`data/molecular-clouds/${PUBLIC_FILES.cloudSurfaces}`], { describes: true }),
  bake('build:textures', 'scripts/textures/build-textures.py', [
    'data/textures/calibration.json',
    'data/textures/relief/relief.json',
    'src/client/solar-system/planets/textures/texture-ladder-generated.ts',
  ], {
    families: [
      textures('', TEXTURE_MEMBERS.colourMap),
      textures('', TEXTURE_MEMBERS.ringStrip),
      textures('/relief', TEXTURE_MEMBERS.reliefMap),
    ],
  }),
  bake('build:icons', 'scripts/icons/build-icons.py', [
    'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon.ico',
  ].map(publicRepoPath)),
  bake('build:og', 'scripts/og/build-og.py', [publicRepoPath('og-image.jpg')]),
];
