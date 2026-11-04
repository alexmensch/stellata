// `pnpm run build:vaidman-table [--pdf <path>]`: the paper PDF → the committed reference table. See README.md.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { EXPECTED_A1_ROWS, EXPECTED_A2_ROWS, attachGaiaSourceIds, extractTables } from './build-vaidman-table-pure';
import { VAIDMAN_OUTPUTS } from './vaidman-outputs';
import { VAIDMAN_2025_PDF } from './vaidman-paper-source';
import { VAIDMAN_SUPERGIANTS } from './vaidman-tsv';

function paperPdf(): string {
  const i = process.argv.indexOf('--pdf');
  if (i < 0 || !process.argv[i + 1]) return VAIDMAN_2025_PDF.read();
  const pdf = resolve(process.argv[i + 1]);
  if (!existsSync(pdf)) throw new Error(`build-vaidman-table: no PDF at ${pdf}`);
  return pdf;
}

function main(): void {
  const pdf = paperPdf();
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
