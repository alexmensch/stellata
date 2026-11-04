// Deployed-bundle content guard: no source-tree docs/scripts may leak
// into public/ (and thence dist/) via the mirror steps. Self-skips when
// public/ hasn't been built (bare CI test job).

import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { walkFiles } from './walk-files';

import { loadDeclaredOutputs } from '../scripts/pipeline/step-table/load-table';
import { MIRROR_STEPS } from '../scripts/pipeline/step-table/steps';
import { pipelineTree } from '../scripts/pipeline/pipeline-tree';
import type { DeclaredOutputs } from '../scripts/util/emit-artifacts';
import { strays } from '../scripts/util/mirror-to-public';
import { REPO_ROOT } from '../scripts/util/paths';
import { STAGING_SUFFIX } from '../scripts/util/staged-write';

const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const DIST_DIR = resolve(__dirname, '..', 'dist');
const MIRRORS = await Promise.all(MIRROR_STEPS.map(async ({ name, outputs }): Promise<[string, DeclaredOutputs]> => [
  name,
  await loadDeclaredOutputs(outputs, pipelineTree(REPO_ROOT)),
]));
const FORBIDDEN_EXTENSIONS = ['.md', '.txt', '.py', '.ts'];
// Committed .txt assets that are meant to ship (crawler signals).
const ALLOWED_SHIPPED = new Set(['robots.txt']);

describe.skipIf(!existsSync(PUBLIC_DIR))('deployed bundle content (public/)', () => {
  it('contains no source-tree file types', () => {
    const offenders = [...walkFiles(PUBLIC_DIR)].filter(
      (p) =>
        FORBIDDEN_EXTENSIONS.some((ext) => p.endsWith(ext)) &&
        !ALLOWED_SHIPPED.has(basename(p)),
    );
    expect(offenders).toEqual([]);
  });

  it('holds no staged output a killed build left behind, in public/ or dist/', () => {
    const offenders = [PUBLIC_DIR, DIST_DIR]
      .filter((d) => existsSync(d))
      .flatMap((d) => [...walkFiles(d)])
      .filter((p) => p.endsWith(STAGING_SUFFIX));
    expect(offenders).toEqual([]);
  });

  it.each(MIRRORS)('%s\'s folders hold only its declared outputs', (_name, outputs) => {
    expect(strays(outputs)).toEqual([]);
  });
});
