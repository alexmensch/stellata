// Every ascending order goes through src/astro-core/order-pure.ts; see README.md#sort-comparators.
import { describe, expect, it } from 'vitest';
import { relative } from 'node:path';
import { type LineRule, REPO_ROOT, lineHits, scanTree } from './line-scan';

const OWNER = 'src/astro-core/order-pure.ts';

const RULES: ReadonlyArray<LineRule> = [
  { name: 'inline three-way comparator', re: /\? -1 : [^;]*\? 1 : 0\b/ },
  { name: 'inline two-way comparator', re: /[<>] [^?;]*\? -1 : 1\b/ },
  { name: 'subtraction comparator', re: /\(\s*\[?(\w+)\]?\s*,\s*\[?(\w+)\]?\s*\)\s*=>\s*\1\s*-\s*\2\b(?!\s*[.[])/ },
  { name: 'localeCompare', re: /\.localeCompare\(/ },
];

const LOCALE_ORDER_ALLOWED: ReadonlyMap<string, string> = new Map([
  ['src/client/typeahead/constellation-typeahead.ts', 'a list people read, in their locale'],
  ['src/client/webgpu/solar-system/tsl-materials.test.ts', 'test-only key order, reaches no output'],
]);

const SELF = relative(REPO_ROOT, __filename);

describe('sort comparators', () => {
  const files = scanTree(
    ['src', 'scripts', 'tests'],
    (p) => p.endsWith('.ts') && !p.endsWith('.d.ts'),
    new Set([OWNER, SELF]),
  );

  it('no inline comparator outside order-pure', () => {
    const found = RULES.flatMap((rule) =>
      files.filter((p) => !(rule.name === 'localeCompare' && LOCALE_ORDER_ALLOWED.has(p)))
        .flatMap((p) => lineHits(p, [rule])));
    expect(found, 'route the sort through ascending / compareCodeUnits').toEqual([]);
  });

  it('each locale-order exemption still sorts by locale', () => {
    for (const path of LOCALE_ORDER_ALLOWED.keys()) {
      expect(lineHits(path, [RULES[3]]), path).not.toEqual([]);
    }
  });

  it('the owner holds the one comparator body the rules forbid elsewhere', () => {
    expect(lineHits(OWNER, [RULES[0]])).toHaveLength(1);
    expect(files.length).toBeGreaterThan(1000);
  });
});
