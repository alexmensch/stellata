import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogChunkFilename } from '../catalog/record/catalog-pure';
import { catalogueRecordCount, creditedSourceCount } from './site-metrics';

let root: string | null = null;

function scratchRoot(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), 'site-metrics-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

afterEach(() => {
  if (root !== null) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('a figure that cannot be read stops the build', () => {
  it('refuses a catalogue that is present but unreadable, rather than quoting the snapshot', () => {
    const dir = scratchRoot({ [join('public', catalogChunkFilename(0))]: 'version https://git-lfs' });
    expect(() => catalogueRecordCount(dir)).toThrow(/magic/i);
  });

  it('refuses a Credits tab it finds no sources in', () => {
    const dir = scratchRoot({
      'src/client/app/index.html': '<div class="modal-credits"><div class="credit-entry"><div class="credit-label">Stars</div></div></div>',
    });
    expect(() => creditedSourceCount(dir)).toThrow(/no credited sources/);
  });
});

describe('the Credits count reads structure, not layout', () => {
  it('counts the same sources however the markup is indented', () => {
    const entry = (label: string, n: number): string =>
      `<div class="credit-entry"><div class="credit-label">${label}</div>${'<div>a source</div>'.repeat(n)}</div>`;
    const dir = scratchRoot({
      'src/client/app/index.html': `<div class="modal-credits">${entry('Stars', 3)}\n\n\t${entry('Dust', 2)}</div>`,
    });
    expect(creditedSourceCount(dir)).toBe(5);
  });
});
