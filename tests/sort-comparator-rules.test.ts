// Every ascending order goes through src/astro-core/order-pure.ts; see README.md#sort-comparators.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const OWNER = 'src/astro-core/order-pure.ts';

const RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'inline three-way comparator', re: /\? -1 : [^;]*\? 1 : 0\b/ },
  { name: 'inline two-way comparator', re: /[<>] [^?;]*\? -1 : 1\b/ },
  { name: 'subtraction comparator', re: /\(\s*\[?(\w+)\]?\s*,\s*\[?(\w+)\]?\s*\)\s*=>\s*\1\s*-\s*\2\b(?!\s*[.[])/ },
  { name: 'localeCompare', re: /\.localeCompare\(/ },
];

const LOCALE_ORDER_ALLOWED: ReadonlyMap<string, string> = new Map([
  ['src/client/typeahead/constellation-typeahead.ts', 'a list people read, in their locale'],
  ['src/client/webgpu/solar-system/tsl-materials.test.ts', 'test-only key order, reaches no output'],
]);

const SELF = relative(ROOT, __filename);

function scanned(): string[] {
  return ['src', 'scripts', 'tests'].flatMap((dir) => [
    ...walkFiles(join(ROOT, dir), {
      skipDir: (n) => n === 'node_modules',
      include: (p) => p.endsWith('.ts') && !p.endsWith('.d.ts'),
    }),
  ]).map((p) => relative(ROOT, p)).filter((p) => p !== OWNER && p !== SELF);
}

function hits(path: string, name: string, re: RegExp): string[] {
  return readFileSync(join(ROOT, path), 'utf8').split('\n')
    .flatMap((line, i) => (re.test(line) ? [`${path}:${i + 1} [${name}] ${line.trim()}`] : []));
}

describe('sort comparators', () => {
  const files = scanned();

  it('no inline comparator outside order-pure', () => {
    const found = RULES.flatMap(({ name, re }) =>
      files.filter((p) => !(name === 'localeCompare' && LOCALE_ORDER_ALLOWED.has(p)))
        .flatMap((p) => hits(p, name, re)));
    expect(found, 'route the sort through ascending / compareCodeUnits').toEqual([]);
  });

  it('each locale-order exemption still sorts by locale', () => {
    for (const path of LOCALE_ORDER_ALLOWED.keys()) {
      expect(hits(path, 'localeCompare', /\.localeCompare\(/), path).not.toEqual([]);
    }
  });

  it('the owner holds the one comparator body the rules forbid elsewhere', () => {
    expect(hits(OWNER, 'three-way', RULES[0].re)).toHaveLength(1);
    expect(files.length).toBeGreaterThan(1000);
  });
});
