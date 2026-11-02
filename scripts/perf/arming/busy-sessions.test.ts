// busy-sessions.sh: which `claude agents --json` rows count as busy in this repo.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, 'busy-sessions.sh');
const ROOT = '/repo/stellata';

interface Row { pid: number; name?: string; id: string; cwd: string; status: string }

function busy(rows: Row[], exclude: number[] = []): string[] {
  const out = execFileSync('bash', [SCRIPT, ROOT, ...exclude.map(String)], {
    input: JSON.stringify(rows),
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

const row = (pid: number, cwd: string, status = 'busy', name?: string): Row =>
  ({ pid, id: `id${pid}`, cwd, status, ...(name ? { name } : {}) });

describe('busy-sessions', () => {
  it('lists busy sessions anywhere under the main checkout, worktrees included', () => {
    expect(busy([
      row(1, ROOT, 'busy', 'main-session'),
      row(2, `${ROOT}/.claude/worktrees/foo`, 'busy', 'worker'),
      row(3, `${ROOT}/src`, 'busy', 'subdir'),
    ])).toEqual([
      `main-session — ${ROOT}`,
      `worker — ${ROOT}/.claude/worktrees/foo`,
      `subdir — ${ROOT}/src`,
    ]);
  });

  it('ignores idle and waiting sessions', () => {
    expect(busy([row(1, ROOT, 'idle'), row(2, ROOT, 'waiting')])).toEqual([]);
  });

  it('ignores sessions outside this repo, including a sibling whose path shares the prefix', () => {
    expect(busy([
      row(1, '/repo/other'),
      row(2, `${ROOT}-fork`),
    ])).toEqual([]);
  });

  it('excludes the named pids — the requesting session itself', () => {
    expect(busy([row(7, ROOT), row(8, ROOT)], [7, 99])).toEqual([`id8 — ${ROOT}`]);
  });

  it('falls back to the id when a session has no name', () => {
    expect(busy([row(4, ROOT)])).toEqual([`id4 — ${ROOT}`]);
  });
});
