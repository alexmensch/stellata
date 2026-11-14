// No rate under scripts/ divides by Math.max(1, …): an empty whole is tally-pure's no-denominator Share, never a rate of 0.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isProductionTs, walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const CLAMPED_DENOMINATOR = /\/\s*Math\.max\(\s*1\s*,/;

const offenders = (text: string): number[] =>
  text.split('\n').flatMap((line, i) => (CLAMPED_DENOMINATOR.test(line) ? [i + 1] : []));

describe('rate denominators under scripts/', () => {
  it('flags a division by Math.max(1, …) and passes a count clamped for its own sake', () => {
    expect(offenders('const r = n / Math.max(1, d);\nconst s = n /Math.max( 1 ,d);')).toEqual([1, 2]);
    expect(offenders('const steps = Math.max(1, Math.ceil(len / step));')).toEqual([]);
  });

  it('holds no rate whose empty whole reads as 0', () => {
    const files = [...walkFiles(resolve(ROOT, 'scripts'), { include: isProductionTs, skipDir: (name) => name === 'node_modules' })];
    expect(files.map((path) => relative(ROOT, path))).toContain('scripts/util/counts/tally-pure.ts');
    const found = files.flatMap((path) => offenders(readFileSync(path, 'utf8')).map((line) => `${relative(ROOT, path)}:${line}`));
    expect(found, 'rate through share / percentOf in scripts/util/counts/tally-pure.ts').toEqual([]);
  });
});
