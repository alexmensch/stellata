// Every floor modulo goes through pyMod in src/astro-core/angles.ts; see README.md#floor-modulos.
import { describe, expect, it } from 'vitest';
import { type LineRule, firstRule, lineHits, scanTree } from './line-scan';
import { isProductionTs } from './walk-files';

const OWNER = 'src/astro-core/angles.ts';

const M = String.raw`([\w.]+)`;
const RULES: ReadonlyArray<LineRule> = [
  { name: '((x % m) + m) % m', re: new RegExp(String.raw`%\s*${M}\s*\)?\s*\+\s*\1\s*\)\s*%\s*\1\b`) },
  { name: '(x + m) % m', re: new RegExp(String.raw`\+\s*${M}\s*\)\s*%\s*\1\b`) },
  { name: 'x < 0 ? x + m : x', re: new RegExp(String.raw`${M}\s*<\s*0\s*\?\s*\1\s*\+\s*[\w.]+\s*:\s*\1\b`) },
];

const HAND_ROLLED_ALLOWED: ReadonlyMap<string, number> = new Map([
  ['src/client/attitude/attitude-ball.ts', 1],
  ['src/client/debug/perf-hud.ts', 1],
  ['src/client/galactic/coord-spheres/coord-sphere-frames.ts', 2],
  ['src/client/solar-system/ephemerides/lunar-theory-pure.ts', 1],
  ['src/client/solar-system/planets/rotation/earth-orientation-pure.ts', 1],
  ['src/client/solar-system/planets/rotation/rotation-elements-pure.ts', 1],
  ['src/client/typeahead/typeahead.ts', 1],
]);

const hits = (path: string): string[] => lineHits(path, RULES);

describe('floor-modulo shapes', () => {
  it('catches each hand-rolled shape', () => {
    for (const [line, rule] of [
      ['const d = ((x % 360) + 360) % 360;', '((x % m) + m) % m'],
      ['return `${((Math.round(deg / 15) % 24) + 24) % 24}h`;', '((x % m) + m) % m'],
      ['const delta = ((w1 - w0) % TWO_PI + TWO_PI) % TWO_PI;', '((x % m) + m) % m'],
      ['raDeg: (Math.atan2(p.y, p.x) / DEG + 360) % 360,', '(x + m) % m'],
      ['const start = (total.idx - N + RING_SIZE) % RING_SIZE;', '(x + m) % m'],
      ['this.setHover((this.hoverIdx - 1 + this.results.length) % this.results.length);', '(x + m) % m'],
      ['return w < 0 ? w + 360 : w;', 'x < 0 ? x + m : x'],
      ['const a = lon < 0 ? lon + TWO_PI : lon;', 'x < 0 ? x + m : x'],
    ] as const) {
      expect(firstRule(line, RULES), line).toBe(rule);
    }
  });

  it('leaves a ring-index step and an unrelated sum alone', () => {
    for (const line of [
      'const east = (i + 1) % columns;',
      'const v = total.ring[(start + i) % RING_SIZE];',
      'const next = FRAME_CYCLE[(at + step) % FRAME_CYCLE.length];',
      'return pyMod(x, 360);',
      'const s = x < 0 ? -x : x;',
    ]) {
      expect(firstRule(line, RULES), line).toBeUndefined();
    }
  });
});

describe('floor modulos', () => {
  const files = scanTree(['src', 'scripts'], isProductionTs, new Set([OWNER]));

  it('no hand-rolled floor modulo outside pyMod and the allowlist', () => {
    const found = files.filter((p) => !HAND_ROLLED_ALLOWED.has(p)).flatMap(hits);
    expect(found, `call pyMod from ${OWNER}`).toEqual([]);
  });

  it('each allowlisted file holds exactly its pinned count', () => {
    for (const [path, count] of HAND_ROLLED_ALLOWED) {
      expect(hits(path), `${path}: a site fixed here leaves the allowlist`).toHaveLength(count);
    }
  });

  it('the scan reaches the tree', () => {
    expect(files.length).toBeGreaterThan(1000);
  });
});
