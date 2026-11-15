import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const HERE = __dirname;

function subfolderSources(): string[] {
  return readdirSync(HERE, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.includes('/') && /\.ts$/.test(p))
    .map((p) => join(HERE, p));
}

describe('companions subfolders', () => {
  it('import nothing from companion-promotion.ts, the wiring over them', () => {
    const offenders = subfolderSources()
      .filter((file) => /from '(\.\.\/)+companion-promotion'/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(HERE, file));
    expect(offenders).toEqual([]);
  });
});
