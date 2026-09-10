// A TSL authoring trap: `toReadOnly()` narrows the node it is called on, so
// narrowing one a kernel assigns through breaks that kernel's pipeline on the
// device. /src/client/webgpu/tsl/README.md#storage-attributes.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isProductionTs, walkFiles } from '../scripts/util/walk-files';

const ROOT = resolve(__dirname, '..');

// The module that builds the write/read pair narrows its builder's result,
// which is a fresh node by the same argument.
const PAIR_BUILDER = 'src/client/webgpu/tsl/storage-attribute.ts';

const GUIDANCE =
  'narrows a storage node it may not solely own. Give the reader a node of '
  + 'its own — `storageWriteRead(() => storage(...))` '
  + '(/src/client/webgpu/tsl/README.md#storage-attributes).';

const NARROWS = /\.toReadOnly\s*\(\s*\)/g;
const OWN_RESULT = /\bstorage\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\.toReadOnly\s*\(\s*\)/g;

export function narrowsANodeItMayShare(src: string): boolean {
  return (src.match(NARROWS)?.length ?? 0) > (src.match(OWN_RESULT)?.length ?? 0);
}

describe('TSL storage-narrowing roster', () => {
  it('no module narrows a storage node another holder writes through', () => {
    const offenders = [...walkFiles(join(ROOT, 'src'), { include: isProductionTs })]
      .filter((p) => relative(ROOT, p) !== PAIR_BUILDER)
      .filter((p) => narrowsANodeItMayShare(readFileSync(p, 'utf8')))
      .map((p) => `${relative(ROOT, p)} ${GUIDANCE}`);
    expect(offenders).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('catches a narrowing applied to a node held elsewhere', () => {
    expect(narrowsANodeItMayShare('const n = storage(a, "uint", 2);\nconst r = n.toReadOnly();'))
      .toBe(true);
    expect(narrowsANodeItMayShare('this.node = this.counts.toReadOnly();')).toBe(true);
    expect(narrowsANodeItMayShare('const r = build().toReadOnly();')).toBe(true);
  });

  it('leaves a narrowing of the storage() call\'s own result alone', () => {
    expect(narrowsANodeItMayShare('const r = storage(a, "uint", 2).toReadOnly();')).toBe(false);
    expect(narrowsANodeItMayShare('storage(this.s, "float", this.s.count).toReadOnly();'))
      .toBe(false);
    expect(narrowsANodeItMayShare('storage(a, "uint", 2).toReadOnly();\nb.toReadOnly();'))
      .toBe(true);
  });
});
