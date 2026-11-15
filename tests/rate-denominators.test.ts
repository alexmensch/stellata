// No rate under scripts/ reads an empty whole as 0 — by Math.max(1, …) or a `> 0 ? … / … : 0` guard; rates take tally-pure's Share.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isProductionTs, walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const ZERO_FOR_EMPTY = [
  /\/\s*Math\.max\(\s*1\s*,/,
  /> 0\s*\?[^:?]*\/[^:?]*:\s*0\b/,
];

const offenders = (text: string): number[] =>
  text.split('\n').flatMap((line, i) => (ZERO_FOR_EMPTY.some((re) => re.test(line)) ? [i + 1] : []));

describe('rate denominators under scripts/', () => {
  it('flags a division by Math.max(1, …) and passes a count clamped for its own sake', () => {
    expect(offenders('const r = n / Math.max(1, d);\nconst s = n /Math.max( 1 ,d);')).toEqual([1, 2]);
    expect(offenders('const steps = Math.max(1, Math.ceil(len / step));')).toEqual([]);
  });

  it('flags a ratio guarded to 0 on an empty whole and passes a guard that yields something else', () => {
    expect(offenders('const r = d > 0 ? n / d : 0;\nconst s = c.model > 0 ? Math.min(c.a / c.model, 1) : 0;')).toEqual([1, 2]);
    expect(offenders('const r = d > 0 ? n / d : NaN;\nconst k = n > 0 ? 1 : 0;')).toEqual([]);
  });

  it('holds no rate whose empty whole reads as 0', () => {
    const files = [...walkFiles(resolve(ROOT, 'scripts'), { include: isProductionTs, skipDir: (name) => name === 'node_modules' })];
    expect(files.map((path) => relative(ROOT, path))).toContain('scripts/util/counts/tally-pure.ts');
    const found = files.flatMap((path) => offenders(readFileSync(path, 'utf8')).map((line) => `${relative(ROOT, path)}:${line}`));
    expect(found, 'rate through share / percentOf in scripts/util/counts/tally-pure.ts').toEqual([]);
  });
});
