// See /tests/README.md#public-artifact-names.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { isProductionTs, walkFiles } from './walk-files';
import { DUST_MANIFEST, PUBLIC_FILES, PUBLIC_FOLDERS } from '../src/catalog-format/public-artifacts/public-artifacts';
import { PUBLIC_DIR } from '../scripts/util/paths';
import { CATALOG_MANIFEST_FILENAME } from '../src/catalog-format/record/catalog-pure';

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'scripts'];
const SCAN_FILES = ['vite.config.ts'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fileName = (name: string) => new RegExp(`(^|[^\\w.-])${escape(name)}($|[^\\w-])`);

interface Owned { label: string; owner: string; re: RegExp }

const OWNED: Owned[] = [
  { label: `${PUBLIC_DIR}/`, owner: 'scripts/util/paths.ts', re: new RegExp(`^${escape(PUBLIC_DIR)}(/|$)`) },
  ...Object.values(PUBLIC_FILES).map((name) => ({
    label: name, owner: 'src/catalog-format/public-artifacts/', re: fileName(name),
  })),
  ...Object.values(PUBLIC_FOLDERS).map((dir) => ({
    label: `${dir}/`,
    owner: 'src/catalog-format/public-artifacts/',
    re: new RegExp(`^${escape(dir)}/|${PUBLIC_DIR}/${escape(dir)}(/|$)`),
  })),
  { label: DUST_MANIFEST, owner: 'src/catalog-format/public-artifacts/', re: fileName(DUST_MANIFEST) },
  { label: CATALOG_MANIFEST_FILENAME, owner: 'src/catalog-format/record/', re: fileName(CATALOG_MANIFEST_FILENAME) },
  { label: 'catalog.bin.<i>', owner: 'src/catalog-format/record/', re: /(^|[^\w.-])catalog\.bin\.(\d|$)/ },
];

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node;
  if (ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent)) return true;
  return ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function* literalTexts(sf: ts.SourceFile): Generator<{ text: string; line: number }> {
  const visit = function* (node: ts.Node): Generator<{ text: string; line: number }> {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && !isModuleSpecifier(node)) {
      yield { text: node.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
    }
    for (const child of node.getChildren(sf)) yield* visit(child);
  };
  yield* visit(sf);
}

function* scannedFiles(): Generator<string> {
  for (const dir of SCAN_DIRS) {
    yield* walkFiles(resolve(ROOT, dir), {
      include: (p) => isProductionTs(p) || /\.mts$/.test(p),
      skipDir: (name) => name === 'node_modules',
    });
  }
  for (const file of SCAN_FILES) yield resolve(ROOT, file);
}

function spellings(): string[] {
  const found: string[] = [];
  for (const path of scannedFiles()) {
    const repoPath = relative(ROOT, path);
    const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const { text, line } of literalTexts(sf)) {
      for (const owned of OWNED) {
        if (!repoPath.startsWith(owned.owner) && owned.re.test(text)) {
          found.push(`${repoPath}:${line} spells ${owned.label} — import it from ${owned.owner}`);
        }
      }
    }
  }
  return found;
}

describe('public artifact names', () => {
  it('each is spelled once, in its owner, across production TypeScript', () => {
    expect(spellings()).toEqual([]);
  });
});
