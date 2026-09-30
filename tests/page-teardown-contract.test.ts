import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isProductionTs, walkFiles } from './walk-files';

const CLIENT = fileURLToPath(new URL('../src/client', import.meta.url));
const sources = [...walkFiles(CLIENT, { include: isProductionTs })].map((p) => relative(CLIENT, p));

const WINDOW_WRITE =
  /\bwindow\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)|\(\s*window\s+as\b[^)]*\)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)|(?:Object\.assign|Reflect\.set|Object\.defineProperty)\(\s*window\b/;

describe('window globals under src/client', () => {
  it('scans the client tree', () => {
    expect(sources).toContain(join('util', 'page-teardown.ts'));
  });

  it('are assigned only through expose', () => {
    const writers = sources.filter((f) =>
      readFileSync(join(CLIENT, f), 'utf8').split('\n').some((line) => WINDOW_WRITE.test(line)));
    expect(writers).toEqual([]);
  });

  it.each([
    'window.foo = 1;',
    "window['foo'] = x;",
    '(window as unknown as { foo: X }).foo = x;',
    'Object.assign(window, { foo });',
  ])('flags %s', (line) => {
    expect(WINDOW_WRITE.test(line)).toBe(true);
  });

  it.each([
    'if (window.foo === 1) {}',
    'const w = window.innerWidth;',
    'window.addEventListener("resize", f);',
  ])('passes %s', (line) => {
    expect(WINDOW_WRITE.test(line)).toBe(false);
  });
});
