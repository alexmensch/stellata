// Git's view of the tree: the file list, and which of those files Git LFS stores.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

export function gitFiles(
  root: string,
  pathspecs: string[] = [],
  { untracked = false }: { untracked?: boolean } = {},
): string[] {
  const args = ['ls-files', '-z', '--cached'];
  if (untracked) args.push('--others', '--exclude-standard');
  return execFileSync('git', [...args, '--', ...pathspecs], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((name) => name !== '');
}

/** The names that are regular files on disk: git still lists a tracked file deleted but not staged, and a symlink would double its target. */
export function presentFiles(root: string, names: string[]): string[] {
  return names.filter((name) => {
    const path = join(root, name);
    return existsSync(path) && !lstatSync(path).isSymbolicLink();
  });
}

export function lfsTracked(root: string, names: string[]): Set<string> {
  const fields = execFileSync('git', ['check-attr', '-z', '--stdin', 'filter'], {
    cwd: root,
    input: names.join('\0'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).split('\0');
  const tracked = new Set<string>();
  for (let i = 0; i + 2 < fields.length; i += 3) if (fields[i + 2] === 'lfs') tracked.add(fields[i]);
  return tracked;
}
