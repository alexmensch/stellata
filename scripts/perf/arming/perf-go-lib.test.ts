// The shell library the hook, the poller and the runner all read: the two
// scalars parse, and the age helper answers in bare seconds on this platform.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERF_GO_MARKER_NAME, PERF_GO_MAX_AGE_S } from './perf-go-lib';

const LIB = resolve(__dirname, 'perf-go-lib.sh');

let dir: string;

function age(path: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('bash', ['-c', `. "${LIB}"; perf_go_age_s "${path}"`], { encoding: 'utf-8' });
    return { status: 0, stdout: stdout.trim() };
  } catch (e) {
    return { status: (e as { status: number }).status, stdout: '' };
  }
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'perf-go-lib-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('perf-go-lib.sh', () => {
  it('exposes the marker name and the freshness window to TypeScript', () => {
    expect(PERF_GO_MARKER_NAME).toBe('.perf-go');
    expect(PERF_GO_MAX_AGE_S).toBe(3600);
  });

  // The BSD/GNU stat split: BSD's -f is GNU's --file-system and succeeds
  // there with prose, so a wrong order yields text, not seconds.
  it('answers in bare seconds, never a stat block', () => {
    const file = join(dir, '.perf-go');
    writeFileSync(file, '');
    const t = Date.now() / 1000 - 120;
    utimesSync(file, t, t);
    const r = age(file);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\d+$/);
    expect(Number(r.stdout)).toBeGreaterThanOrEqual(119);
    expect(Number(r.stdout)).toBeLessThanOrEqual(125);
  });

  it('reports failure rather than an age for a file it cannot stat', () => {
    expect(age(join(dir, 'absent')).status).toBe(1);
  });
});
