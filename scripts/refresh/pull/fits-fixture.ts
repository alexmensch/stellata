// Test support: a FITS binary table written from typed cells, as an archive answers one. See README.md#files.

const BLOCK = 2880;

export type FitsCell = string | number | bigint | boolean | null;

export interface FitsColumn {
  readonly name: string;
  /** `nA`, `L`, `B`, `I`, `J`, `K`, `E` or `D`. */
  readonly form: string;
  readonly tnull?: number;
  /** A display format, `Fw.d`. */
  readonly tdisp?: string;
}

const card = (key: string, value: string): string => `${key.padEnd(8)}= ${value}`.padEnd(80);
const text = (value: string): string => `'${value.replace(/'/g, '\'\'').padEnd(8)}'`;

function header(cards: readonly string[]): Uint8Array {
  const body = [...cards, 'END'.padEnd(80)].join('');
  return Uint8Array.from(body.padEnd(Math.ceil(body.length / BLOCK) * BLOCK), (c) => c.charCodeAt(0));
}

const WIDTH: Readonly<Record<string, number>> = { L: 1, B: 1, I: 2, J: 4, K: 8, E: 4, D: 8 };

const widthOf = (form: string): number => (form.endsWith('A') ? Number(form.slice(0, -1) || 1) : WIDTH[form]);

function writeCell(view: DataView, at: number, column: FitsColumn, cell: FitsCell): void {
  const { form } = column;
  if (form.endsWith('A')) {
    const value = String(cell ?? '');
    for (let i = 0; i < widthOf(form); i++) view.setUint8(at + i, i < value.length ? value.charCodeAt(i) : 0x20);
    return;
  }
  const value = cell ?? (form === 'E' || form === 'D' ? Number.NaN : column.tnull ?? 0);
  switch (form) {
    case 'L': view.setUint8(at, cell === null ? 0 : value ? 0x54 : 0x46); return;
    case 'B': view.setUint8(at, Number(value)); return;
    case 'I': view.setInt16(at, Number(value)); return;
    case 'J': view.setInt32(at, Number(value)); return;
    case 'K': view.setBigInt64(at, BigInt(value)); return;
    case 'E': view.setFloat32(at, Number(value)); return;
    case 'D': view.setFloat64(at, Number(value)); return;
    default: throw new Error(`fits-fixture: TFORM ${form} is not written`);
  }
}

/** A primary HDU and, unless `columns` is null, one BINTABLE of `rows`. */
export function fitsBytes(columns: readonly FitsColumn[] | null, rows: readonly (readonly FitsCell[])[] = []): Uint8Array {
  const primary = header([card('SIMPLE', 'T'.padStart(20)), card('BITPIX', '8'.padStart(20)), card('NAXIS', '0'.padStart(20)), card('EXTEND', 'T'.padStart(20))]);
  if (columns === null) return primary;
  const rowBytes = columns.reduce((sum, c) => sum + widthOf(c.form), 0);
  const ext = header([
    card('XTENSION', text('BINTABLE')), card('BITPIX', '8'.padStart(20)), card('NAXIS', '2'.padStart(20)),
    card('NAXIS1', String(rowBytes).padStart(20)), card('NAXIS2', String(rows.length).padStart(20)),
    card('PCOUNT', '0'.padStart(20)), card('GCOUNT', '1'.padStart(20)), card('TFIELDS', String(columns.length).padStart(20)),
    ...columns.flatMap((c, i) => [
      card(`TFORM${i + 1}`, text(c.form)), card(`TTYPE${i + 1}`, text(c.name)),
      ...(c.tnull === undefined ? [] : [card(`TNULL${i + 1}`, String(c.tnull).padStart(20))]),
      ...(c.tdisp === undefined ? [] : [card(`TDISP${i + 1}`, text(c.tdisp))]),
    ]),
  ]);
  const data = new Uint8Array(Math.ceil((rowBytes * rows.length) / BLOCK) * BLOCK);
  const view = new DataView(data.buffer);
  rows.forEach((row, r) => {
    let at = r * rowBytes;
    columns.forEach((c, i) => {
      writeCell(view, at, c, row[i]);
      at += widthOf(c.form);
    });
  });
  const out = new Uint8Array(primary.length + ext.length + data.length);
  out.set(primary);
  out.set(ext, primary.length);
  out.set(data, primary.length + ext.length);
  return out;
}
