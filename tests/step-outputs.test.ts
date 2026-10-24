// See tests/README.md (step-outputs.test.ts).

import { isAbsolute, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ASTROMETRY_REQUEST_OUTPUTS } from '../scripts/catalog/astrometry-request/astrometry-request-outputs';
import { CATALOG_OUTPUTS } from '../scripts/catalog/catalog-outputs';
import { CLASSIC_ID_OUTPUTS } from '../scripts/catalog/classic-ids/classic-id-overlay-outputs';
import { MEMBERSHIP_OUTPUTS } from '../scripts/catalog/membership/membership-manifest-outputs';
import { NAMING_PARITY_OUTPUTS } from '../scripts/catalog/naming/naming-parity-outputs';
import { WGSN_OUTPUTS } from '../scripts/catalog/naming/wgsn-tables-outputs';
import { LUT_OUTPUTS } from '../scripts/colour/blackbody-lut-outputs';
import { ELEMENT_TABLE_OUTPUTS } from '../scripts/ephemerides/planet-element-outputs';
import { LOCAL_GROUP_OUTPUTS } from '../scripts/local-group/local-group-outputs';
import { PROBE_OUTPUTS } from '../scripts/probes/probe-trajectory-outputs';
import { DR_RECONCILE_OUTPUTS } from '../scripts/sid/dr-reconcile-outputs';
import { DR_RISK_SET_OUTPUTS } from '../scripts/sid/dr-risk-set-outputs';
import { SID_STAMP_OUTPUTS } from '../scripts/sid/sibling-stamp-outputs';
import type { DeclaredOutputs } from '../scripts/util/emit-artifacts';
import { REPO_ROOT } from '../scripts/util/paths';

const STEPS: Record<string, DeclaredOutputs> = {
  'build:catalog': CATALOG_OUTPUTS,
  'build:membership': MEMBERSHIP_OUTPUTS,
  'build:classic-ids': CLASSIC_ID_OUTPUTS,
  'build:wgsn': WGSN_OUTPUTS,
  'build:naming-parity': NAMING_PARITY_OUTPUTS,
  'build:astrometry-request': ASTROMETRY_REQUEST_OUTPUTS,
  'build:local-group': LOCAL_GROUP_OUTPUTS,
  'build:lut': LUT_OUTPUTS,
  'sid:stamp': SID_STAMP_OUTPUTS,
  'sid:risk-set': DR_RISK_SET_OUTPUTS,
  'sid:dr-reconcile': DR_RECONCILE_OUTPUTS,
  'fetch:probes': PROBE_OUTPUTS,
  'fetch:ephemerides': ELEMENT_TABLE_OUTPUTS,
};

describe('step output declarations', () => {
  it('declare at least one absolute path inside the repo each', () => {
    for (const [step, outputs] of Object.entries(STEPS)) {
      const paths = Object.values(outputs.files);
      expect(paths.length, step).toBeGreaterThan(0);
      for (const p of paths) {
        expect(isAbsolute(p) && !relative(REPO_ROOT, p).startsWith('..'), `${step}: ${p}`).toBe(true);
      }
    }
  });

  it('give each path one producer, sid:stamp rewriting local-group.json in place excepted', () => {
    const producers = new Map<string, string[]>();
    for (const [step, outputs] of Object.entries(STEPS)) {
      for (const p of Object.values(outputs.files)) {
        producers.set(relative(REPO_ROOT, p), [...(producers.get(relative(REPO_ROOT, p)) ?? []), step]);
      }
    }
    const shared = [...producers].filter(([, steps]) => steps.length > 1);
    expect(shared).toEqual([['public/local-group.json', ['build:local-group', 'sid:stamp']]]);
  });
});
