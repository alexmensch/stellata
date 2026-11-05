// binaries.bin golden: the runtime encoder on a committed fixture, byte for byte. See /scripts/binaries/golden/README.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseBinaries } from '../../src/client/binaries/binaries-loader';
import {
  HEADER_SIZE, RECORD_LAYOUT, RECORD_SIZE,
} from '../../src/catalog-format/binaries/binaries-format';
import { MULTIPLES_TSV } from '../../scripts/binaries/multiples-tsv';
import { encodeRuntimeBinaries, type RuntimeBinaries } from '../../scripts/binaries/runtime-binaries-pure';
import { parseCatalogRowIndexMap } from '../../scripts/catalog/companions/record-index/catalog-row-index-map-pure';
import { REPO_ROOT } from '../../scripts/util/paths';
import { hashBytes } from '../../scripts/util/stamp-hash';

const HERE = resolve(REPO_ROOT, 'scripts/binaries/golden');
const FIXTURE_MULTIPLES = join(HERE, 'fixture-multiples.tsv');
const FIXTURE_ROW_INDEX_MAP = join(HERE, 'fixture-row-index-map.json');
const GOLDEN = join(HERE, 'binaries.golden.bin');
const UPDATE_ENV_VAR = 'UPDATE_BINARIES_GOLDEN';
const UPDATE_COMMAND = `${UPDATE_ENV_VAR}=1 pnpm vitest run tests/integration/binaries-bin-golden.test.ts`;
const EXPECTED_COUNTS = {
  pairs_total: 85,
  pairs_emitted: 54,
  pairs_dropped_primary_unresolved: 15,
  pairs_dropped_secondary_unresolved: 6,
  pairs_dropped_degenerate_idx: 5,
  pairs_dropped_same_relation_alias: 3,
  pairs_dropped_duplicate_relation: 2,
  pairs_with_orbit: 20,
  pairs_with_inclination: 16,
  pairs_inner_of_hierarchy: 19,
};

function fieldAt(recordOffset: number): string {
  const fields = Object.entries(RECORD_LAYOUT).map(([name, { offset }]) => [name, offset] as const);
  return fields.reduce((best, entry) =>
    entry[1] <= recordOffset && entry[1] > best[1] ? entry : best)[0];
}

function describeFirstDifference(actual: Uint8Array, golden: Uint8Array): string | null {
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
  let encoded: RuntimeBinaries;
  beforeAll(() => {
    encoded = encodeRuntimeBinaries(
      MULTIPLES_TSV.parse(readFileSync(FIXTURE_MULTIPLES, 'utf8')),
      parseCatalogRowIndexMap(readFileSync(FIXTURE_ROW_INDEX_MAP, 'utf8')),
    );
  });

  it('the fixture exercises every count', () => {
    expect(encoded.counts).toEqual(EXPECTED_COUNTS);
    for (const count of Object.values(EXPECTED_COUNTS)) expect(count).toBeGreaterThan(0);
  });

  it('the encoder reproduces the committed golden byte for byte', () => {
    if (process.env[UPDATE_ENV_VAR] === '1') writeFileSync(GOLDEN, encoded.bytes);
    expect(
      existsSync(GOLDEN),
      `${GOLDEN} missing; write it with ${UPDATE_COMMAND}`,
    ).toBe(true);
    const difference = describeFirstDifference(encoded.bytes, readFileSync(GOLDEN));
    expect(
      difference,
      `re-baseline with ${UPDATE_COMMAND} only when the change is meant to alter binaries.bin`,
    ).toBeNull();
  });

  it('the fixture map was built from the fixture multiples.tsv', () => {
    const sidecar = parseCatalogRowIndexMap(readFileSync(FIXTURE_ROW_INDEX_MAP, 'utf8'));
    expect(sidecar.multiplesSha1).toBe(hashBytes(readFileSync(FIXTURE_MULTIPLES)));
  });

  it('the loader parses the golden', () => {
    const golden = readFileSync(GOLDEN);
    const buf = golden.buffer.slice(golden.byteOffset, golden.byteOffset + golden.byteLength);
    expect(parseBinaries(buf).relations.length).toBe(EXPECTED_COUNTS.pairs_emitted);
  });
});
