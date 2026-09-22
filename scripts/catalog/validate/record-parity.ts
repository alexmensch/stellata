// pnpm run validate:record-parity — sid-keyed parity between a baseline
// catalogue and the current build. README.md § Additive-mode record parity.

import { resolve } from 'node:path';
import { readCatalogBuffer, DEFAULT_CATALOG_MANIFEST } from '../catalog-lookup';
import { CATALOG_MANIFEST_FILENAME } from '../record/catalog-pure';
import { compareRecordParity, formatParityReport, parityHolds } from './record-parity-pure';

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

const baselineDir = argValue('baseline');
if (baselineDir === null) {
  console.error('usage: validate:record-parity --baseline=<dir> [--current=<dir>]');
  process.exit(2);
}
const currentDir = argValue('current');

const [baseline, current] = await Promise.all([
  readCatalogBuffer(resolve(baselineDir, CATALOG_MANIFEST_FILENAME)),
  readCatalogBuffer(
    currentDir === null
      ? DEFAULT_CATALOG_MANIFEST
      : resolve(currentDir, CATALOG_MANIFEST_FILENAME),
  ),
]);

const report = compareRecordParity(baseline, current);
console.log(formatParityReport(report));
if (!parityHolds(report)) {
  console.error('\nrecord parity FAILED — docs/catalog-driver.md § 8 additive mode');
  process.exit(1);
}
