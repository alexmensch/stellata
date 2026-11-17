// Every identity-bound record's shipped V against its printed Hipparcos V. See README.md#identity-bound-brightness.
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_MANIFEST_FILENAME } from '../../../src/catalog-format/record/catalog-pure';
import { distanceModulus } from '../../../src/astro-core/perceptual-magnitude';
import { distancePc, loadCatalog, lookupByHip } from '../catalog-lookup';
import { MEMBERSHIP_IDENTITY, MEMBERSHIP_STAGE_LINES } from '../lineage/stage-lineage-source';
import { lineageLineCode, lineageLineKey } from '../lineage/lineage-row-pure';
import { HIP_PHOTOMETRY } from '../photometry/hip-photometry-source';
import { publicFile } from '../../util/paths';

const IDENTIFIED = /^membership\.(addition-)?binding\.identified\./;
const READY = existsSync(publicFile(CATALOG_MANIFEST_FILENAME)) && existsSync(MEMBERSHIP_STAGE_LINES.file);

/** [HIP, printed V, shipped V or null where the HIP ships no record], to 0.01 mag. */
type Row = [number, string, string | null];

describe.skipIf(!READY)('identity-bound records', () => {
  let rows: Row[];

  beforeAll(async () => {
    const keys = new Set([...MEMBERSHIP_STAGE_LINES.read()]
      .filter((line) => IDENTIFIED.test(lineageLineCode(line)))
      .map(lineageLineKey));
    const hips = [...MEMBERSHIP_IDENTITY.read()].filter((r) => keys.has(r.key)).map((r) => Number(r.hip));
    const printed = HIP_PHOTOMETRY.read().vmag;
    const catalog = await loadCatalog();
    rows = hips.sort((a, b) => a - b).map((hip): Row => {
      const record = lookupByHip(catalog, hip);
      const shipped = record === null ? null : record.absmag + distanceModulus(distancePc(record));
      return [hip, printed.get(hip)!.value.toFixed(2), shipped === null ? null : shipped.toFixed(2)];
    });
  }, 180_000);

  // HIP 77442 is R CrB, caught by Gaia in its minimum; HIP 99527 is FG Sge, fading;
  // HIP 92207 is parked, so it ships no record.
  it('ship Gaia\'s V, not the printed blend, each pinned', () => {
    expect(rows).toEqual([
      [3843, '8.53', '10.10'],
      [16742, '8.67', '10.30'],
      [17642, '10.23', '10.98'],
      [20560, '9.33', '10.49'],
      [25763, '7.36', '9.31'],
      [26220, '4.98', '6.58'],
      [29899, '9.76', '11.08'],
      [31781, '8.45', '9.59'],
      [33543, '7.62', '9.44'],
      [34356, '7.53', '7.46'],
      [34922, '4.42', '7.62'],
      [35034, '7.60', '9.84'],
      [44542, '6.81', '8.76'],
      [45789, '9.30', '11.29'],
      [65182, '11.71', '13.41'],
      [69401, '7.78', '9.77'],
      [72589, '8.28', '9.62'],
      [77442, '5.89', '9.29'],
      [83042, '9.77', '11.15'],
      [91635, '6.91', '8.79'],
      [92207, '10.00', null],
      [92400, '11.29', '12.22'],
      [93449, '11.57', '14.58'],
      [95676, '9.53', '12.82'],
      [99527, '9.24', '19.68'],
      [103571, '5.24', '7.31'],
      [104833, '8.12', '9.43'],
      [106290, '11.33', '12.98'],
      [115983, '9.58', '10.91'],
      [116016, '8.72', '9.89'],
    ]);
  });
});
