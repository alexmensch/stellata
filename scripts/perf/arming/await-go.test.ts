// Behavioural guard for await-go.sh: reports a fresh marker once, ignores a
// stale one, gives up at the timeout, and warns about busy sessions.

import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERF_GO_MAX_AGE_S } from './perf-go-lib';

const SCRIPT = resolve(__dirname, 'await-go.sh');

let repo: string;
let bin: string;

interface Exit { code: number | null; stdout: string; stderr: string }

function run(env: Record<string, string>): Promise<Exit> {
  return new Promise((done) => {
    const child = spawn('bash', [SCRIPT], {
      cwd: repo,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

function fakeClaude(script: string): void {
  const path = join(bin, 'claude');
  writeFileSync(path, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(path, 0o755);
}

function sessions(rows: { pid: number; name: string; cwd: string; status: string }[]): void {
  const fixture = join(bin, 'agents.json');
  writeFileSync(fixture, JSON.stringify(rows));
  fakeClaude(`cat '${fixture}'`);
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
  bin = join(repo, '.fake-bin');
  mkdirSync(bin);
  sessions([]);
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

  it('warns on stderr and holds the launch when another session is busy in the repo', async () => {
    sessions([
      { pid: 999_999, name: 'pickup-x', cwd: join(repo, '.claude/worktrees/x'), status: 'busy' },
      { pid: 999_998, name: 'elsewhere', cwd: '/not/this/repo', status: 'busy' },
    ]);
    arm();
    const r = await run({ PERF_GO_POLL_S: '0.2', PERF_GO_TIMEOUT_S: '10' });
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stdout).toMatch(/ARMED.*Ask Alex/);
    expect(r.stderr).toMatch(/WARNING.*busy/);
    expect(r.stderr).toContain('pickup-x');
    expect(r.stderr).not.toContain('elsewhere');
  }, 15_000);

  it('does not count its own session as busy', async () => {
    sessions([{ pid: process.pid, name: 'self', cwd: repo, status: 'busy' }]);
    arm();
    const r = await run({ PERF_GO_POLL_S: '0.2', PERF_GO_TIMEOUT_S: '10' });
    expect(r.stdout).toMatch(/Launch the runner now/);
    expect(r.stderr).toBe('');
  }, 15_000);

  it.each([
    ['cannot be read', 'exit 1'],
    ['is not a JSON array', "echo 'not json'"],
  ])('warns that the check was skipped when the session list %s', async (_, script) => {
    fakeClaude(script);
    arm();
    const r = await run({ PERF_GO_POLL_S: '0.2', PERF_GO_TIMEOUT_S: '10' });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/check skipped/);
    expect(r.stdout).toMatch(/Ask Alex/);
  }, 15_000);
});
