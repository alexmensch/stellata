// See tests/README.md (step-outputs.test.ts).

import { isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { outputsOwners } from '../scripts/pipeline/step-table/non-step-writers';
import { STEPS } from '../scripts/pipeline/step-table/steps';
import { DR2_NEIGHBOURHOOD, DR2_NEIGHBOURHOOD_REQUEST } from '../scripts/sid/dr2-neighbourhood-source';
import type { DeclaredOutputs } from '../scripts/util/emit-artifacts';
import { REPO_ROOT } from '../scripts/util/paths';

const DECLARED: [string, DeclaredOutputs][] = await Promise.all(outputsOwners(STEPS).map(async ([step, { module, name }]) => (
  [step, (await import(resolve(REPO_ROOT, module)) as Record<string, DeclaredOutputs>)[name]]
)));

describe('step output declarations', () => {
  it('declare at least one file or family, each absolute and inside the repo', () => {
    for (const [step, outputs] of DECLARED) {
      const paths = [...Object.values(outputs.files), ...outputs.families.map((f) => f.dir)];
      expect(paths.length, step).toBeGreaterThan(0);
      for (const p of paths) {
        expect(isAbsolute(p) && !relative(REPO_ROOT, p).startsWith('..'), `${step}: ${p}`).toBe(true);
      }
    }
  });

  it('give each path one producer', () => {
    const producers = new Map<string, string[]>();
    for (const [step, outputs] of DECLARED) {
      for (const p of Object.values(outputs.files)) {
        producers.set(relative(REPO_ROOT, p), [...(producers.get(relative(REPO_ROOT, p)) ?? []), step]);
      }
    }
    const shared = [...producers].filter(([, steps]) => steps.length > 1);
    expect(shared).toEqual([]);
  });

  it('never cover the frozen DR2 dry-run pair, as a file or inside a family', () => {
    const frozen = [DR2_NEIGHBOURHOOD_REQUEST, DR2_NEIGHBOURHOOD].map((src) => resolve(REPO_ROOT, src.file));
    for (const [step, outputs] of DECLARED) {
      for (const p of frozen) {
        expect(Object.values(outputs.files), step).not.toContain(p);
        for (const { dir } of outputs.families) {
          expect(relative(dir, p).startsWith('..'), `${step}: family ${dir}`).toBe(true);
        }
      }
    }
  });
});
