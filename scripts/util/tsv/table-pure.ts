// The one TSV header walk and cell parser set: rows typed by their column
// names, with an empty cell and a malformed one kept apart. See README.md.

export interface TableSpec<C extends string> {
  /** Repo-relative path; also the label every parse error names. */
  readonly file: string;
  readonly columns: readonly C[];
  /** Columns a header may omit; an omitted one reads as empty in every row. */
  readonly optional?: readonly C[];
  /** What to run when the file is wrong: its refresh or build target. */
  readonly hint: string;
  /** Header must equal `columns` byte for byte and every row carry exactly
   *  that many cells: the contract for a file this repo writes itself. */
  readonly exact?: boolean;
  readonly comments?: true;
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d+$/;

/** Trimmed, or null when the cell is empty. */
export function textCell(raw: string | undefined): string | null {
  const t = (raw ?? '').trim();
  return t === '' ? null : t;
}

/** Null when empty; throws on a non-empty cell that is not a finite decimal. */
export function floatCell(raw: string | undefined): number | null {
  const t = textCell(raw);
  if (t === null) return null;
  if (!DECIMAL.test(t)) throw new Error(`"${t}" is not a decimal number`);
  return Number(t);
}

/** Null when empty; throws on a non-empty cell that is not an integer. */
export function intCell(raw: string | undefined): number | null {
  const t = textCell(raw);
  if (t === null) return null;
  if (!INTEGER.test(t)) throw new Error(`"${t}" is not an integer`);
  return safeInteger(t);
}

function safeInteger(t: string): number {
  const n = Number(t);
  if (!Number.isSafeInteger(n)) throw new Error(`"${t}" is past the safe integer range`);
  return n;
}

const ID = /^(0|[1-9]\d*)$/;

export function idCell(raw: string | undefined): number | null {
  const t = raw ?? '';
  if (t === '') return null;
  if (!ID.test(t)) throw new Error(`"${t}" is not an identifier`);
  return safeInteger(t);
}

export function idListCell(raw: string | undefined, separator: string): number[] {
  const t = raw ?? '';
  if (t === '') return [];
  return t.split(separator).map((v) => {
    const n = idCell(v);
    if (n === null) throw new Error(`"${t}" has an empty element`);
    return n;
  });
}

const SOURCE_ID = /^\d+$/;

export function sourceIdCell(raw: string | undefined): string | null {
  const t = textCell(raw);
  if (t === null) return null;
  if (!SOURCE_ID.test(t)) throw new Error(`"${t}" is not a source_id`);
  return t;
}

/** Absent (null or empty) first, then by value. */
export function compareSourceIds(a: string | null, b: string | null): number {
  const x = a || null;
  const y = b || null;
  if (x === y) return 0;
  if (x === null) return -1;
  if (y === null) return 1;
  const bx = BigInt(x);
  const by = BigInt(y);
  return bx < by ? -1 : bx > by ? 1 : 0;
}

function present<T>(v: T | null): T {
  if (v === null) throw new Error('is empty');
  return v;
}

export function oneOfCell<T extends string>(raw: string | undefined, allowed: readonly T[]): T {
  const t = raw ?? '';
  if (!(allowed as readonly string[]).includes(t)) {
    throw new Error(`"${t}" is not one of ${allowed.map((a) => a || '(empty)').join(' | ')}`);
  }
  return t as T;
}

/** One data row. Every accessor names the file, line and column on a bad cell. */
export class TableRow<C extends string> {
  constructor(
    private readonly spec: TableSpec<C>,
    private readonly idx: Readonly<Record<C, number>>,
    private readonly values: readonly string[],
    readonly line: number,
    readonly rawLine: string,
  ) {}

  /** Whether the header carries the column — false only for an omitted
   *  optional one. */
  has(c: C): boolean {
    return this.idx[c] >= 0;
  }

  /** The cell as written, '' when the row stops short of it. */
  raw(c: C): string {
    return this.values[this.idx[c]] ?? '';
  }

  cells(): Readonly<Record<C, string>> {
    const columns = [...this.spec.columns, ...(this.spec.optional ?? [])];
    return Object.fromEntries(columns.map((c) => [c, this.raw(c)])) as Record<C, string>;
  }

  text(c: C): string | null {
    return textCell(this.raw(c));
  }

  float(c: C): number | null {
    return this.cell(c, floatCell);
  }

  int(c: C): number | null {
    return this.cell(c, intCell);
  }

  id(c: C): number | null {
    return this.cell(c, idCell);
  }

  requiredId(c: C): number {
    return this.cell(c, (raw) => present(idCell(raw)));
  }

  idList(c: C, separator: string): number[] {
    return this.cell(c, (raw) => idListCell(raw, separator));
  }

  sourceId(c: C): string | null {
    return this.cell(c, sourceIdCell);
  }

  requiredSourceId(c: C): string {
    return this.cell(c, (raw) => present(sourceIdCell(raw)));
  }

  oneOf<T extends string>(c: C, allowed: readonly T[]): T {
    return this.cell(c, (raw) => oneOfCell(raw, allowed));
  }

  fail(message: string): never {
    throw new Error(`${this.spec.file}:${this.line}: ${message}. ${this.spec.hint}`);
  }

  /** A hand-curated row missing either cell of the pair it exists to state:
   *  refused, since skipping it would do nothing in silence. */
  failIncompletePair(a: C, b: C): never {
    return this.fail(
      `states no ${a} / ${b} pair. Comment the line with \`#\` or complete it — a `
        + 'curated row skipped in silence is the fault this file guards against',
    );
  }

  private cell<T>(c: C, parse: (raw: string) => T): T {
    try {
      return parse(this.raw(c));
    } catch (e) {
      return this.fail(`${c}: ${(e as Error).message}`);
    }
  }
}

/** Throws on a missing column and on an empty or headerless file, so a
 *  truncated or unsmudged input never reads as a zero-row table. */
function headerIndex<C extends string>(spec: TableSpec<C>, headerLine: string): Record<C, number> {
  if (spec.exact) {
    if (headerLine !== spec.columns.join('\t')) {
      throw new Error(`${spec.file}: header mismatch: got ${headerLine}. ${spec.hint}`);
    }
    return Object.fromEntries(spec.columns.map((c, i) => [c, i])) as Record<C, number>;
  }
  const header = headerLine.split('\t').map((h) => h.trim());
  const repeated = [...spec.columns, ...(spec.optional ?? [])]
    .filter((c) => header.indexOf(c) !== header.lastIndexOf(c));
  if (repeated.length) {
    throw new Error(`${spec.file} header names ${repeated.join(', ')} more than once. ${spec.hint}`);
  }
  const idx = Object.create(null) as Record<C, number>;
  for (const c of spec.optional ?? []) idx[c] = header.indexOf(c);
  const missing = spec.columns.filter((c) => (idx[c] = header.indexOf(c)) < 0);
  if (missing.length) {
    throw new Error(`${spec.file} is missing required columns: ${missing.join(', ')}. ${spec.hint}`);
  }
  return idx;
}

const COMMENT = /^\s*#/;

/** Every line fed counts toward the line number an error names, so it must
 *  be fed every physical line. */
function lineParser<C extends string>(spec: TableSpec<C>): {
  parse(line: string): TableRow<C> | null;
  finish(): void;
} {
  let idx: Record<C, number> | null = null;
  let lineNo = 0;
  return {
    parse(line) {
      lineNo++;
      if (spec.exact && line.endsWith('\r')) {
        throw new Error(`${spec.file}:${lineNo}: CR line ending. ${spec.hint}`);
      }
      if (spec.comments && COMMENT.test(line)) return null;
      if (idx === null) {
        if (!spec.exact && line.trim() === '') return null;
        idx = headerIndex(spec, line);
        return null;
      }
      if (spec.exact && line === '') throw new Error(`${spec.file}:${lineNo}: blank line. ${spec.hint}`);
      if (!spec.exact && line.trim() === '') return null;
      const cells = line.split('\t');
      if (spec.exact && cells.length !== spec.columns.length) {
        throw new Error(
          `${spec.file}:${lineNo}: row has ${cells.length} cells, expected ${spec.columns.length}. ${spec.hint}`,
        );
      }
      return new TableRow(spec, idx, cells, lineNo, line);
    },
    finish() {
      if (idx === null) {
        throw new Error(`${spec.file} has no header row: expected columns ${spec.columns.join(', ')}. ${spec.hint}`);
      }
    },
  };
}

export interface TableLineReader {
  (line: string): void;
  finish(): void;
}

/** Fed one line at a time, for a table too large to hold as one string. */
export function tableLineReader<C extends string>(
  spec: TableSpec<C>,
  onRow: (row: TableRow<C>) => void,
): TableLineReader {
  const { parse, finish } = lineParser(spec);
  return Object.assign((line: string) => {
    const row = parse(line);
    if (row !== null) onRow(row);
  }, { finish });
}

/** Every data row of `text`, walked rather than split: several inputs run to
 *  tens of megabytes. */
export function* readTable<C extends string>(
  spec: TableSpec<C>,
  text: string,
): Generator<TableRow<C>> {
  const { parse, finish } = lineParser(spec);
  for (let start = 0; start < text.length;) {
    const end = text.indexOf('\n', start);
    if (end === -1 && spec.exact) throw new Error(`${spec.file}: missing final newline. ${spec.hint}`);
    const stop = end === -1 ? text.length : end;
    const line = text.slice(start, stop);
    const row = parse(!spec.exact && line.endsWith('\r') ? line.slice(0, -1) : line);
    if (row !== null) yield row;
    start = stop + 1;
  }
  finish();
}
