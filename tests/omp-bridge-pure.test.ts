// Path extraction and command classification for the omp bridge. A tool whose
// paths this misses is silently ungated rather than loudly broken, so every
// branch of toolTargets is pinned here.

import { describe, expect, it } from 'vitest';
import {
  bashWriteTargets,
  buildPayload,
  claudeToolName,
  githubPushBranches,
  gitHistoryOp,
  hashlinePaths,
  isProtectedBranch,
  literalPrefixDir,
  needsCommitSweep,
  parseVerdict,
  stripHashlineWrapper,
  normalizeToolPath,
  stripSelector,
  toolTargets,
} from '../scripts/hooks/omp-bridge-pure';

const HOME = '/home/tester';

describe('stripSelector', () => {
  it('peels a line range, a raw flag, and an archive member', () => {
    expect(stripSelector('src/a.ts:50-200')).toBe('src/a.ts');
    expect(stripSelector('src/a.ts:raw')).toBe('src/a.ts');
    expect(stripSelector('fixtures/x.zip:inner/path')).toBe('fixtures/x.zip');
    expect(stripSelector('data/app.sqlite:users:42')).toBe('data/app.sqlite');
  });

  it('keeps a scheme intact', () => {
    expect(stripSelector('https://example.com/x')).toBe('https://example.com/x');
  });
});

describe('stripHashlineWrapper', () => {
  it('unwraps a copied section header', () => {
    expect(stripHashlineWrapper('[src/a.ts#1A2B]')).toBe('src/a.ts');
    expect(stripHashlineWrapper('[src/a.ts]')).toBe('src/a.ts');
    expect(stripHashlineWrapper('src/a.ts')).toBe('src/a.ts');
  });
});

describe('literalPrefixDir', () => {
  it('charges a wildcard to its deepest literal folder', () => {
    expect(literalPrefixDir('src/client/**/*.ts')).toBe('src/client');
    expect(literalPrefixDir('src/a.ts')).toBe('src/a.ts');
    expect(literalPrefixDir('*/a.ts')).toBe('');
    expect(literalPrefixDir('src/{a,b}/x.ts')).toBe('src');
  });
});

describe('hashlinePaths', () => {
  it('collects section headers and move destinations', () => {
    const input = [
      '[src/a.ts#1A2B]',
      'PUT 1.=1:',
      '+const x = 1;',
      'MV src/moved/b.ts',
      '[docs/c.md#3C4D]',
      'REM',
    ].join('\n');
    expect(hashlinePaths(input)).toEqual([
      'src/a.ts', 'src/moved/b.ts', 'docs/c.md',
    ]);
  });

  it('reads a quoted move destination', () => {
    expect(hashlinePaths('MV "src/with space.ts"')).toEqual(['src/with space.ts']);
  });
});

describe('normalizeToolPath', () => {
  it('expands a tilde, which otherwise reads as a relative path', () => {
    expect(normalizeToolPath('~/repo/a.ts', HOME)).toBe('/home/tester/repo/a.ts');
    expect(normalizeToolPath('~', HOME)).toBe('/home/tester');
  });

  it('leaves another user’s home alone', () => {
    expect(normalizeToolPath('~other/a.ts', HOME)).toBe('~other/a.ts');
  });

  it('unwraps the file:// and @/ spellings of an ordinary path', () => {
    expect(normalizeToolPath('file:///repo/a.ts', HOME)).toBe('/repo/a.ts');
    expect(normalizeToolPath('@/repo/a.ts', HOME)).toBe('/repo/a.ts');
  });

  it('passes an ordinary path through', () => {
    expect(normalizeToolPath('src/a.ts', HOME)).toBe('src/a.ts');
    expect(normalizeToolPath('/abs/a.ts', HOME)).toBe('/abs/a.ts');
  });
});

describe('toolTargets', () => {
  it('expands a tilde inside a hashline header', () => {
    const target = toolTargets(
      'edit',
      { input: '[~/repo/src/a.ts#1A2B]\nPUT 1.=1:\n+x' },
      HOME,
    );
    expect(target.paths).toEqual(['/home/tester/repo/src/a.ts']);
  });

  it('blocks a tool it has never heard of', () => {
    const target = toolTargets('teleport', { path: 'src/a.ts' }, HOME);
    expect(target.unclassified).toBe(true);
  });

  it('passes a known tool that names no repo file', () => {
    for (const tool of ['todo', 'web_search', 'hub', 'retain', 'task']) {
      const target = toolTargets(tool, { anything: 'x' }, HOME);
      expect(target.unclassified).toBe(false);
      expect(target.paths).toEqual([]);
      expect(target.mutates).toBe(false);
    }
  });

  it('reads a single path without splitting on a semicolon', () => {
    expect(toolTargets('read', { path: 'src/a;b.ts' }, HOME).paths).toEqual(['src/a;b.ts']);
  });

  it('splits grep roots on semicolons', () => {
    expect(toolTargets('grep', { path: 'src ; scripts' }, HOME).paths).toEqual([
      'src', 'scripts',
    ]);
  });

  it('treats a write as mutating and unwraps a tagged path', () => {
    const target = toolTargets('write', { path: '[src/a.ts#1A2B]', content: 'x' }, HOME);
    expect(target).toMatchObject({ paths: ['src/a.ts'], mutates: true });
  });

  it('recurses through an xd:// device write and reports the device', () => {
    const target = toolTargets('write', {
      path: 'xd://ast_edit',
      content: JSON.stringify({ paths: ['src/a.ts'], ops: [] }),
    }, HOME);
    expect(target).toMatchObject({ tool: 'ast_edit', paths: ['src/a.ts'], mutates: true });
  });

  it('gates an edit by its hashline headers', () => {
    const target = toolTargets('edit', { input: '[src/a.ts#1A2B]\nPUT 1.=1:\n+x' }, HOME);
    expect(target).toMatchObject({ paths: ['src/a.ts'], mutates: true });
  });

  it('gates apply_patch exactly as edit', () => {
    const target = toolTargets('apply_patch', { input: '[src/a.ts#1A2B]\nREM' }, HOME);
    expect(target).toMatchObject({ paths: ['src/a.ts'], mutates: true });
  });

  it('falls back to a direct path when the edit mode is not hashline', () => {
    expect(toolTargets('edit', { path: 'src/a.ts' }, HOME)).toMatchObject({
      paths: ['src/a.ts'],
      mutates: true,
    });
  });

  it('blocks an edit that names no file at all', () => {
    expect(toolTargets('edit', { input: 'PUT 1.=1:\n+x' }, HOME).unclassified).toBe(true);
    expect(toolTargets('ast_edit', { ops: [] }, HOME).unclassified).toBe(true);
  });

  it('charges a wildcard rewrite to its folder and skips a wildcard read', () => {
    expect(toolTargets('ast_edit', { paths: ['src/client/**/*.ts'] }, HOME).paths).toEqual([
      'src/client',
    ]);
    expect(toolTargets('grep', { path: 'src/**/*.ts' }, HOME).paths).toEqual([]);
  });

  it('skips internal URL schemes', () => {
    for (const path of ['omp://docs.md', 'artifact://x', 'pr://12/diff', 'conflict://1']) {
      expect(toolTargets('read', { path }, HOME).paths).toEqual([]);
    }
  });

  describe('lsp', () => {
    it('treats navigation as a read', () => {
      const target = toolTargets('lsp', { action: 'references', file: 'src/a.ts' }, HOME);
      expect(target).toMatchObject({ paths: ['src/a.ts'], mutates: false });
    });

    it('treats rename as a write unless apply is explicitly false', () => {
      expect(toolTargets('lsp', { action: 'rename', file: 'src/a.ts' }, HOME).mutates).toBe(true);
      expect(
        toolTargets('lsp', { action: 'rename', file: 'src/a.ts', apply: false }, HOME).mutates,
      ).toBe(true);
    });

    it('gates a rename_file destination, not only its source', () => {
      const target = toolTargets('lsp', {
        action: 'rename_file',
        file: 'src/a.ts',
        new_name: 'src/moved/b.ts',
      }, HOME);
      expect(target.paths).toEqual(['src/a.ts', 'src/moved/b.ts']);
    });

    it('treats code_actions and a raw request as writes', () => {
      expect(toolTargets('lsp', { action: 'code_actions', file: 'src/a.ts' }, HOME).mutates)
        .toBe(true);
      expect(toolTargets('lsp', { action: 'request', file: 'src/a.ts' }, HOME).mutates)
        .toBe(true);
    });

    it('blocks a write action that resolves no path', () => {
      expect(toolTargets('lsp', { action: 'request' }, HOME).unclassified).toBe(true);
    });

    it('lets a workspace reload through', () => {
      expect(toolTargets('lsp', { action: 'reload' }, HOME).unclassified).toBe(false);
    });
  });
});

describe('gitHistoryOp', () => {
  it('matches every push spelling', () => {
    for (const command of [
      'git push',
      'git push -f',
      'git push origin HEAD',
      'git push -u origin HEAD:main',
      'git push origin +main',
      'ls && git push',
    ]) {
      expect(gitHistoryOp(command)?.op).toBe('push');
    }
  });

  it('rejects a longer subcommand', () => {
    expect(gitHistoryOp('git commit-tree abc')).toBeUndefined();
    expect(gitHistoryOp('git pushx')).toBeUndefined();
  });

  it('reports the -C target as the directory that decides', () => {
    expect(gitHistoryOp('git -C /repo/main push')).toMatchObject({
      op: 'push',
      dir: '/repo/main',
    });
    expect(gitHistoryOp('git -c commit.gpgsign=false -C /repo/main commit -m x'))
      .toMatchObject({ op: 'commit', dir: '/repo/main' });
  });

  it('reports a leading cd, which omp rewrites into cwd after this hook runs', () => {
    expect(gitHistoryOp('cd /repo/main && git push')).toMatchObject({
      op: 'push',
      dir: '/repo/main',
    });
    expect(gitHistoryOp('cd "/repo/with space" && git commit -m x')).toMatchObject({
      dir: '/repo/with space',
    });
  });

  it('drives the commit-sweep filter', () => {
    expect(needsCommitSweep('git commit -m x')).toBe(true);
    expect(needsCommitSweep('git push')).toBe(false);
  });
});

describe('isProtectedBranch', () => {
  it('protects main and master only', () => {
    expect(isProtectedBranch('main')).toBe(true);
    expect(isProtectedBranch('master')).toBe(true);
    expect(isProtectedBranch('maintenance')).toBe(false);
    expect(isProtectedBranch('worktree-x')).toBe(false);
  });
});

describe('bashWriteTargets', () => {
  it('finds in-place stream edits', () => {
    expect(bashWriteTargets("sed -i '' 's/a/b/' src/a.ts")).toEqual(['src/a.ts']);
    expect(bashWriteTargets("sed -i.bak 's/a/b/' src/a.ts")).toEqual(['src/a.ts']);
    expect(bashWriteTargets("perl -i -pe 's/a/b/' src/a.ts")).toEqual(['src/a.ts']);
    expect(bashWriteTargets("awk -i inplace '{print}' src/a.ts")).toEqual(['src/a.ts']);
  });

  it('finds redirections and tee', () => {
    expect(bashWriteTargets('echo hi > src/a.ts')).toEqual(['src/a.ts']);
    expect(bashWriteTargets('echo hi >> src/a.ts')).toEqual(['src/a.ts']);
    expect(bashWriteTargets('echo hi | tee -a src/a.ts')).toEqual(['src/a.ts']);
  });

  it('ignores a read, a pipe, and a descriptor redirect', () => {
    expect(bashWriteTargets('cat src/a.ts')).toEqual([]);
    expect(bashWriteTargets('grep x src/a.ts | head')).toEqual([]);
    expect(bashWriteTargets('run 2>&1')).toEqual([]);
    expect(bashWriteTargets("sed 's/a/b/' src/a.ts")).toEqual([]);
  });
});

describe('githubPushBranches', () => {
  it('reports only for pr_push', () => {
    expect(githubPushBranches({ op: 'pr_create' })).toBeUndefined();
    expect(githubPushBranches({ op: 'pr_push' })).toEqual([]);
    expect(githubPushBranches({ op: 'pr_push', branch: 'main' })).toEqual(['main']);
  });
});

describe('parseVerdict', () => {
  it('allows a silent clean exit', () => {
    expect(parseVerdict({ stdout: '', status: 0 })).toBeUndefined();
  });

  it('reports a deny', () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no' },
    });
    expect(parseVerdict({ stdout, status: 0 })).toBe('no');
  });

  it('allows an explicit non-deny decision', () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'allow' },
    });
    expect(parseVerdict({ stdout, status: 0 })).toBeUndefined();
  });

  it('blocks on a non-zero exit', () => {
    expect(parseVerdict({ stdout: '', status: 1 })).toMatch(/exited 1/);
  });

  it('blocks on a signal', () => {
    expect(parseVerdict({ stdout: '', status: null })).toMatch(/on a signal/);
  });

  it('blocks on unparseable output', () => {
    expect(parseVerdict({ stdout: 'not json', status: 0 })).toMatch(/unparseable/);
  });

  it('blocks on JSON carrying no decision', () => {
    expect(parseVerdict({ stdout: '{"hookSpecificOutput":{}}', status: 0 }))
      .toMatch(/no permissionDecision/);
  });
});

describe('buildPayload', () => {
  it('shapes the PreToolUse payload the .sh guards read', () => {
    expect(
      buildPayload({ toolName: 'Read', sessionId: 's', cwd: '/w', filePath: '/w/a.ts' }),
    ).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: 's',
      cwd: '/w',
      tool_name: 'Read',
      tool_input: { file_path: '/w/a.ts' },
    });
  });

  it('maps omp tool names onto the Claude names guards branch on', () => {
    expect(claudeToolName('ast_edit')).toBe('Edit');
    expect(claudeToolName('lsp')).toBe('Edit');
    expect(claudeToolName('apply_patch')).toBe('Edit');
    expect(claudeToolName('todo')).toBeUndefined();
  });
});
