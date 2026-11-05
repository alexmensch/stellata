// See tests/README.md (source-declarations.test.ts).

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declaredInputs, DECLARING_MODULE } from '../scripts/util/sources/declared-inputs';
import { entryClosure, packageScripts } from '../scripts/util/import-closure';
import { RUNNER, scriptParts, tsxEntries } from '../scripts/util/import-closure-pure';
import { closureReadingWriters } from '../scripts/pipeline/step-table/non-step-writers';
import { STEPS } from '../scripts/pipeline/step-table/steps';
import { stepEntries } from '../scripts/util/step-inputs';
import { REPO_ROOT } from '../scripts/util/paths';
import { DATA_FILES } from '../src/catalog-format/pipeline-outputs/data-files';
import { writeEntryFixture } from './entry-fixture';
import { isProductionTs, walkFiles } from './walk-files';

const OUT_OF_PIPELINE = /^scripts\/(perf|release|hooks|ci)\//;

const DATA_FILES_MODULE = 'src/catalog-format/pipeline-outputs/data-files.ts';

const DATA_PATH_SPELLERS = [
  'scripts/catalog/catalog-inputs.test.ts',
  'scripts/local-group/local-group-inputs.test.ts',
  DATA_FILES_MODULE,
  'tests/citation-index.test.ts',
  'tests/doc-pointer-resolution.test.ts',
  'tests/paper-store-link.test.ts',
  'tests/readme-trees.test.ts',
  'tests/readme-trees.ts',
];

const isTs = (path: string): boolean => path.endsWith('.ts') && !path.endsWith('.d.ts');

/** Modules that call a define* only inside a factory the declaring modules call. */
const DECLARATION_FACTORIES = ['scripts/util/mirror-to-public.ts'];

const scripts = packageScripts();
const WRITERS = closureReadingWriters();
/** Every step and non-step writer with TypeScript in it: an all-Python step records its reads at run time. */
const TS_STEPS = [...STEPS.steps.map((s) => s.name), ...WRITERS]
  .filter((name) => stepEntries(name).some((entry) => entry !== RUNNER));

/** Every file the launcher starts: each package.json tsx command's entry and each TypeScript step's on the table. */
const LAUNCHED = [...new Set([
  ...Object.keys(scripts).flatMap((name) => tsxEntries(scripts, name)),
  ...STEPS.steps.flatMap((s) => (s.language === 'ts' ? [s.entry] : [])),
])].sort();

const DECLARATION_KINDS = new Set([
  ts.SyntaxKind.ImportDeclaration, ts.SyntaxKind.ImportEqualsDeclaration, ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration, ts.SyntaxKind.EnumDeclaration, ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement, ts.SyntaxKind.EmptyStatement,
]);

const callsMain = (node: ts.Node): boolean => (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
  && node.expression.text === 'main') || ts.forEachChild(node, callsMain) === true;

/** Top-level statements that run on import: anything but a declaration, or a declaration whose value calls main. */
function runsOnImport(rel: string, text = readFileSync(resolve(REPO_ROOT, rel), 'utf8')): string[] {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  return source.statements
    .filter((s) => !DECLARATION_KINDS.has(s.kind) || (ts.isVariableStatement(s) && callsMain(s)))
    .map((s) => `${rel}:${source.getLineAndCharacterOfPosition(s.getStart()).line + 1} ${s.getText().split('\n')[0]}`);
}

function codeLinesOutsideSpellers(): { rel: string; at: string; code: string }[] {
  const files = [
    ...['scripts', 'src', 'tests'].flatMap((root) => [...walkFiles(resolve(REPO_ROOT, root), { include: isTs })]),
    ...readdirSync(REPO_ROOT).filter((name) => /^vite.*\.ts$/.test(name)).map((name) => resolve(REPO_ROOT, name)),
  ];
  return files.flatMap((file) => {
    const rel = file.slice(REPO_ROOT.length + 1);
    if (OUT_OF_PIPELINE.test(rel) || DATA_PATH_SPELLERS.includes(rel)) return [];
    return readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      return /^\s*(\*|\/\*)/.test(code) ? [] : [{ rel, at: `${rel}:${i + 1}`, code }];
    });
  });
}

describe('source declarations', () => {
  it('resolves every non-step writer into entries it can check', () => {
    const unresolved = WRITERS.filter((name) => scriptParts(scripts, name).some((p) => p.kind === 'other'));
    expect(unresolved).toEqual([]);
    expect(TS_STEPS).toEqual(expect.arrayContaining(['build:catalog', 'lineage:codes', 'build:local-group', 'build:clouds', 'sid:risk-set']));
  });

  it.each(TS_STEPS)('%s reads every source and artifact its import closure reaches', async (step) => {
    const unread = (await declaredInputs(await entryClosure(stepEntries(step))))
      .filter(({ use }) => use === 'unused');
    expect(unread.map(({ module, name }) => `${module}#${name}`)).toEqual([]);
  }, 60_000);

  it('names a data/ path only in a declaring or outputs module, tree-wide', () => {
    const offenders = codeLinesOutsideSpellers()
      .filter(({ rel, code }) => !DECLARING_MODULE.test(rel) && !/-outputs\.ts$/.test(rel)
        && /['"`]data\/|,\s*['"]data['"]\s*[,)]/.test(code))
      .map(({ at }) => at);
    expect(offenders).toEqual([]);
  });

  it('lets only DATA_FILES spell a data/ path among production modules', () => {
    expect(DATA_PATH_SPELLERS.filter((rel) => /^(scripts|src)\//.test(rel) && isProductionTs(rel))).toEqual([DATA_FILES_MODULE]);
  });

  it('spells a DATA_FILES path only in DATA_FILES', () => {
    const literals = Object.values(DATA_FILES).flatMap((path) => ["'", '"', '`'].map((q) => `${q}${path}${q}`));
    const offenders = codeLinesOutsideSpellers()
      .filter(({ code }) => literals.some((literal) => code.includes(literal)))
      .map(({ at }) => at);
    expect(offenders).toEqual([]);
  });

  it('starts every package.json tsx command through the launcher', () => {
    const bypassing = Object.keys(scripts).flatMap((name) => scriptParts(scripts, name))
      .flatMap((p) => (p.kind === 'other' && /^tsx\s/.test(p.command) ? [p.command] : []));
    expect(bypassing).toEqual([]);
  });

  it('gives every launched entry a top level of declarations only, so importing it runs nothing', () => {
    expect(LAUNCHED.length).toBeGreaterThan(STEPS.steps.length / 2);
    expect(LAUNCHED.flatMap((rel) => runsOnImport(rel))).toEqual([]);
  });

  it('reads a self-call, a guard or a value computed by main as running on import', () => {
    const entry = (tail: string): string => `import { x } from './x';\nexport function main(): void { x(); }\n${tail}\n`;
    expect(runsOnImport('e.ts', entry('const y = 1;'))).toEqual([]);
    expect(runsOnImport('e.ts', entry('main();'))).toEqual(['e.ts:3 main();']);
    expect(runsOnImport('e.ts', entry('if (process.argv[1]) main();'))).toEqual(['e.ts:3 if (process.argv[1]) main();']);
    expect(runsOnImport('e.ts', entry('const done = main();'))).toEqual(['e.ts:3 const done = main();']);
  });

  it('runs nothing when the input-set walk imports an entry named like a declaring module', async () => {
    const entry = writeEntryFixture('foo-tsv.ts');
    expect(DECLARING_MODULE.test(entry.path)).toBe(true);
    await declaredInputs([entry.path]);
    expect(entry.runs()).toEqual([]);
  });

  it('declares sources only in a module named for it', () => {
    const misplaced: string[] = [];
    for (const file of walkFiles(resolve(REPO_ROOT, 'scripts'), { include: isProductionTs })) {
      const rel = file.slice(REPO_ROOT.length + 1);
      if (DECLARATION_FACTORIES.includes(rel)) continue;
      if (/\b(defineSource|defineFolder|defineArtifact|defineJsonArtifact)\(/.test(readFileSync(file, 'utf8')) && !DECLARING_MODULE.test(rel)) {
        misplaced.push(rel);
      }
    }
    expect(misplaced).toEqual([]);
  });

  it('opens a declared file only inside the sources core', () => {
    const openers: string[] = [];
    for (const root of ['scripts', 'src']) {
      for (const file of walkFiles(resolve(REPO_ROOT, root), { include: isProductionTs })) {
        const rel = file.slice(REPO_ROOT.length + 1);
        if (rel === 'scripts/util/sources/source.ts') continue;
        if (/\bopenDeclared\(/.test(readFileSync(file, 'utf8'))) openers.push(rel);
      }
    }
    expect(openers).toEqual([]);
  });
});
