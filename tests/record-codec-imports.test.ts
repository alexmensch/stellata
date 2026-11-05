// See /tests/README.md#record-codec-imports.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';
import {
  importSpecifiers, isRelativeSpecifier, isShippedSource, resolveImportTarget,
} from './import-specifiers';

const ROOT = resolve(__dirname, '..');
const RECORD_DIR = 'src/catalog-format/record';

const shipped = [...walkFiles(join(ROOT, RECORD_DIR), { include: isShippedSource })]
  .map((p) => relative(ROOT, p));

function outsideImports(repoPath: string): string[] {
  const src = readFileSync(join(ROOT, repoPath), 'utf8');
  return importSpecifiers(src)
    .map(({ spec }) => spec)
    .filter((spec) => !isRelativeSpecifier(spec)
      || !resolveImportTarget(ROOT, repoPath, spec).startsWith(`${RECORD_DIR}/`))
    .map((spec) => `${repoPath} imports ${spec}`);
}

describe('record codec imports', () => {
  it('scans the codec itself, so the check is not vacuous', () => {
    expect(shipped).toContain(`${RECORD_DIR}/catalog-pure.ts`);
  });

  it('imports nothing from outside src/catalog-format/record/', () => {
    expect(shipped.flatMap(outsideImports)).toEqual([]);
  });
});
