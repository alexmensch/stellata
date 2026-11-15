// A FITS reply's first binary table as text cells: exact doubles and float32s, integers, strings, nulls. See README.md#fits-replies.

import { formatRepr } from '../../util/round-pure';

const BLOCK = 2880;
const CARD = 80;

export type FitsTable =
  | { readonly kind: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly (string | null)[])[] }
  /** A complete file with no table: VizieR's ASU answers a query that matched no row this way. */
  | { readonly kind: 'no-table' }
  /** Cut short: the server stopped mid-reply, which a retry can change. */
  | { readonly kind: 'incomplete'; readonly reason: string };

type Header = ReadonlyMap<string, string>;

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

/** The header starting at `at` and the offset just past its last block, or null when the bytes end before that block does. */
function readHeader(bytes: Uint8Array, at: number): { readonly header: Header; readonly end: number } | null {
  const header = new Map<string, string>();
  for (let card = at; card + CARD <= bytes.length; card += CARD) {
    const text = ascii(bytes.subarray(card, card + CARD));
    const key = text.slice(0, 8).trimEnd();
    if (key === 'END') {
      const end = Math.ceil((card + CARD) / BLOCK) * BLOCK;
      return end > bytes.length ? null : { header, end };
    }
    if (text.slice(8, 10) === '= ' && !header.has(key)) header.set(key, cardValue(text.slice(10)));
  }
  return null;
}

/** A card's value: a quoted string with `''` unescaped and trailing blanks dropped, or the token before any `/` comment. */
function cardValue(field: string): string {
  const quoted = /^\s*'((?:[^']|'')*)'/.exec(field);
  if (quoted) return quoted[1].replace(/''/g, '\'').trimEnd();
  return field.split('/')[0].trim();
}

function integerCard(header: Header, key: string): number {
  const value = header.get(key);
  if (value === undefined || !/^[+-]?\d+$/.test(value)) throw new Error(`FITS header: ${key} is ${value === undefined ? 'missing' : `"${value}"`}, not an integer`);
  return Number(value);
}

interface Field {
  readonly name: string;
  readonly width: number;
  readonly read: (view: DataView, at: number) => string | null;
}

const BLANK_ENDS = /^[\0 ]+|[\0 ]+$/g;

/** One TFORM's reader; an array, a bit field or a heap descriptor is refused, since no pull asks for one. */
function field(header: Header, n: number): Field {
  const name = header.get(`TTYPE${n}`);
  const form = header.get(`TFORM${n}`);
  if (name === undefined || form === undefined) throw new Error(`FITS header: column ${n} has no TTYPE or TFORM`);
  for (const scaling of [`TSCAL${n}`, `TZERO${n}`]) {
    const value = header.get(scaling);
    if (value !== undefined && Number(value) !== (scaling.startsWith('TSCAL') ? 1 : 0)) throw new Error(`FITS column ${name}: ${scaling} = ${value} is not read`);
  }
  const parsed = /^(\d*)([A-Z])$/.exec(form);
  if (!parsed) throw new Error(`FITS column ${name}: TFORM "${form}" is not read`);
  const repeat = parsed[1] === '' ? 1 : Number(parsed[1]);
  const type = parsed[2];
  if (type === 'A') {
    return { name, width: repeat, read: (view, at) => ascii(new Uint8Array(view.buffer, view.byteOffset + at, repeat)).replace(BLANK_ENDS, '') || null };
  }
  if (repeat !== 1) throw new Error(`FITS column ${name}: TFORM "${form}" is an array`);
  const tnull = header.get(`TNULL${n}`);
  const isNull = (value: bigint | number): boolean => tnull !== undefined && BigInt(value) === BigInt(tnull);
  const integer = (width: number, get: (view: DataView, at: number) => bigint | number): Field =>
    ({ name, width, read: (view, at) => { const v = get(view, at); return isNull(v) ? null : String(v); } });
  switch (type) {
    case 'L': return { name, width: 1, read: (view, at) => ({ 84: 'true', 70: 'false' } as Record<number, string>)[view.getUint8(at)] ?? null };
    case 'B': return integer(1, (view, at) => view.getUint8(at));
    case 'I': return integer(2, (view, at) => view.getInt16(at));
    case 'J': return integer(4, (view, at) => view.getInt32(at));
    case 'K': return integer(8, (view, at) => view.getBigInt64(at));
    case 'E': return { name, width: 4, read: (view, at) => { const v = view.getFloat32(at); return Number.isNaN(v) ? null : formatRepr(v, 'float32'); } };
    case 'D': return { name, width: 8, read: (view, at) => { const v = view.getFloat64(at); return Number.isNaN(v) ? null : formatRepr(v); } };
    default: throw new Error(`FITS column ${name}: TFORM "${form}" is not read`);
  }
}

/** The first BINTABLE after the primary HDU; a header or table cut short is `incomplete`, an unreadable structure throws. */
export function readFitsTable(bytes: Uint8Array): FitsTable {
  const primary = readHeader(bytes, 0);
  if (primary === null) return { kind: 'incomplete', reason: `${bytes.length} bytes end inside the primary header` };
  if (primary.header.get('SIMPLE') !== 'T') throw new Error('not a FITS file: SIMPLE is not T');
  if (integerCard(primary.header, 'NAXIS') !== 0) throw new Error('FITS primary HDU carries an image; only a table is read');
  if (primary.end >= bytes.length) return { kind: 'no-table' };

  const extension = readHeader(bytes, primary.end);
  if (extension === null) return { kind: 'incomplete', reason: `${bytes.length} bytes end inside the table header` };
  const { header } = extension;
  if (header.get('XTENSION') !== 'BINTABLE') throw new Error(`FITS extension is ${header.get('XTENSION') ?? 'untyped'}, not BINTABLE`);
  if (integerCard(header, 'PCOUNT') !== 0) throw new Error('FITS table has a heap; variable-length columns are not read');

  const rowBytes = integerCard(header, 'NAXIS1');
  const rowCount = integerCard(header, 'NAXIS2');
  const fields = Array.from({ length: integerCard(header, 'TFIELDS') }, (_, i) => field(header, i + 1));
  const width = fields.reduce((sum, f) => sum + f.width, 0);
  if (width !== rowBytes) throw new Error(`FITS table: columns span ${width} bytes, NAXIS1 says ${rowBytes}`);
  const dataEnd = extension.end + rowBytes * rowCount;
  if (dataEnd > bytes.length) return { kind: 'incomplete', reason: `${bytes.length} bytes end inside ${rowCount} rows of ${rowBytes} bytes` };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows: (string | null)[][] = [];
  for (let r = 0, at = extension.end; r < rowCount; r++) {
    const row: (string | null)[] = [];
    for (const f of fields) {
      row.push(f.read(view, at));
      at += f.width;
    }
    rows.push(row);
  }
  return { kind: 'table', columns: fields.map((f) => f.name), rows };
}
