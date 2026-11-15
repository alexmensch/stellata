import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const REPO = resolve(__dirname, '../..');
const WIRING = resolve(__dirname, 'build-catalog.ts');

/** Each phase's one `enterPhase` call site, by the pass that completes it, and the allocated SIDs' one tag. */
const PHASE_ENTRIES: Record<string, string> = {
  walked: 'scripts/catalog/stages/walk-stage.ts',
  named: 'scripts/catalog/stages/naming-stage.ts',
  promoted: 'scripts/catalog/stages/promotion-stage.ts',
  sorted: 'scripts/catalog/record/record-order-pure.ts',
  allocatedSids: 'scripts/catalog/stages/allocation-stage.ts',
};

const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken,
]);

const isCall = (e: ts.Expression): boolean =>
  ts.isCallExpression(e) || (ts.isAwaitExpression(e) && ts.isCallExpression(e.expression));

/** Every way a function body in `source` departs from wiring: a statement
 *  other than a `const` initialised by a call, a closing `return` or the one
 *  closing `emitArtifacts` call, and any loop, `throw` or arithmetic anywhere. */
function wiringViolations(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const at = (n: ts.Node) => `${n.getText(sf).split('\n')[0]} (line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1})`;
  for (const fn of sf.statements.filter(ts.isFunctionDeclaration)) {
    const statements = fn.body?.statements ?? [];
    statements.forEach((st, i) => {
      const last = i === statements.length - 1;
      const callConst = ts.isVariableStatement(st)
        && (st.declarationList.flags & ts.NodeFlags.Const) !== 0
        && st.declarationList.declarations.every((d) => d.initializer !== undefined && isCall(d.initializer));
      const closingReturn = last && ts.isReturnStatement(st);
      const closingEmit = last && ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)
        && st.expression.expression.getText(sf) === 'emitArtifacts';
      if (!callConst && !closingReturn && !closingEmit) out.push(`statement: ${at(st)}`);
    });
    const visit = (n: ts.Node): void => {
      if (ts.isIterationStatement(n, false)) out.push(`loop: ${at(n)}`);
      else if (ts.isThrowStatement(n)) out.push(`throw: ${at(n)}`);
      else if (ts.isBinaryExpression(n) && ARITHMETIC.has(n.operatorToken.kind)) out.push(`arithmetic: ${at(n)}`);
      else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n))
        && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) out.push(`arithmetic: ${at(n)}`);
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** Outside tests, each `enterPhase('<phase>', …)` call site by phase, and each `allocatedSids(` call site. */
function tagConstructors(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const path of [...sourceFiles(resolve(REPO, 'scripts')), ...sourceFiles(resolve(REPO, 'src'))]) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/\benterPhase\(\s*'(\w+)'/g)) (out[m[1]] ??= []).push(relative(REPO, path));
    for (const _ of text.matchAll(/(?<!function )\ballocatedSids\(/g)) (out.allocatedSids ??= []).push(relative(REPO, path));
  }
  return out;
}

describe('build-catalog.ts wiring ratchet', () => {
  it('holds only stage calls: no loop, throw or arithmetic, and no statement but a call-initialised const', () => {
    expect(
      wiringViolations(WIRING, readFileSync(WIRING, 'utf8')),
      'build-catalog.ts is wiring only: move the logic into a stage (stages/README.md#the-wiring-ratchet)',
    ).toEqual([]);
  });

  it('enters each phase once, in the pass that completes it, and tags the SIDs only in allocation', () => {
    expect(tagConstructors()).toEqual(Object.fromEntries(Object.entries(PHASE_ENTRIES).map(([p, f]) => [p, [f]])));
  });

  it('catches each departure from wiring', () => {
    const probe = [
      'async function main() {',
      '  const a = stage();',
      '  const b = await other(a);',
      '  let c = stage();',
      '  const d = a.length;',
      '  for (const x of b) log(x);',
      '  if (a) throw new Error("no");',
      '  const e = stage(a + 1, () => { n++; });',
      '  emitArtifacts(e);',
      '}',
      'function pre() {',
      '  log();',
      '  return { a: stage() };',
      '}',
    ].join('\n');
    expect(wiringViolations('probe.ts', probe)).toEqual([
      'statement: let c = stage(); (line 4)',
      'statement: const d = a.length; (line 5)',
      'statement: for (const x of b) log(x); (line 6)',
      'statement: if (a) throw new Error("no"); (line 7)',
      'loop: for (const x of b) log(x); (line 6)',
      'throw: throw new Error("no"); (line 7)',
      'arithmetic: a + 1 (line 8)',
      'arithmetic: n++ (line 8)',
      'statement: log(); (line 12)',
    ]);
  });
});
