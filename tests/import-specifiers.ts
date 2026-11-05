// Import-specifier scan shared by the import-boundary tests.

export type ImportKind = 'value import' | 'side-effect import' | 'dynamic import';

export interface ImportSpecifier {
  spec: string;
  kind: ImportKind;
  typeOnly: boolean;
}

const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export const isRelativeSpecifier = (spec: string) => spec.startsWith('.');

export function importSpecifiers(src: string): ImportSpecifier[] {
  const out: ImportSpecifier[] = [];
  for (const [, typeKw, spec] of src.matchAll(STATIC_IMPORT_RE)) {
    out.push({ spec, kind: 'value import', typeOnly: !!typeKw });
  }
  for (const [, spec] of src.matchAll(BARE_IMPORT_RE)) out.push({ spec, kind: 'side-effect import', typeOnly: false });
  for (const [, spec] of src.matchAll(DYNAMIC_IMPORT_RE)) out.push({ spec, kind: 'dynamic import', typeOnly: false });
  return out;
}

// A fixture is test-only support that happens not to be a test itself, so it
// reads data/ off the filesystem like one; the suffix is the whole marker.
export const isFixture = (p: string) => p.endsWith('-fixture.ts');

export const isTypeScript = (p: string) => /\.m?ts$/.test(p) && !p.endsWith('.d.ts');

export const isShippedSource = (p: string) =>
  isTypeScript(p) && !/\.test\.m?ts$/.test(p) && !isFixture(p);
