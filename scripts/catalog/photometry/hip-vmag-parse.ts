// Printed Johnson V per HIP from the I/239/hip_main slice. See README.md.

import { dataRows, parseFloatOrNull, parseIntOrNull } from '../parse/corpus-tsv';

const HIP_VMAG_COLUMNS = ['hip', 'vmag'] as const;

/** `data/hipparcos/hip_main_vmag.tsv` → HIP → printed Johnson V.
 *
 *  Two consumers with the same need for a V that no Gaia photometry produced:
 *  the V cascade's bright tier, and the classic-ID overlay's binding gate,
 *  where a saturated star's mis-bound source has a G well below the star's
 *  catalogued V. Both key it by HIP rather than through a driver row, which is
 *  what lets it outlive AT-HYG. */
export function parseHipVmagTsv(text: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const { cells, idx } of dataRows(
    text, HIP_VMAG_COLUMNS, 'hip_main_vmag.tsv', 'Re-run `pnpm run refresh:hip-vmag`.',
  )) {
    const hip = parseIntOrNull(cells[idx.hip]);
    const vmag = parseFloatOrNull(cells[idx.vmag]);
    if (hip === null || hip <= 0 || vmag === null) continue;
    if (!out.has(hip)) out.set(hip, vmag);
  }
  return out;
}
