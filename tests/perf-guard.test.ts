// Behavioural guard for scripts/hooks/perf-guard.sh: two independent gates —
// the marker is never created by a tool call, and the runner launches only
// past a fresh one.

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERF_GO_MAX_AGE_S } from '../scripts/perf/perf-go-lib';

const HOOK = resolve(__dirname, '../scripts/hooks/perf-guard.sh');

let repo: string;

interface Payload {
  readonly tool_name: string;
  readonly tool_input: Record<string, string>;
}

function decision(payload: Payload, options: ExecFileSyncOptions = {}): { denied: boolean; reason: string } {
  const stdout = execFileSync('bash', [HOOK], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    ...options,
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

const bash = (command: string): Payload => ({ tool_name: 'Bash', tool_input: { command } });
const denied = (command: string): boolean => decision(bash(command)).denied;

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
  // Package managers other than pnpm run the same package.json script.
  'npm run perf',
  'yarn perf',
  'bun run perf',
  // Flags between the manager and the script name.
  'pnpm -s run perf',
  'pnpm -C . run perf',
  'npm --silent run perf',
  // A newline is a command boundary: flattening it to a space would leave
  // the launch unmatched, which is how this gate was first bypassed.
  'cd /somewhere\npnpm run perf',
  'echo measuring\nnpm run perf',
];

const NOT_A_RUN = [
  'cat scripts/perf/run.ts',
  'grep -n launch scripts/perf/run.ts',
  'pnpm vitest run scripts/perf/settle-pure.test.ts',
  'bash scripts/perf/await-go.sh',
  'bash scripts/perf/perf-go-lib.sh',
  'pnpm test',
  'git status -sb',
  'ls scripts/perf',
];

// Naming the marker is denied whether or not the same command launches:
// the two gates are independent, so a launch spelling this hook fails to
// recognise cannot be paired with a self-arm.
const NAMES_THE_MARKER = [
  'touch .perf-go',
  'rm -f .perf-go',
  'cat .perf-go',
  'touch .perf-go && pnpm run perf',
  'touch .perf-go\nnpm run perf',
  'touch /some/other/checkout/.perf-go',
  'echo x > .perf-go',
];

describe('perf-guard', () => {
  it('ignores tools it does not gate', () => {
    expect(decision({ tool_name: 'Read', tool_input: { file_path: '.perf-go' } }).denied).toBe(false);
  });

  describe('the launch gate', () => {
    it.each(RUN_SPELLINGS)('denies %j while unarmed', (command) => {
      expect(denied(command)).toBe(true);
    });

    it.each(RUN_SPELLINGS)('allows %j under a fresh marker', (command) => {
      arm();
      expect(denied(command)).toBe(false);
    });

    it.each(NOT_A_RUN)('lets %j through while unarmed', (command) => {
      expect(denied(command)).toBe(false);
    });

    it('denies a stale marker and says so', () => {
      arm(PERF_GO_MAX_AGE_S + 60);
      const d = decision(bash('pnpm run perf'));
      expect(d.denied).toBe(true);
      expect(d.reason).toMatch(/stale/);
    });

    it('allows a marker just inside the limit', () => {
      arm(PERF_GO_MAX_AGE_S - 60);
      expect(denied('pnpm run perf')).toBe(false);
    });

    it('carries the protocol and the marker path in the deny reason', () => {
      const { reason } = decision(bash('pnpm run perf'));
      expect(reason).toMatch(/Announce/);
      expect(reason).toMatch(/await-go\.sh/);
      expect(reason).toMatch(/Proceed only when/);
      expect(reason).toMatch(/Never create the marker/);
      expect(reason).toContain(join(repo, '.perf-go'));
    });
  });

  describe('the marker gate', () => {
    it.each(NAMES_THE_MARKER)('denies %j, armed or not', (command) => {
      arm();
      const d = decision(bash(command));
      expect(d.denied).toBe(true);
      expect(d.reason).toMatch(/Only Alex creates/);
    });

    it('names the routes that legitimately mention the marker', () => {
      const { reason } = decision(bash('touch .perf-go'));
      expect(reason).toMatch(/--body-file/);
      expect(reason).toMatch(/Grep tool/);
    });

    it.each(['Write', 'Edit', 'NotebookEdit'])('denies %s of the marker itself', (tool) => {
      const d = decision({ tool_name: tool, tool_input: { file_path: join(repo, '.perf-go') } });
      expect(d.denied).toBe(true);
      expect(d.reason).toMatch(/arming yourself/i);
    });

    it.each(['Write', 'Edit', 'NotebookEdit'])('lets %s of any other file through', (tool) => {
      const d = decision({ tool_name: tool, tool_input: { file_path: join(repo, 'scripts/perf/run.ts') } });
      expect(d.denied).toBe(false);
    });
  });

  describe('fails closed', () => {
    it('denies outside a git checkout', () => {
      rmSync(join(repo, '.git'), { recursive: true, force: true });
      expect(denied('pnpm run perf')).toBe(true);
    });

    it('denies when the marker age cannot be read', () => {
      arm();
      const stubs = join(repo, 'stubs');
      mkdirSync(stubs);
      writeFileSync(join(stubs, 'stat'), '#!/bin/sh\nexit 1\n');
      chmodSync(join(stubs, 'stat'), 0o755);
      const d = decision(bash('pnpm run perf'), { env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` } });
      expect(d.denied).toBe(true);
      expect(d.reason).toMatch(/cannot read the age/);
    });
  });
});
