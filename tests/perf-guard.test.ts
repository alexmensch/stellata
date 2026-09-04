// Behavioural guard for scripts/hooks/perf-guard.sh: the perf runner launches
// only past a fresh operator-created .perf-go marker, in every spelling.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/perf-guard.sh');
const LIB = resolve(__dirname, '../scripts/perf/perf-go-lib.sh');
const MAX_AGE_S = Number(/PERF_GO_MAX_AGE_S=(\d+)/.exec(readFileSync(LIB, 'utf-8'))![1]);

let repo: string;

function decision(command: string, toolName = 'Bash'): { denied: boolean; reason: string } {
  const stdout = execFileSync('bash', [HOOK], {
    cwd: repo,
    input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
    encoding: 'utf-8',
  });
  if (stdout.trim() === '') return { denied: false, reason: '' };
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    denied: parsed.hookSpecificOutput.permissionDecision === 'deny',
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

const denied = (command: string): boolean => decision(command).denied;

function arm(ageS = 0): void {
  const marker = join(repo, '.perf-go');
  writeFileSync(marker, '');
  if (ageS > 0) {
    const t = Date.now() / 1000 - ageS;
    utimesSync(marker, t, t);
  }
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'perf-guard-repo-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const RUN_SPELLINGS = [
  'pnpm run perf',
  'pnpm perf',
  'pnpm run perf -- --scenario sol --passes localDepth --budget-ms 60000',
  'tsx scripts/perf/run.ts',
  'npx tsx scripts/perf/run.ts --headed',
  'node scripts/perf/run.ts',
  'node --import tsx scripts/perf/run',
  'pnpm exec tsx scripts/perf/run.ts',
  './scripts/perf/run.ts --mode probe',
  'cd /somewhere && pnpm run perf',
  'PERF_DEBUG=1 pnpm run perf',
  'bun scripts/perf/run.ts',
  'echo start; deno run scripts/perf/run.ts',
];

const NOT_A_RUN = [
  'touch .perf-go',
  'rm -f .perf-go',
  'cat scripts/perf/run.ts',
  'grep -n launch scripts/perf/run.ts',
  'pnpm vitest run scripts/perf/settle-pure.test.ts',
  'bash scripts/perf/await-go.sh',
  'pnpm test',
  'git status -sb',
  'ls scripts/perf',
];

describe('perf-guard', () => {
  it('ignores non-Bash tools', () => {
    expect(decision('pnpm run perf', 'Read').denied).toBe(false);
  });

  it.each(RUN_SPELLINGS)('denies %j while unarmed', (command) => {
    expect(denied(command)).toBe(true);
  });

  it.each(NOT_A_RUN)('lets %j through while unarmed', (command) => {
    expect(denied(command)).toBe(false);
  });

  it.each(RUN_SPELLINGS)('allows %j under a fresh marker', (command) => {
    arm();
    expect(denied(command)).toBe(false);
  });

  it('denies a stale marker and says so', () => {
    arm(MAX_AGE_S + 60);
    const d = decision('pnpm run perf');
    expect(d.denied).toBe(true);
    expect(d.reason).toMatch(/stale/);
  });

  it('allows a marker just inside the limit', () => {
    arm(MAX_AGE_S - 60);
    expect(denied('pnpm run perf')).toBe(false);
  });

  it('denies arming and launching in one command, even under a fresh marker', () => {
    arm();
    const d = decision('touch .perf-go && pnpm run perf');
    expect(d.denied).toBe(true);
    expect(d.reason).toMatch(/Arming yourself/);
  });

  it('carries the protocol and the marker path in the deny reason', () => {
    const { reason } = decision('pnpm run perf');
    expect(reason).toMatch(/Announce/);
    expect(reason).toMatch(/await-go\.sh/);
    expect(reason).toMatch(/Proceed only when/);
    expect(reason).toMatch(/Never create the marker/);
    expect(reason).toContain(join(repo, '.perf-go'));
  });

  it('denies outside a git checkout', () => {
    rmSync(join(repo, '.git'), { recursive: true, force: true });
    expect(denied('pnpm run perf')).toBe(true);
  });
});
