// pnpm run validate:record-parity — sid-keyed parity between a baseline
// catalogue and the current build. README.md#additive-mode-record-parity.

import { resolve } from 'node:path';
import { readCatalogBuffer } from '../catalog-lookup';
import { CATALOG_MANIFEST_FILENAME } from '../../../src/catalog-format/record/catalog-pure';
import { compareRecordParity, formatParityReport, parityHolds } from './record-parity-pure';
import { publicFile } from '../../util/paths';

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

export async function main(): Promise<number> {
  const baselineDir = argValue('baseline');
  if (baselineDir === null) {
    console.error('usage: validate:record-parity --baseline=<dir> [--current=<dir>]');
    return 2;
  }
  const currentDir = argValue('current');

  const [baseline, current] = await Promise.all([
    readCatalogBuffer(resolve(baselineDir, CATALOG_MANIFEST_FILENAME)),
    readCatalogBuffer(
      currentDir === null
        ? publicFile(CATALOG_MANIFEST_FILENAME)
        : resolve(currentDir, CATALOG_MANIFEST_FILENAME),
    ),
  ]);

  const report = compareRecordParity(baseline, current);
  console.log(formatParityReport(report));
  if (!parityHolds(report)) {
    console.error('\nrecord parity FAILED — /docs/catalog-driver.md#8-gaia-dr-transitions--what-re-pulls-and-what-never-does additive mode');
    return 1;
  }
  return 0;
}
