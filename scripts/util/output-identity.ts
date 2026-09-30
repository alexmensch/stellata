// Snapshot every build output's hash, then diff a rebuild against it. See scripts/util/README.md.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  STAMP_DIR, changedSince, fileHashes, readStamp, type FileHashes,
} from './build-stamp';
import { diffOutputHashes, formatDifference, isIdentical } from './output-identity-pure';
import { REPO_ROOT } from './paths';

const SNAPSHOT = resolve(REPO_ROOT, 'build/output-identity.json');

const UNSTAMPED_OUTPUTS = ['public/clouds.json', 'public/local-group.json'];

function stampedOutputs(): string[] {
  const names = existsSync(STAMP_DIR)
    ? readdirSync(STAMP_DIR).filter((f) => f.endsWith('.json'))
    : [];
  if (names.length === 0) {
    throw new Error(`no stamps under ${STAMP_DIR}; run pnpm run build:data first`);
  }
  const outputs: string[] = [];
  for (const name of names) {
    const stamp = readStamp(resolve(STAMP_DIR, name));
    if (stamp === null) throw new Error(`build/stamps/${name} unreadable; rebuild that step`);
    const stale = changedSince(stamp.outputs);
    if (stale.length > 0) {
      throw new Error(
        `build/stamps/${name} does not vouch for ${stale.join(', ')}; rebuild before comparing`,
      );
    }
    outputs.push(...Object.keys(stamp.outputs));
  }
  return outputs;
}

function currentHashes(extra: readonly string[] = []): FileHashes {
  const paths = [...stampedOutputs(), ...UNSTAMPED_OUTPUTS, ...extra];
  return fileHashes(paths.map((p) => resolve(REPO_ROOT, p)));
}

function snapshot(): number {
  const hashes = currentHashes();
  const absent = Object.keys(hashes).filter((p) => hashes[p] === null);
  if (absent.length > 0) {
    console.error(`missing outputs, build them first: ${absent.join(', ')}`);
    return 1;
  }
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, `${JSON.stringify(hashes, null, 2)}\n`);
  console.log(`snapshot: ${Object.keys(hashes).length} outputs → build/output-identity.json`);
  return 0;
}

function diff(): number {
  if (!existsSync(SNAPSHOT)) {
    console.error('no build/output-identity.json; run pnpm run identity:snapshot first');
    return 1;
  }
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
if (mode === 'snapshot') process.exit(snapshot());
else if (mode === 'diff') process.exit(diff());
else {
  console.error('usage: tsx scripts/util/output-identity.ts snapshot|diff');
  process.exit(2);
}
