// A code file's identity: the sha1 of its token stream, comments and docstrings dropped. See README.md.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';

import { REPO_ROOT } from './paths';

const PYTHON_IDENTITY = resolve(REPO_ROOT, 'scripts/util/code_identity.py');

const isJsDoc = (node: ts.Node): boolean => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

export function tsIdentity(text: string): string {
  const source = ts.createSourceFile('identity.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tokens: string[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(source).filter((c) => !isJsDoc(c));
    if (children.length === 0) tokens.push(text.slice(node.getStart(source), node.end));
    else children.forEach(visit);
  };
  visit(source);
  return createHash('sha1').update(JSON.stringify(tokens)).digest('hex');
}

function pythonIdentities(paths: readonly string[]): Record<string, string> {
  if (paths.length === 0) return {};
  const run = spawnSync('python3', ['-I', '-S', PYTHON_IDENTITY], { input: paths.join('\n'), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`code_identity.py exited ${run.status ?? run.signal}: ${run.error?.message ?? run.stderr.trim()}`);
  return JSON.parse(run.stdout) as Record<string, string>;
}

/** Absolute path → identity, for existing files `CODE_FILE` matches. */
export function codeIdentities(paths: readonly string[]): Record<string, string> {
  return {
    ...pythonIdentities(paths.filter((p) => p.endsWith('.py'))),
    ...Object.fromEntries(paths.filter((p) => !p.endsWith('.py')).map((p) => [p, tsIdentity(readFileSync(p, 'utf8'))])),
  };
}
