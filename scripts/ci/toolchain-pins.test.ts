import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';

describe('every job resolves the same toolchain', () => {
  it.each(['.python-version', '.nvmrc'])('%s names an exact patch release', (pin) => {
    expect(readFileSync(resolve(REPO_ROOT, pin), 'utf8')).toMatch(/^\d+\.\d+\.\d+\n?$/);
  });
});
