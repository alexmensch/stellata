// `pnpm run build:vaidman-table [--pdf <path>]`: the paper PDF → the committed reference table. See README.md.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { EXPECTED_A1_ROWS, EXPECTED_A2_ROWS, attachGaiaSourceIds, extractTables } from './build-vaidman-table-pure';
import { VAIDMAN_OUTPUTS } from './vaidman-outputs';
import { VAIDMAN_SUPERGIANTS } from './vaidman-tsv';

function pdfArgument(): string {
  const i = process.argv.indexOf('--pdf');
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : resolve(REPO_ROOT, 'universe-11-00359.pdf');
}

function main(): void {
  const pdf = pdfArgument();
  if (!existsSync(pdf)) {
    throw new Error(
      `build-vaidman-table: PDF not found at ${pdf}. Drop the paper PDF (DOI 10.3390/universe11110359) at the repo `
        + 'root or pass --pdf <path>; remove it after the TSV is committed.',
    );
  }
  const { a1, a2 } = extractTables(execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }));
  console.log(`  Table A1 (EDSD_new): ${a1.length} rows (expect ${EXPECTED_A1_ROWS})`);
  console.log(`  Table A2 (BJ_old):   ${a2.length} rows (expect ${EXPECTED_A2_ROWS})`);
  if (a1.length !== EXPECTED_A1_ROWS || a2.length !== EXPECTED_A2_ROWS) {
    throw new Error(
      'build-vaidman-table: appendix row counts moved; the layout has changed or the parser missed rows. '
        + 'Inspect the pdftotext output before re-pinning.',
    );
  }
  const joined = attachGaiaSourceIds([...a1, ...a2]);
  if (joined.kind === 'missing') {
    throw new Error(
      `build-vaidman-table: ${joined.names.length} paper name(s) not in NAME_TO_GAIA_DR3: ${joined.names.join(', ')}. `
        + 'Resolve via SIMBAD per data/distance-validation/README.md and extend the mapping.',
    );
  }
  emitArtifacts({ outputs: VAIDMAN_OUTPUTS, files: { vaidman: VAIDMAN_SUPERGIANTS.serialize(joined.rows) } });
  console.log(`wrote ${VAIDMAN_SUPERGIANTS.file} (${joined.rows.length} rows)`);
}

runStep(main);
