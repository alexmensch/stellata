// .worktreeinclude's text, rendered from the outputs of the steps build:seed runs. See README.md#files.

import type { OutputClaims } from './step-table/step-table-pure';
import type { OutputFamily } from '../util/emit-artifacts';

export const WORKTREE_INCLUDE = '.worktreeinclude';
export const WORKTREE_INCLUDE_COMMAND = 'pnpm run worktree:include';

const SEEDABLE = /^(public|build)\//;
const GLOB_SPECIAL = new Set(['*', '?', '[', ']', '\\', '!', '#']);
const WILD = null;

/** The index just past the `close` that balances the `open` at `start`, skipping escapes. */
function pastClosing(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) return i + 1;
  }
  throw new Error(`unbalanced ${open} in /${source}/`);
}

/** A glob matching every name the anchored `member` matches: each run of non-literal syntax reads as `*`. */
export function memberGlob(member: RegExp): string {
  const source = member.source;
  if (member.flags !== '') throw new Error(`member pattern /${source}/ has flags '${member.flags}', which no glob can carry`);
  if (!source.startsWith('^') || !source.endsWith('$') || source.endsWith('\\$')) {
    throw new Error(`member pattern /${source}/ is not anchored at both ends`);
  }
  const body = source.slice(1, -1);
  const atoms: (string | typeof WILD)[] = [];
  for (let i = 0; i < body.length;) {
    const c = body[i]!;
    if (c === '\\') {
      const next = body[i + 1]!;
      atoms.push(/[A-Za-z0-9]/.test(next) ? WILD : next);
      i += 2;
    } else if (c === '[') {
      atoms.push(WILD);
      i = pastClosing(body, i, '[', ']');
    } else if (c === '(') {
      atoms.push(WILD);
      i = pastClosing(body, i, '(', ')');
    } else if (c === '{') {
      atoms[atoms.length - 1] = WILD;
      i = pastClosing(body, i, '{', '}');
    } else if ('+*?'.includes(c)) {
      atoms[atoms.length - 1] = WILD;
      i++;
    } else if (c === '.') {
      atoms.push(WILD);
      i++;
    } else if ('|^$)]}'.includes(c)) {
      throw new Error(`member pattern /${source}/ has no glob: '${c}' at ${i + 1}`);
    } else {
      atoms.push(c);
      i++;
    }
  }
  const literal = atoms.find((a) => a !== WILD && GLOB_SPECIAL.has(a));
  if (literal !== undefined) throw new Error(`member pattern /${source}/ names a glob metacharacter '${literal}'`);
  return atoms.map((a) => a ?? '*').join('').replace(/\*+/g, '*');
}

function familyPatterns({ dir, member }: OutputFamily): string[] {
  return (member instanceof RegExp ? [memberGlob(member)] : member).map((name) => `${dir}/${name}`);
}

/** `seeds`: each seed step's repo-relative outputs, its stamp among the files. */
export function renderWorktreeInclude(seeds: readonly OutputClaims[]): string {
  const patterns = seeds
    .flatMap(({ files, families }) => [...files, ...families.filter((f) => f.stamped).flatMap(familyPatterns)])
    .filter((path) => SEEDABLE.test(path))
    .sort();
  return [`# Generated from the step table by ${WORKTREE_INCLUDE_COMMAND}; never edit by hand.`, ...patterns, ''].join('\n');
}
