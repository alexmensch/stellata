// binaries.bin golden: the runtime encoder on a committed fixture, byte for byte. See README.md.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  HEADER_SIZE, RECORD_LAYOUT, RECORD_SIZE, parseBinaries,
} from '../../../src/client/binaries/binaries-loader';
import { REPO_ROOT } from '../../util/paths';

const HERE = resolve(REPO_ROOT, 'scripts/binaries/golden');
const FIXTURE_MULTIPLES = join(HERE, 'fixture-multiples.tsv');
const FIXTURE_ROW_INDEX_MAP = join(HERE, 'fixture-row-index-map.json');
const GOLDEN = join(HERE, 'binaries.golden.bin');
const UPDATE_ENV_VAR = 'UPDATE_BINARIES_GOLDEN';
const GOLDEN_PAIR_COUNT = 54;

const ENCODE_PY = `
import sys
from pathlib import Path
sys.path.insert(0, 'scripts')
from test_helpers import load_kebab_sibling
brb = load_kebab_sibling('scripts/binaries/build-runtime-binaries.py', 'build_runtime_binaries', 'build-runtime-binaries.py')
brb.encode(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
`;

const scratch = mkdtempSync(join(tmpdir(), 'binaries-golden-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function encodeFixture(): Buffer {
  const out = join(scratch, 'binaries.bin');
  execFileSync(
    'python3', ['-c', ENCODE_PY, FIXTURE_MULTIPLES, FIXTURE_ROW_INDEX_MAP, out],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return readFileSync(out);
}

function fieldAt(recordOffset: number): string {
  let name = 'reserved';
  for (const [field, offset] of Object.entries(RECORD_LAYOUT)) {
    if (offset <= recordOffset) name = field;
  }
  return name;
}

function describeFirstDifference(actual: Buffer, golden: Buffer): string | null {
  const n = Math.min(actual.length, golden.length);
  for (let i = 0; i < n; i++) {
    if (actual[i] === golden[i]) continue;
    if (i < HEADER_SIZE) return `header byte ${i} differs`;
    const record = Math.floor((i - HEADER_SIZE) / RECORD_SIZE);
    const field = fieldAt((i - HEADER_SIZE) % RECORD_SIZE);
    return `byte ${i} differs: record ${record}, field ${field}`;
  }
  return actual.length === golden.length
    ? null
    : `length ${actual.length} vs golden ${golden.length}`;
}

describe('binaries.bin golden', () => {
  const actual = encodeFixture();

  it('the encoder reproduces the committed golden byte for byte', () => {
    if (process.env[UPDATE_ENV_VAR] === '1') writeFileSync(GOLDEN, actual);
    expect(
      existsSync(GOLDEN),
      `${GOLDEN} missing; write it with ${UPDATE_ENV_VAR}=1 pnpm test scripts/binaries/golden`,
    ).toBe(true);
    const difference = describeFirstDifference(actual, readFileSync(GOLDEN));
    expect(
      difference,
      `re-baseline with ${UPDATE_ENV_VAR}=1 only when the change is meant to alter binaries.bin`,
    ).toBeNull();
  });

  it('the loader parses the golden', () => {
    const golden = readFileSync(GOLDEN);
    const buf = golden.buffer.slice(golden.byteOffset, golden.byteOffset + golden.byteLength);
    expect(parseBinaries(buf).relations.length).toBe(GOLDEN_PAIR_COUNT);
  });
});
