// A stage's lineage lines held in a temporary file while another stage's are in memory. See README.md#storage-and-cost.

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ENCODE_BATCH, LINEAGE_COLUMNS, lineageLines, utf8Batch, type LineageLine } from './lineage-row-pure';

export class LineSpill {
  readonly dir = mkdtempSync(join(tmpdir(), 'stellata-lineage-'));
  private readonly path = join(this.dir, 'lines.tsv');
  private pending: LineageLine[] = [];
  private read = false;

  constructor(private readonly batch = ENCODE_BATCH) {
    writeFileSync(this.path, utf8Batch([LINEAGE_COLUMNS.join('\t')]));
  }

  push(line: LineageLine): void {
    if (this.read) throw new Error(`lineage spill ${this.path}: a line pushed after its lines were read`);
    this.pending.push(line);
    if (this.pending.length === this.batch) this.flush();
  }

  /** Every pushed line, in push order. The spill takes no more lines after it. */
  lines(): LineageLine[] {
    this.flush();
    this.read = true;
    return [...lineageLines(readFileSync(this.path), this.path)];
  }

  /** Deletes the file; safe to call more than once, and after a failed walk. */
  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  private flush(): void {
    if (this.pending.length > 0) appendFileSync(this.path, utf8Batch(this.pending));
    this.pending = [];
  }
}
