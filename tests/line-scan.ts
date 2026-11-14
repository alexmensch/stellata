// Repo-relative source lists and per-line rule hits for the pattern scanners.
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';

export const REPO_ROOT = resolve(__dirname, '..');

export interface LineRule {
  name: string;
  re: RegExp;
}

export function scanTree(
  dirs: readonly string[],
  include: (path: string) => boolean,
  exclude: ReadonlySet<string>,
): string[] {
  return dirs
    .flatMap((dir) => [...walkFiles(join(REPO_ROOT, dir), { skipDir: (n) => n === 'node_modules', include })])
    .map((p) => relative(REPO_ROOT, p))
    .filter((p) => !exclude.has(p));
}

export const firstRule = (line: string, rules: readonly LineRule[]): string | undefined =>
  rules.find(({ re }) => re.test(line))?.name;

export function lineHits(path: string, rules: readonly LineRule[]): string[] {
  return readFileSync(join(REPO_ROOT, path), 'utf8').split('\n').flatMap((line, i) => {
    const rule = firstRule(line, rules);
    return rule === undefined ? [] : [`${path}:${i + 1} [${rule}] ${line.trim()}`];
  });
}
