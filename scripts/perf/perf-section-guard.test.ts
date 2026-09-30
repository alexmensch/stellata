// Behavioural guard for perf-section-guard.sh: which diff and which record
// counts it hands perf-section-check.sh, over a throwaway repo.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitFile, gitIn } from '../../tests/git-fixture';

const GUARD = resolve(__dirname, 'perf-section-guard.sh');
const RECORDS = 388_063;

let repo: string;

const git = (...args: string[]) => gitIn(repo)(...args);
const commit = (path: string, content?: string) => commitFile(repo, path, content);
const expected = (n: number) => JSON.stringify({ recordCount: n });

function guard(body: string, head?: string): { code: number | null; stdout: string } {
  writeFileSync(join(repo, 'body.md'), body);
  const argv = [GUARD, 'body.md', 'base', ...(head === undefined ? [] : [head])];
  const r = spawnSync('bash', argv, { cwd: repo, encoding: 'utf-8' });
  return { code: r.status, stdout: r.stdout };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'perf-section-guard-'));
  git('init', '-q', '-b', 'main');
  commit('scripts/catalog/build-catalog-expected.json', expected(RECORDS));
  git('branch', 'base');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('perf-section-guard gathers the inputs from git', () => {
  it('reads the files HEAD changed since the base', () => {
    commit('src/client/milkyway/band.ts');
    const r = guard('## Summary\n\nx\n');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('render path touched (src/client/milkyway/band.ts)');
  });

  it('ignores what the base gained after the branch point', () => {
    git('checkout', '-q', 'base');
    commit('src/client/milkyway/band.ts');
    git('checkout', '-q', 'main');
    commit('README.md');
    expect(guard('## Summary\n\nx\n').code).toBe(0);
  });

  it('ignores a record count the base moved after the branch point', () => {
    git('checkout', '-q', 'base');
    commit('scripts/catalog/build-catalog-expected.json', expected(420_000));
    git('checkout', '-q', 'main');
    commit('README.md');
    const r = guard('## Summary\n\nx\n');
    expect(r.code, r.stdout).toBe(0);
  });

  it('reads the record count off both refs', () => {
    commit('scripts/catalog/build-catalog-expected.json', expected(420_000));
    const r = guard('## Summary\n\nx\n');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('catalogue membership 388063 -> 420000');
  });

  it('judges the head it is given rather than the checkout', () => {
    git('checkout', '-q', '-b', 'pr');
    commit('src/client/milkyway/band.ts');
    commit('scripts/catalog/build-catalog-expected.json', expected(420_000));
    git('checkout', '-q', 'main');
    expect(guard('## Summary\n\nx\n').code).toBe(0);
    const r = guard('## Summary\n\nx\n', 'pr');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('render path touched (src/client/milkyway/band.ts)');
    expect(r.stdout).toContain('catalogue membership 388063 -> 420000');
  });
});
