import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { isProductionTs, walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const CLIENT = resolve(ROOT, 'src/client');
const SHELL = resolve(CLIENT, 'stellata.ts');
const CATALOG_LOADER = resolve(CLIENT, 'loaders/catalog-loader.ts');

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function* descendants(node: ts.Node): Generator<ts.Node> {
  for (const child of node.getChildren()) {
    yield child;
    yield* descendants(child);
  }
}

function compilerOptions(): ts.CompilerOptions {
  const config = ts.getParsedCommandLineOfConfigFile(
    resolve(ROOT, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!config) throw new Error('tsconfig.json did not parse');
  return config.options;
}

/** A type that is a streaming `Catalog` but not a `CompleteCatalog`. */
function unbrandedCatalogueTest(program: ts.Program): (type: ts.Type) => boolean {
  const checker = program.getTypeChecker();
  const loader = program.getSourceFile(CATALOG_LOADER);
  const module = loader && checker.getSymbolAtLocation(loader);
  if (!module) throw new Error('catalog-loader.ts missing from the program');
  const exported = (name: string) => {
    const symbol = checker.getExportsOfModule(module).find((s) => s.name === name);
    if (!symbol) throw new Error(`catalog-loader.ts no longer exports ${name}`);
    return checker.getDeclaredTypeOfSymbol(symbol);
  };
  const catalog = exported('Catalog');
  const complete = exported('CompleteCatalog');
  return (type) => checker.isTypeAssignableTo(type, catalog)
    && !checker.isTypeAssignableTo(type, complete);
}

function countBoundedLoops(
  file: ts.SourceFile,
  program: ts.Program,
): { line: number; receiver: string }[] {
  const checker = program.getTypeChecker();
  const isUnbranded = unbrandedCatalogueTest(program);
  const out: { line: number; receiver: string }[] = [];
  for (const node of descendants(file)) {
    if (!ts.isForStatement(node) || !node.condition) continue;
    const cond = node.condition;
    if (!ts.isBinaryExpression(cond)) continue;
    const op = cond.operatorToken.kind;
    if (op !== ts.SyntaxKind.LessThanToken && op !== ts.SyntaxKind.LessThanEqualsToken) continue;
    const bound = cond.right;
    if (!ts.isPropertyAccessExpression(bound) || bound.name.text !== 'count') continue;
    if (!isUnbranded(checker.getTypeAtLocation(bound.expression))) continue;
    out.push({
      line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      receiver: bound.expression.getText(),
    });
  }
  return out;
}

const NULLABLE_SHELL_RETURNS: Readonly<Record<string, string>> = {
  recenterOrigin: 'verdict: null is "no recentre happened"',
  getOrbitFramePort: 'install seam: null is "no instrument", which is its own answer',
  constellationOf: 'late slot awaiting Late: the boundary namer attaches after construction',
  getCloudCatalog: 'late slot awaiting Late: the cloud layer loads after construction',
};

function nullableShellReturns(): string[] {
  const source = parse(SHELL);
  const shell = source.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'Stellata');
  if (!shell) throw new Error('class Stellata not found in stellata.ts');
  const isPrivate = (m: ts.ClassElement) =>
    ts.getCombinedModifierFlags(m as ts.Declaration) & ts.ModifierFlags.Private
    || (m.name !== undefined && ts.isPrivateIdentifier(m.name));
  return shell.members
    .filter((m): m is ts.MethodDeclaration | ts.GetAccessorDeclaration =>
      ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m))
    .filter((m) => !isPrivate(m))
    .filter((m) => m.type !== undefined && ts.isUnionTypeNode(m.type)
      && m.type.types.some((t) => ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword))
    .map((m) => m.name.getText(source));
}

describe('wave-2 read contract (/src/client/README.md#boot-in-two-waves)', () => {
  it('bounds no loop by a catalogue count unless the receiver is a CompleteCatalog', () => {
    const files = [...walkFiles(CLIENT, { include: isProductionTs })];
    const program = ts.createProgram(files, compilerOptions());
    const offenders: string[] = [];
    for (const path of files) {
      const file = program.getSourceFile(path);
      if (!file) throw new Error(`${path} missing from the program`);
      for (const { line, receiver } of countBoundedLoops(file, program)) {
        offenders.push(`${relative(ROOT, path)}:${line} (${receiver}.count)`);
      }
    }
    expect(
      offenders,
      'a walk over every record takes a CompleteCatalog, or bounds itself at loadedCount (/src/client/loaders/README.md#progressive-catalog-load)',
    ).toEqual([]);
  });

  it('flags a count-bounded loop over an unbranded catalogue', () => {
    const probe = resolve(CLIENT, 'late-read-contract.probe.ts');
    const text = [
      "import type { Catalog, CompleteCatalog } from './loaders/catalog-loader';",
      "export function prefix(cat: Catalog) { for (let i = 0; i < cat.count; i++) {} }",
      "export function whole(cat: CompleteCatalog) { for (let i = 0; i < cat.count; i++) {} }",
      "export function other(s: { count: number }) { for (let i = 0; i < s.count; i++) {} }",
    ].join('\n');
    const options = compilerOptions();
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    host.readFile = (f) => (resolve(f) === probe ? text : readFile(f));
    const exists = host.fileExists.bind(host);
    host.fileExists = (f) => resolve(f) === probe || exists(f);
    const getSource = host.getSourceFile.bind(host);
    host.getSourceFile = (f, lang) => (resolve(f) === probe
      ? ts.createSourceFile(f, text, lang, true)
      : getSource(f, lang));
    const program = ts.createProgram([probe], options, host);
    const file = program.getSourceFile(probe)!;
    expect(countBoundedLoops(file, program).map((o) => o.line)).toEqual([2]);
  });

  it('classifies every nullable return on the shell surface', () => {
    const found = nullableShellReturns();
    expect(
      found.filter((name) => !(name in NULLABLE_SHELL_RETURNS)),
      'a late slot on the shell returns Late<T> (/src/client/util/late/README.md); any other null answer is classified here',
    ).toEqual([]);
    expect(
      Object.keys(NULLABLE_SHELL_RETURNS).filter((name) => !found.includes(name)),
      'a converted slot leaves NULLABLE_SHELL_RETURNS',
    ).toEqual([]);
  });
});
