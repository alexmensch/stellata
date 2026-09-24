import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SHELL = readFileSync(resolve(ROOT, 'src/client/stellata.ts'), 'utf8');
const README = readFileSync(resolve(ROOT, 'src/client/README.md'), 'utf8');
const SECTION = '## Decomposing the shell';

const MODIFIERS = /^  (?:(?:private|protected|public|readonly|static|override|declare)\s+)*/;
const FIELD = new RegExp(`${MODIFIERS.source}([A-Za-z_$][\\w$]*)[!?]?\\s*[:=]`);
const ARROW_METHOD = /=\s*(?:async\s+)?\([^)]*\)\s*(?::[^=]+)?=>/;
const BACKTICKED = /`([A-Za-z_$][\w$]*\*?)`/g;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

function shellFields(): string[] {
  const lines = SHELL.split('\n');
  const start = lines.findIndex((l) => l.startsWith('export class Stellata '));
  const end = lines.findIndex((l, i) => i > start && l === '}');
  if (start < 0 || end < 0) throw new Error('Stellata class body not found in stellata.ts');
  const fields = new Set<string>();
  for (const line of lines.slice(start + 1, end)) {
    const m = FIELD.exec(line);
    if (m && !ARROW_METHOD.test(line)) fields.add(m[1]);
  }
  return [...fields];
}

interface Row {
  cluster: string;
  fields: string[];
  sites: string[];
}

function mapRows(): Row[] {
  const from = README.indexOf(SECTION);
  if (from < 0) throw new Error(`${SECTION} not found in src/client/README.md`);
  const next = README.indexOf('\n## ', from + SECTION.length);
  const section = README.slice(from, next < 0 ? undefined : next);
  const tokens = (cell: string) => [...cell.matchAll(BACKTICKED)].map((m) => m[1]);
  return section.split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| ---') && !l.startsWith('| Cluster '))
    .map((l) => l.split(' | '))
    .filter((cells) => cells.length >= 5)
    .map((cells) => ({
      cluster: cells[0].replace(/^\|\s*/, ''),
      fields: tokens(cells[1]),
      sites: tokens(cells[2]),
    }));
}

const matches = (token: string, field: string) =>
  token.endsWith('*') ? field.startsWith(token.slice(0, -1)) : field === token;

describe('stellata.ts decomposition map', () => {
  const fields = shellFields();
  const rows = mapRows();

  it('finds the class fields and the map rows', () => {
    expect(fields.length).toBeGreaterThan(50);
    expect(rows.length).toBeGreaterThan(1);
  });

  it('places every Stellata field in exactly one row', () => {
    const misplaced = fields.flatMap((f) => {
      const owners = rows.filter((r) => r.fields.some((t) => matches(t, f)));
      return owners.length === 1 ? [] : [`${f}: ${owners.length === 0 ? 'no row' : owners.map((r) => r.cluster).join(', ')}`];
    });
    expect(misplaced, 'add the field to its cluster row, or to the stays row').toEqual([]);
  });

  const staleTokens = (column: (r: Row) => string[], names: readonly string[]) =>
    rows.flatMap((r) =>
      column(r).filter((t) => !names.some((n) => matches(t, n))).map((t) => `${r.cluster}: ${t}`));

  it('names no field the shell no longer declares', () => {
    expect(staleTokens((r) => r.fields, fields), 'the PR that moves a cluster deletes its row').toEqual([]);
  });

  it('names no method or site the shell no longer contains', () => {
    const identifiers = [...new Set(SHELL.match(IDENTIFIER))];
    expect(staleTokens((r) => r.sites, identifiers), 'the PR that moves a cluster deletes its row').toEqual([]);
  });
});
