// Behavioural guard for await-go.sh: reports a fresh marker once, ignores a
// stale one, and gives up at the timeout.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERF_GO_MAX_AGE_S } from './perf-go-lib';

const SCRIPT = resolve(__dirname, 'await-go.sh');

let repo: string;

interface Exit { code: number | null; stdout: string; stderr: string }

function run(env: Record<string, string>): Promise<Exit> {
  return new Promise((done) => {
    const child = spawn('bash', [SCRIPT], { cwd: repo, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arm(ageS = 0): void {
  const marker = join(repo, '.perf-go');
  writeFileSync(marker, '');
  if (ageS > 0) {
    const t = Date.now() / 1000 - ageS;
    utimesSync(marker, t, t);
  }
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'await-go-repo-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('await-go', () => {
  it('reports the marker once, then exits 0, when it appears mid-poll', async () => {
    const pending = run({ PERF_GO_POLL_S: '0.2', PERF_GO_TIMEOUT_S: '10' });
    await sleep(500);
    arm();
    const r = await pending;
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stdout).toMatch(/ARMED/);
    expect(r.stdout).toContain(join(repo, '.perf-go'));
  }, 15_000);

  it('exits 1 with a message when no marker arrives before the timeout', async () => {
    const r = await run({ PERF_GO_POLL_S: '0.2', PERF_GO_TIMEOUT_S: '1' });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/not armed/);
  }, 15_000);

  it('treats a stale marker as absent', async () => {
    arm(PERF_GO_MAX_AGE_S + 60);
    const r = await run({ PERF_GO_POLL_S: '0.2', PERF_GO_TIMEOUT_S: '1' });
    expect(r.code).toBe(1);
  }, 15_000);
});
