// Rebuild every output from scratch, snapshot its hash, then diff a later rebuild against it. See scripts/util/README.md.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STAMP_DIR, fileHashes, readStamp, type FileHashes } from './build-stamp';
import { diffOutputHashes, formatDifference, isIdentical } from './output-identity-pure';
import { REPO_ROOT } from './paths';

const SNAPSHOT = resolve(REPO_ROOT, 'build/output-identity.json');

const UNSTAMPED_OUTPUTS = ['public/clouds.json', 'public/local-group.json'];

function rebuildFromScratch(): void {
  const sh = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  sh('git', ['clean', '-fdqX', '--', 'public']);
  rmSync(STAMP_DIR, { recursive: true, force: true });
  sh('pnpm', ['run', 'build:data']);
}

function stampedOutputs(): string[] {
  return readdirSync(STAMP_DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((name) => {
      const stamp = readStamp(resolve(STAMP_DIR, name));
      if (stamp === null) throw new Error(`build/stamps/${name} unreadable after a full rebuild`);
      return Object.keys(stamp.outputs);
    });
}

function currentHashes(extra: readonly string[] = []): FileHashes {
  const paths = [...stampedOutputs(), ...UNSTAMPED_OUTPUTS, ...extra];
  return fileHashes(paths.map((p) => resolve(REPO_ROOT, p)));
}

function snapshot(): number {
  const hashes = currentHashes();
  const absent = Object.keys(hashes).filter((p) => hashes[p] === null);
  if (absent.length > 0) {
    console.error(`missing outputs after a full rebuild: ${absent.join(', ')}`);
    return 1;
  }
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, `${JSON.stringify(hashes, null, 2)}\n`);
  console.log(`snapshot: ${Object.keys(hashes).length} outputs → build/output-identity.json`);
  return 0;
}

function diff(): number {
  const before = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as FileHashes;
  const d = diffOutputHashes(before, currentHashes(Object.keys(before)));
  if (isIdentical(d)) {
    console.log(`identical: ${Object.keys(before).length} outputs`);
    return 0;
  }
  for (const line of formatDifference(d)) console.log(line);
  return 1;
}

const mode = process.argv[2];
if (mode !== 'snapshot' && mode !== 'diff') {
  console.error('usage: tsx scripts/util/output-identity.ts snapshot|diff');
  process.exit(2);
}
if (mode === 'diff' && !existsSync(SNAPSHOT)) {
  console.error('no build/output-identity.json; run pnpm run identity:snapshot first');
  process.exit(1);
}
rebuildFromScratch();
process.exit(mode === 'snapshot' ? snapshot() : diff());
