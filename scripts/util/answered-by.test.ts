import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { readAnsweredBy } from './answered-by';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'answered-by-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('reads no file as no service, and a list of names as itself', () => {
  expect(readAnsweredBy(join(dir, 'absent.json'))).toEqual([]);
  writeFileSync(join(dir, 'a.json'), '["ESA-sync","ARI-sync"]');
  expect(readAnsweredBy(join(dir, 'a.json'))).toEqual(['ESA-sync', 'ARI-sync']);
});

it('refuses anything but a list of names, so it never reaches a committed record', () => {
  for (const text of ['{"a":1}', '["ok",2]', '"ESA-sync"']) {
    writeFileSync(join(dir, 'bad.json'), text);
    expect(() => readAnsweredBy(join(dir, 'bad.json'))).toThrow('expected a list of service names');
  }
});
