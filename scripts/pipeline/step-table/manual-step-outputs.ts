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

const bake = (
  name: string, entry: string, outputs: readonly string[],
  { describes = false, families = [] }: { describes?: boolean; families?: readonly OutputFamily[] } = {},
): ManualStep => ({ name, kind: 'bake', describes, language: 'python', entry, outputs, families });

const textures = (dir: string, member: RegExp): OutputFamily => ({ dir: `data/textures${dir}`, member, stamped: true });

export const MANUAL_STEPS: readonly ManualStep[] = [
  pull('refresh:gaia-hip', 'refresh-gaia-hip-xmatch.py', ['data/gaia/gaia_dr3_hip_xmatch.tsv']),
  pull('refresh:gaia-tyc', 'refresh-gaia-tyc-xmatch.py', ['data/gaia/gaia_dr3_tyc_xmatch.tsv']),
  pull('refresh:gaia-nss', 'refresh-gaia-nss.py', ['data/gaia/gaia_dr3_nss_two_body.tsv']),
  pull('refresh:gaia-astrometry', 'refresh-gaia-astrometry.py', ['data/gaia/gaia_dr3_astrometry.tsv']),
  pull('refresh:gaia-astrometry-catalog', 'refresh-gaia-astrometry-catalog.py', ['data/gaia/gaia_dr3_astrometry_catalog.tsv']),
  pull('refresh:gaia-magnitude', 'refresh-gaia-magnitude.py', ['data/gaia/gaia_dr3_magnitude_pull.tsv']),
  pull('refresh:gaia-apsis', 'refresh-gaia-apsis.py', ['data/gaia/gaia_dr3_apsis.tsv']),
  pull('refresh:gaia-gspc', 'refresh-gaia-gspc.py', ['data/gaia/gaia_dr3_gspc.tsv']),
  pull('refresh:gaia-dr2-neighbourhood', 'refresh-gaia-dr2-neighbourhood.py', ['data/gaia/gaia_dr2_neighbourhood.tsv']),
  pull('refresh:bailer-jones', 'refresh-bailer-jones.py', ['data/bailer-jones/bailer-jones-dr3.tsv']),
  pull('refresh:hip2', 'refresh-hipparcos2.py', ['data/hipparcos/hip2_van_leeuwen.tsv']),
  pull('refresh:hip-vmag', 'refresh-hipparcos-vmag.py', ['data/hipparcos/hip_main_vmag.tsv']),
  pull('refresh:classic-ids', 'refresh-classic-ids.py', ['tyc2_hd', 'cross_index', 'bsc5', 'cns5'].map((s) => `data/classic-ids/${s}.tsv`)),
  pull('refresh:iau-wgsn', 'refresh-iau-wgsn.py', ['data/iau-wgsn/NEC.csv', 'data/iau-wgsn/wgsnFaints.csv']),
  pull('refresh:tycho2', 'refresh-tycho2.py', ['data/tycho2/tycho2_main.tsv', 'data/tycho2/tycho2_suppl1.tsv']),
  pull('refresh:gliese', 'refresh-gliese.py', ['data/gliese/gliese_v70a.tsv']),
  pull('refresh:msc', 'refresh-msc.py', ['systems', 'orbits', 'components'].map((s) => `data/msc/msc_${s}.tsv`)),
  pull('refresh:simbad', 'refresh-simbad-sample.py', ['data/simbad/simbad_sample.tsv']),
  pull('refresh:simbad-wds-xids', 'refresh-simbad-wds-xids.py', ['data/simbad/simbad_wds_xids.tsv']),
  pull('refresh:simbad-sptype', 'refresh-simbad-sptype.py', ['data/simbad/simbad_sptype.tsv']),
  pull('refresh:simbad-values', 'refresh-simbad-values.py', ['data/simbad/simbad_values.tsv']),
  pull('refresh:simbad-tyc-hd', 'refresh-simbad-tyc-hd.py', ['data/simbad/simbad_tyc_hd.tsv']),
  pull('refresh:edenhofer2024-main', 'refresh-edenhofer2024-main.py', ['data/dust/edenhofer2024-main.json']),
  pull('refresh:edenhofer2024-2kpc', 'refresh-edenhofer2024-2kpc.py', ['data/dust/edenhofer2024-2kpc.json']),
  tsManual({ kind: 'pull' }, 'fetch:probes', 'scripts/probes/fetch-probe-trajectories.ts', 'scripts/probes/probe-trajectory-outputs.ts', 'PROBE_OUTPUTS'),
  tsManual({ kind: 'pull' }, 'fetch:ephemerides', 'scripts/ephemerides/fetch-planet-elements.ts', 'scripts/ephemerides/planet-element-outputs.ts', 'ELEMENT_TABLE_OUTPUTS'),
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
