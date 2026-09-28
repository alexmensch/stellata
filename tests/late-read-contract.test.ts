import { describe, expect, it } from 'vitest';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { isProductionTs, walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const CLIENT = resolve(ROOT, 'src/client');
const SHELL = resolve(CLIENT, 'stellata.ts');
const CATALOG_LOADER = resolve(CLIENT, 'loaders/catalog-loader.ts');

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

const LOADERS = resolve(CLIENT, 'loaders');
const isCatalogueModule = (path: string) =>
  resolve(path).startsWith(`${LOADERS}/catalog-`);

/** Reads of `Catalog.loadedCount` — resolved to the declaration, so another
 *  type's field of the same name does not count. */
function loadedCountReads(file: ts.SourceFile, program: ts.Program): number[] {
  const checker = program.getTypeChecker();
  const out: number[] = [];
  for (const node of descendants(file)) {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'loadedCount') continue;
    const decl = checker.getSymbolAtLocation(node.name)?.declarations?.[0];
    if (!decl || resolve(decl.getSourceFile().fileName) !== CATALOG_LOADER) continue;
    out.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
  }
  return out;
}

const PER_CHUNK_WALK = 'per-chunk absorb: walks from its own watermark to the decoded end';

/** Readers outside the catalogue module, by file, with how many reads each
 *  is allowed. A walk bounded by the decoded end is the prefix reader
 *  /src/client/README.md#boot-in-two-waves names; anything else asks the owner. */
const LOADED_COUNT_READERS: Readonly<Record<string, { reads: number; why: string }>> = {
  'src/client/star-pipeline/star-frame/star-frame.ts': { reads: 3, why: PER_CHUNK_WALK },
  'src/client/star-pipeline/star-pipeline.ts': { reads: 3, why: PER_CHUNK_WALK },
  'src/client/webgpu/star/star-tables.ts': { reads: 1, why: PER_CHUNK_WALK },
  'src/client/webgpu/star/star-layer.ts': { reads: 2, why: 'compaction thread count: the draw is the decoded count' },
  'src/client/webgpu/extinction/extinction-prepass-webgpu.ts': {
    reads: 2,
    why: 'the one re-sort runs on the refresh the last chunk fires, a microtask before catalog.complete settles',
  },
};

/** A throwaway program over one in-memory source file beside the client. */
function probeProgram(text: string): { program: ts.Program; file: ts.SourceFile } {
  const probe = resolve(CLIENT, 'late-read-contract.probe.ts');
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
  return { program, file: program.getSourceFile(probe)! };
}

const NO_SELECTION = 'verdict: null is "nothing selected", its own answer';

/** Keyed `method` on the shell, `namespace.method` on a readonly namespace. */
const NULLABLE_SHELL_RETURNS: Readonly<Record<string, string>> = {
  getOrbitFramePort: 'install seam: null is "no instrument", which is its own answer',
  'adaptation.getLandedStatistic': 'verdict: null is "no reduction has landed", which a dark frame\'s 0 cannot say',
  'constellationFigure.aimDirection': 'verdict: null is "no figure with a vertex in any direction from there"',
  'constellationBoundaries.constellationOf':
    'verdict: null is "nothing to name" — the artifact arrives at construction, so never "not yet"',
  'observe.observeAnchorOf': NO_SELECTION,
  'observe.getProgress': 'verdict: null is "no observe transition running"',
  'focus.getFocusedStar': NO_SELECTION,
  'focus.getFocusedTarget': NO_SELECTION,
  'focus.getFocusedPlanetSystem': NO_SELECTION,
  'focus.getVectorTo': NO_SELECTION,
  'focus.getVectorTarget': NO_SELECTION,
  'focus.getFocusedHardTarget': NO_SELECTION,
  'floatingOrigin.recenterTo': 'verdict: null is "no recentre happened"',
  'focus.hardFocusParkDist': NO_SELECTION,
  'focus.makeFocusTarget': 'verdict: null is "this target cannot be focused"',
  'focus.currentFocusTarget': NO_SELECTION,
  'warp.getWarpInfo': 'verdict: null is "no warp in flight"',
  'warp.getWarpPhase': 'verdict: null is "no warp in flight"',
  'milkyway.contributionSkip': 'verdict: null is "no skip applies this frame"',
  'extinction.avMagAt': 'no answer: no dust, the A/B fallback or a cold mirror; the pick decides',
  'extinction.countInFrame': 'no answer until the prepass has dispatched a view',
  'picker.pickStarHit': 'verdict: null is "nothing under the pointer"',
  'picker.pickKindHit': 'verdict: null is "nothing under the pointer"',
  'picker.pickAnyKindHit': 'verdict: null is "nothing under the pointer"',
};

let clientProgram: ts.Program | undefined;
function program(): ts.Program {
  clientProgram ??= ts.createProgram([...walkFiles(CLIENT, { include: isProductionTs })], compilerOptions());
  return clientProgram;
}

const isPrivate = (m: ts.ClassElement) =>
  ts.getCombinedModifierFlags(m as ts.Declaration) & ts.ModifierFlags.Private
  || (m.name !== undefined && ts.isPrivateIdentifier(m.name));

function nullableReturnsOf(cls: ts.ClassDeclaration): string[] {
  const source = cls.getSourceFile();
  return cls.members
    .filter((m): m is ts.MethodDeclaration | ts.GetAccessorDeclaration =>
      ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m))
    .filter((m) => !isPrivate(m))
    .filter((m) => m.type !== undefined && ts.isUnionTypeNode(m.type)
      && m.type.types.some((t) => ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword))
    .map((m) => m.name.getText(source));
}

/** The shell's own methods, and those of every class it exposes as a readonly
 *  namespace field — the namespaces are its public surface too. */
function nullableShellReturns(): string[] {
  const source = program().getSourceFile(SHELL);
  const shell = source?.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'Stellata');
  if (!shell) throw new Error('class Stellata not found in stellata.ts');
  const checker = program().getTypeChecker();
  const found = nullableReturnsOf(shell);
  for (const m of shell.members) {
    if (!ts.isPropertyDeclaration(m) || isPrivate(m)) continue;
    if (!(ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Readonly)) continue;
    const decl = checker.getTypeAtLocation(m).getSymbol()?.declarations?.[0];
    if (!decl || !ts.isClassDeclaration(decl) || !decl.getSourceFile().fileName.startsWith(CLIENT)) continue;
    const ns = m.name.getText(source);
    found.push(...nullableReturnsOf(decl).map((name) => `${ns}.${name}`));
  }
  return found;
}

describe('wave-2 read contract (/src/client/README.md#boot-in-two-waves)', () => {
  it('bounds no loop by a catalogue count unless the receiver is a CompleteCatalog', () => {
    const p = program();
    const offenders: string[] = [];
    for (const path of p.getRootFileNames()) {
      const file = p.getSourceFile(path);
      if (!file) throw new Error(`${path} missing from the program`);
      for (const { line, receiver } of countBoundedLoops(file, p)) {
        offenders.push(`${relative(ROOT, path)}:${line} (${receiver}.count)`);
      }
    }
    expect(
      offenders,
      'a walk over every record takes a CompleteCatalog, or bounds itself at loadedCount (/src/client/loaders/README.md#progressive-catalog-load)',
    ).toEqual([]);
  });

  it('flags a count-bounded loop over an unbranded catalogue', () => {
    const { program, file } = probeProgram([
      "import type { Catalog, CompleteCatalog } from './loaders/catalog-loader';",
      "export function prefix(cat: Catalog) { for (let i = 0; i < cat.count; i++) {} }",
      "export function whole(cat: CompleteCatalog) { for (let i = 0; i < cat.count; i++) {} }",
      "export function other(s: { count: number }) { for (let i = 0; i < s.count; i++) {} }",
    ].join('\n'));
    expect(countBoundedLoops(file, program).map((o) => o.line)).toEqual([2]);
  });

  it('reads Catalog.loadedCount only in the catalogue module and the listed readers', () => {
    const p = program();
    const found: Record<string, number> = {};
    for (const path of p.getRootFileNames()) {
      if (isCatalogueModule(path)) continue;
      const reads = loadedCountReads(p.getSourceFile(path)!, p).length;
      if (reads > 0) found[relative(ROOT, path)] = reads;
    }
    const allowed = Object.fromEntries(
      Object.entries(LOADED_COUNT_READERS).map(([path, { reads }]) => [path, reads]));
    expect(
      found,
      'ask the catalogue — isDecodedRecord, catalog.complete, onRecordsDecoded — rather than read its count; a new prefix walk is listed in LOADED_COUNT_READERS',
    ).toEqual(allowed);
  });

  it('flags a Catalog.loadedCount read and no other loadedCount', () => {
    const { program, file } = probeProgram([
      "import type { Catalog } from './loaders/catalog-loader';",
      "export const decoded = (cat: Catalog) => cat.loadedCount;",
      "export const other = (s: { loadedCount: number }) => s.loadedCount;",
      "export const picked = (cat: Pick<Catalog, 'loadedCount'>) => cat.loadedCount;",
    ].join('\n'));
    expect(loadedCountReads(file, program)).toEqual([2, 4]);
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
