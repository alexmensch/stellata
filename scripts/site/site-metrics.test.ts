import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogChunkFilename } from '../catalog/record/catalog-pure';
import { appVersion, catalogueRecordCount, creditedSourceCount } from './site-metrics';

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

const SNAPSHOT = 'scripts/catalog/build-catalog-expected.json';

describe('the catalogue size with no built artifact', () => {
  it('is the count snapshot beside the build', () => {
    expect(catalogueRecordCount(scratchRoot({ [SNAPSHOT]: '{"recordCount":12345}' }))).toBe(12345);
  });

  it.each([
    ['no recordCount', '{}'],
    ['a non-integer recordCount', '{"recordCount":"12,345"}'],
    ['a zero recordCount', '{"recordCount":0}'],
  ])('refuses a snapshot with %s', (_, snapshot) => {
    expect(() => catalogueRecordCount(scratchRoot({ [SNAPSHOT]: snapshot }))).toThrow(/states no recordCount/);
  });
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

  it.each([
    ['no version', '{}'],
    ['an empty version', '{"version":""}'],
  ])('refuses a package.json with %s', (_, manifest) => {
    expect(() => appVersion(scratchRoot({ 'package.json': manifest }))).toThrow(/states no version/);
  });

  it('reads the version package.json states', () => {
    expect(appVersion(scratchRoot({ 'package.json': '{"version":"7.0.0"}' }))).toBe('7.0.0');
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
