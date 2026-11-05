import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareOutputs } from './emit-artifacts';
import { mirror, mirrorSource, strays } from './mirror-to-public';
import { REPO_ROOT } from './paths';

mkdirSync(join(REPO_ROOT, 'build'), { recursive: true });
const root = mkdtempSync(join(REPO_ROOT, 'build', 'mirror-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const data = join(root, 'fixture-source');
const pub = join(root, 'public');
mkdirSync(join(data, 'sub'), { recursive: true });
const outputs = declareOutputs({ index: join(pub, 'index.json') }, [{ dir: pub, member: /^part-\d\.bin$/, stamped: true }]);
const source = mirrorSource({ dir: relative(REPO_ROOT, data), hint: 'test', outputs, flattenSubDirs: ['sub'] });

describe('mirror', () => {
  it('copies the declared files flat, drops members the source lost, and purges strays', () => {
    writeFileSync(join(data, 'index.json'), '{}');
    writeFileSync(join(data, 'part-1.bin'), 'one');
    writeFileSync(join(data, 'sub', 'part-2.bin'), 'two');
    writeFileSync(join(data, 'README.md'), 'not shipped');
    mkdirSync(pub, { recursive: true });
    writeFileSync(join(pub, 'part-9.bin'), 'stale member');
    writeFileSync(join(pub, 'notes.txt'), 'stray');

    mirror(source.read());

    expect(readFileSync(join(pub, 'index.json'), 'utf8')).toBe('{}');
    expect(readFileSync(join(pub, 'part-2.bin'), 'utf8')).toBe('two');
    expect(existsSync(join(pub, 'part-9.bin'))).toBe(false);
    expect(existsSync(join(pub, 'notes.txt'))).toBe(false);
    expect(existsSync(join(pub, 'README.md'))).toBe(false);
    expect(strays(outputs)).toEqual([]);
  });

  it('refuses two source files of one name, writing nothing', () => {
    writeFileSync(join(data, 'part-1.bin'), 'shadowed');
    writeFileSync(join(data, 'sub', 'part-1.bin'), 'shadowing');
    expect(() => mirror(source.read())).toThrow(/share a name: part-1\.bin/);
    expect(readFileSync(join(pub, 'part-1.bin'), 'utf8')).toBe('one');
    rmSync(join(data, 'sub', 'part-1.bin'));
    writeFileSync(join(data, 'part-1.bin'), 'one');
  });

  it('refuses a source missing a declared file, writing nothing', () => {
    rmSync(join(data, 'index.json'));
    writeFileSync(join(data, 'part-1.bin'), 'changed');
    expect(() => mirror(source.read())).toThrow(/declared, not emitted/);
    expect(readFileSync(join(pub, 'part-1.bin'), 'utf8')).toBe('one');
  });
});
