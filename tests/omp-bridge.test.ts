// Pins the omp -> Claude-guard translation in scripts/hooks/omp-bridge-pure.ts.
// A file-touching omp tool missing from the map is silently ungated, which is
// the failure this suite exists to catch.

import { describe, expect, it } from 'vitest';
import {
  CLAUDE_TOOL_NAME,
  buildPayload,
  gitHistoryOp,
  hashlinePaths,
  isProtectedBranch,
  literalPrefixDir,
  needsCommitSweep,
  parseVerdict,
  stripSelector,
  toolTargets,
} from '../scripts/hooks/omp-bridge-pure';

describe('tool-name map', () => {
  it('covers every effective tool that can reach a repo file', () => {
    const fileTouching = ['read', 'grep', 'debug', 'edit', 'write', 'ast_edit', 'lsp'];
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

describe('toolTargets', () => {
  it('reads the path off read and grep', () => {
    expect(toolTargets('read', { path: 'src/client/stellata.ts' })).toEqual({
      tool: 'read',
      paths: ['src/client/stellata.ts'],
      mutates: false,
    });
    expect(toolTargets('grep', { path: 'scripts/catalog' }).paths).toEqual([
      'scripts/catalog',
    ]);
  });

  it('splits a semicolon-delimited multi-root search into each root', () => {
    expect(toolTargets('grep', { path: 'src/client/hdr; scripts/catalog' }).paths).toEqual(
      ['src/client/hdr', 'scripts/catalog'],
    );
  });

  it('strips a read selector down to the container file', () => {
    expect(toolTargets('read', { path: 'src/client/hdr/README.md:20-40' }).paths).toEqual([
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
    expect(toolTargets('edit', { input })).toEqual({
      tool: 'edit',
      paths: ['src/client/star/disc.ts', 'scripts/catalog/build.ts'],
      mutates: true,
    });
  });

  it('gates the destination folder of an edit that renames', () => {
    const input = '[src/client/a.ts#1A2B]\nPUT 1.=1:\n+x\nMV src/client/newarea/a.ts';
    expect(toolTargets('edit', { input }).paths).toEqual([
      'src/client/a.ts',
      'src/client/newarea/a.ts',
    ]);
  });

  it('takes a quoted rename destination containing spaces', () => {
    const input = '[docs/a.md#1A2B]\nCUT 1.=1\nMV "docs/new area/a.md"';
    expect(toolTargets('edit', { input }).paths).toContain('docs/new area/a.md');
  });

  it('collects the whole paths array from ast_edit', () => {
    const paths = ['src/client/a.ts', 'src/client/b.ts'];
    expect(toolTargets('ast_edit', { ops: [], paths })).toEqual({
      tool: 'ast_edit',
      paths,
      mutates: true,
    });
  });

  it('charges a wildcard rewrite to the folder it descends into', () => {
    expect(toolTargets('ast_edit', { ops: [], paths: ['src/client/**/*.ts'] }).paths).toEqual(
      ['src/client'],
    );
  });

  it('skips a wildcard read, which lists paths rather than editing them', () => {
    expect(toolTargets('grep', { path: 'src/**/*.ts' }).paths).toEqual([]);
  });

  it('drops a rewrite pattern whose first segment is already a wildcard', () => {
    expect(toolTargets('ast_edit', { ops: [], paths: ['**/*.ts'] }).paths).toEqual([]);
  });

  it('recurses through an xd:// device write and reports the device', () => {
    const content = JSON.stringify({ action: 'rename', file: 'src/client/ui/x.ts' });
    expect(toolTargets('write', { path: 'xd://lsp', content })).toEqual({
      tool: 'lsp',
      paths: ['src/client/ui/x.ts'],
      mutates: true,
    });
  });

  it('treats an lsp lookup as a read and an applied rename as a write', () => {
    expect(toolTargets('lsp', { action: 'references', file: 'src/a.ts' }).mutates).toBe(false);
    expect(toolTargets('lsp', { action: 'rename', file: 'src/a.ts' }).mutates).toBe(true);
    expect(
      toolTargets('lsp', { action: 'rename', file: 'src/a.ts', apply: false }).mutates,
    ).toBe(false);
    expect(
      toolTargets('lsp', { action: 'code_actions', file: 'src/a.ts' }).mutates,
    ).toBe(false);
    expect(
      toolTargets('lsp', { action: 'code_actions', file: 'src/a.ts', apply: true }).mutates,
    ).toBe(true);
  });

  it('gates the source a debug session opens', () => {
    expect(
      toolTargets('debug', { action: 'set_breakpoint', file: 'src/client/a.ts' }),
    ).toEqual({ tool: 'debug', paths: ['src/client/a.ts'], mutates: false });
  });

  it('gates a plain write but not an internal URL', () => {
    expect(toolTargets('write', { path: 'docs/sid.md' })).toEqual({
      tool: 'write',
      paths: ['docs/sid.md'],
      mutates: true,
    });
    expect(toolTargets('read', { path: 'omp://hooks.md' }).paths).toEqual([]);
    expect(toolTargets('read', { path: 'skill://beads' }).paths).toEqual([]);
    expect(toolTargets('read', { path: 'artifact://2' }).paths).toEqual([]);
    expect(toolTargets('lsp', { action: 'diagnostics', file: '*' }).paths).toEqual([]);
  });

  it('yields nothing for tools that name no file', () => {
    expect(toolTargets('bash', { command: 'git status' }).paths).toEqual([]);
    expect(toolTargets('eval', { code: 'print(1)' }).paths).toEqual([]);
  });

  it('deduplicates repeated paths within one call', () => {
    const input = '[src/client/a.ts#1A2B]\nPUT 1.=1:\n+x\n[src/client/a.ts#1A2B]\nCUT 5.=5';
    expect(toolTargets('edit', { input }).paths).toEqual(['src/client/a.ts']);
  });

  it('treats a malformed device payload as naming no path', () => {
    expect(toolTargets('write', { path: 'xd://lsp', content: '{not json' })).toEqual({
      tool: 'lsp',
      paths: [],
      mutates: false,
    });
  });
});

describe('literalPrefixDir', () => {
  it('keeps a wildcard-free path whole', () => {
    expect(literalPrefixDir('src/client/a.ts')).toBe('src/client/a.ts');
  });

  it('stops at the first segment carrying any wildcard character', () => {
    expect(literalPrefixDir('src/client/**/*.ts')).toBe('src/client');
    expect(literalPrefixDir('src/client/a?.ts')).toBe('src/client');
    expect(literalPrefixDir('src/client/[ab].ts')).toBe('src/client');
  });

  it('yields nothing when the pattern names no literal folder', () => {
    expect(literalPrefixDir('*.ts')).toBe('');
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

  it('ignores a register paste that merely starts with MV', () => {
    expect(hashlinePaths('MVP 1.=1')).toEqual([]);
  });
});

describe('gitHistoryOp', () => {
  it('names the subcommand for the shapes that move history', () => {
    expect(gitHistoryOp('git commit -m "x"')).toBe('commit');
    expect(gitHistoryOp('git push')).toBe('push');
    expect(gitHistoryOp('git push -u origin HEAD')).toBe('push');
    expect(gitHistoryOp('git -C /repo push origin main')).toBe('push');
    expect(gitHistoryOp('git add -A && git commit -m "x"')).toBe('commit');
  });

  it('ignores longer subcommands and read-only git', () => {
    expect(gitHistoryOp('git commit-tree abc')).toBeUndefined();
    expect(gitHistoryOp('git status')).toBeUndefined();
    expect(gitHistoryOp('git log --oneline')).toBeUndefined();
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
    expect(needsCommitSweep('git push origin main')).toBe(false);
    expect(needsCommitSweep('git status')).toBe(false);
  });
});

describe('isProtectedBranch', () => {
  it('covers both trunk names and nothing that merely starts with one', () => {
    expect(isProtectedBranch('main')).toBe(true);
    expect(isProtectedBranch('master')).toBe(true);
    expect(isProtectedBranch('maintenance-fix')).toBe(false);
    expect(isProtectedBranch('worktree-omp-harness-parity')).toBe(false);
  });
});

describe('buildPayload', () => {
  it('emits the stdin shape the guards parse', () => {
    const payload = buildPayload({
      tool: 'read',
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

  it('reports a device write under the device name, not write', () => {
    const target = toolTargets('write', {
      path: 'xd://ast_edit',
      content: JSON.stringify({ ops: [], paths: ['src/a.ts'] }),
    });
    const payload = buildPayload({
      tool: target.tool,
      sessionId: 'a',
      cwd: '/repo',
      filePath: target.paths[0],
    });
    expect(payload?.tool_name).toBe('Edit');
  });

  it('returns undefined for a tool the guards do not branch on', () => {
    expect(
      buildPayload({ tool: 'eval', sessionId: 'a', cwd: '/repo' }),
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
