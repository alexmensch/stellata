// Lists unmarked snapshot copies on the lines a staged commit adds to markdown; exit 1 when there are any.
import { execFileSync } from 'node:child_process';
import { loadSnapshots } from './doc-figures';
import { addedLineNumbers, scannable, snapshotLeaves, unmarkedSnapshotCopies } from './doc-figures-pure';

const root = process.argv[2] ?? process.cwd();
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const leaves = snapshotLeaves(loadSnapshots(root));
const findings: string[] = [];
for (const file of git('diff', '--cached', '--name-only', '--diff-filter=AM', '--', '*.md').split('\n').filter(Boolean)) {
  const added = addedLineNumbers(git('diff', '--cached', '-U0', '--', file));
  const staged = scannable(git('show', `:${file}`), 'markdown');
  for (const { line, figure, keys } of unmarkedSnapshotCopies(staged, added, leaves)) {
    findings.push(`  ${file}:${line}: ${figure} — ${keys.slice(0, 3).join(' | ')}${keys.length > 3 ? ` (+${keys.length - 3})` : ''}`);
  }
}
if (findings.length > 0) {
  console.log(findings.join('\n'));
  process.exit(1);
}
