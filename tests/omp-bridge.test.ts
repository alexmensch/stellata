// Pins the omp -> Claude-guard translation in scripts/hooks/omp-bridge-pure.ts.
// A file-touching omp tool missing from the map is silently ungated, which is
// the failure this suite exists to catch.

import { describe, expect, it } from 'vitest';
import {
  CLAUDE_TOOL_NAME,
  buildPayload,
  hashlinePaths,
  needsCommitSweep,
  parseVerdict,
  stripSelector,
  targetPaths,
} from '../scripts/hooks/omp-bridge-pure';

describe('tool-name map', () => {
  it('covers every omp tool that can reach a repo file', () => {
    const fileTouching = ['read', 'grep', 'edit', 'write', 'ast_edit', 'lsp'];
    const unmapped = fileTouching.filter((t) => CLAUDE_TOOL_NAME[t] === undefined);
    expect(unmapped).toEqual([]);
  });

  it('maps every structural editor onto Edit so readme-guard gates it', () => {
    expect(CLAUDE_TOOL_NAME.edit).toBe('Edit');
    expect(CLAUDE_TOOL_NAME.ast_edit).toBe('Edit');
    expect(CLAUDE_TOOL_NAME.lsp).toBe('Edit');
  });

  it('leaves ungateable tools out rather than mapping them to a guess', () => {
    for (const tool of ['eval', 'task', 'browser', 'glob', 'hub', 'todo']) {
      expect(CLAUDE_TOOL_NAME[tool]).toBeUndefined();
    }
  });
});

describe('targetPaths', () => {
  it('reads the path off read and grep', () => {
    expect(targetPaths('read', { path: 'src/client/stellata.ts' })).toEqual([
      'src/client/stellata.ts',
    ]);
    expect(targetPaths('grep', { path: 'scripts/catalog' })).toEqual([
      'scripts/catalog',
    ]);
  });

  it('strips a read selector down to the container file', () => {
    expect(targetPaths('read', { path: 'src/client/hdr/README.md:20-40' })).toEqual([
      'src/client/hdr/README.md',
    ]);
  });

  it('parses every hashline section header out of an edit', () => {
    const input = [
      '[src/client/star/disc.ts#1A2B]',
      'PUT 4.=4:',
      '+  const radius = 1;',
      '[scripts/catalog/build.ts#CDEF]',
      'CUT 9.=9',
    ].join('\n');
    expect(targetPaths('edit', { input })).toEqual([
      'src/client/star/disc.ts',
      'scripts/catalog/build.ts',
    ]);
  });

  it('collects the whole paths array from ast_edit', () => {
    const paths = ['src/client/a.ts', 'src/client/b.ts'];
    expect(targetPaths('ast_edit', { ops: [], paths })).toEqual(paths);
  });

  it('recurses through an xd:// device write into the real tool args', () => {
    const content = JSON.stringify({ action: 'rename', file: 'src/client/ui/x.ts' });
    expect(targetPaths('write', { path: 'xd://lsp', content })).toEqual([
      'src/client/ui/x.ts',
    ]);
  });

  it('gates a plain write but not an internal URL or a glob', () => {
    expect(targetPaths('write', { path: 'docs/sid.md' })).toEqual(['docs/sid.md']);
    expect(targetPaths('read', { path: 'omp://hooks.md' })).toEqual([]);
    expect(targetPaths('read', { path: 'skill://beads' })).toEqual([]);
    expect(targetPaths('read', { path: 'artifact://2' })).toEqual([]);
    expect(targetPaths('grep', { path: 'src/**/*.ts' })).toEqual([]);
    expect(targetPaths('lsp', { file: '*' })).toEqual([]);
  });

  it('yields nothing for tools that name no file', () => {
    expect(targetPaths('bash', { command: 'git status' })).toEqual([]);
    expect(targetPaths('eval', { code: 'print(1)' })).toEqual([]);
  });

  it('deduplicates repeated paths within one call', () => {
    const input = '[src/client/a.ts#1A2B]\nPUT 1.=1:\n+x\n[src/client/a.ts#1A2B]\nCUT 5.=5';
    expect(targetPaths('edit', { input })).toEqual(['src/client/a.ts']);
  });

  it('treats a malformed device payload as naming no path', () => {
    expect(targetPaths('write', { path: 'xd://lsp', content: '{not json' })).toEqual([]);
  });
});

describe('stripSelector', () => {
  it('keeps a scheme intact while cutting a trailing selector', () => {
    expect(stripSelector('ssh://host/etc/hosts:1-2')).toBe('ssh://host/etc/hosts');
  });

  it('cuts an archive or sqlite member down to the container', () => {
    expect(stripSelector('data/x.zip:inner/file.txt')).toBe('data/x.zip');
    expect(stripSelector('db.sqlite:users:42')).toBe('db.sqlite');
  });

  it('leaves an ordinary path untouched', () => {
    expect(stripSelector('src/client/a.ts')).toBe('src/client/a.ts');
  });
});

describe('hashlinePaths', () => {
  it('ignores body rows that merely look like a header', () => {
    expect(hashlinePaths('+[src/fake.ts#1A2B]')).toEqual([]);
  });

  it('requires a four-hex snapshot tag', () => {
    expect(hashlinePaths('[src/a.ts#12]')).toEqual([]);
    expect(hashlinePaths('[src/a.ts#12AB]')).toEqual(['src/a.ts']);
  });
});

describe('needsCommitSweep', () => {
  it('matches the commit shapes commit-sweep-guard inspects', () => {
    expect(needsCommitSweep('git commit -m "x"')).toBe(true);
    expect(needsCommitSweep('git -C /repo commit -m "x"')).toBe(true);
    expect(needsCommitSweep('git add -A && git commit -m "x"')).toBe(true);
  });

  it('does not match a non-commit subcommand', () => {
    expect(needsCommitSweep('git commit-tree abc')).toBe(false);
    expect(needsCommitSweep('git status')).toBe(false);
  });
});

describe('buildPayload', () => {
  it('emits the stdin shape the guards parse', () => {
    const payload = buildPayload({
      ompTool: 'read',
      sessionId: 'abc123',
      cwd: '/repo',
      filePath: 'src/client/a.ts',
    });
    expect(payload).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: 'abc123',
      cwd: '/repo',
      tool_name: 'Read',
      tool_input: { file_path: 'src/client/a.ts' },
    });
  });

  it('returns undefined for a tool the guards do not branch on', () => {
    expect(
      buildPayload({ ompTool: 'eval', sessionId: 'a', cwd: '/repo' }),
    ).toBeUndefined();
  });
});

describe('parseVerdict', () => {
  it('extracts a deny reason', () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Read src/client/README.md first',
      },
    });
    expect(parseVerdict(stdout)).toBe('Read src/client/README.md first');
  });

  it('treats silence, non-JSON, and a non-deny decision as allow', () => {
    expect(parseVerdict('')).toBeUndefined();
    expect(parseVerdict('   \n')).toBeUndefined();
    expect(parseVerdict('not json at all')).toBeUndefined();
    expect(
      parseVerdict(
        JSON.stringify({
          hookSpecificOutput: { permissionDecision: 'allow' },
        }),
      ),
    ).toBeUndefined();
  });

  it('still blocks when a deny carries no reason text', () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
    expect(parseVerdict(stdout)).toBe('blocked by guard');
  });
});
