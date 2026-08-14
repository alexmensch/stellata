// Parsers for data/iau-wgsn/NEC.csv + wgsnFaints.csv into one row shape.
// Comma-CSV with quoted cells ("C5,5" spectral types), unlike every TSV
// in the pipeline; `_`, `~`, `-` and a literal `null` all spell null.

export interface WgsnRow {
  /** NEC serial or WGSN-ID — provenance only, never a key. */
  id: string;
  /** Raw Name cell; multi-name cells split downstream. Null when unnamed. */
  name: string | null;
  /** HIP number with any trailing component letter separated off. */
  hip: number | null;
  hipComponent: string | null;
  hr: number | null;
  /** HD number with any trailing component letter separated off. */
  hd: number | null;
  hdComponent: string | null;
  /** Raw `Bayer/other` cell for the normaliser. */
  bayerOther: string | null;
  vmag: number | null;
  /** wgsnFaints only. Empty in every row of the 2025-05 release; the build
   *  pins that at zero so a refresh that starts populating it fails rather
   *  than silently withholding a component key. */
  wds: string | null;
  source: 'nec' | 'faints';
}

/** One CSV record: handles quoted cells with doubled-quote escapes. The
 *  files carry no embedded newlines, so line-splitting first is safe. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cell); cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

const NULL_SPELLINGS = new Set(['', '_', '~', '-', 'null']);

function strCell(cells: string[], i: number): string | null {
  const s = (cells[i] ?? '').trim();
  return NULL_SPELLINGS.has(s) ? null : s;
}

function intCell(cells: string[], i: number): number | null {
  const s = strCell(cells, i);
  if (s === null) return null;
  const v = Number(s);
  return Number.isInteger(v) && v > 0 ? v : null;
}

function floatCell(cells: string[], i: number): number | null {
  const s = strCell(cells, i);
  if (s === null) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

export const NEC_HEADER = 'NEC,Name,HIP,RA2000,DE2000,Vmag,Gmag,type,HR,HD,Bayer/other,constellation,distance from Sun/ ly,B-V color,VmagMax,VmagMin';
export const FAINTS_HEADER = 'WGSN-ID,Name,HIP,RA2000,DE2000,Vmag,type,HR,HD,Bayer/other,constellation,distance from Sun/ ly,B-V color,VmagMax,VmagMin,WDS';

interface KeyCell {
  value: number | null;
  component: string | null;
}

/** Both key columns inline a WDS component letter on close pairs — `HIP 518A`,
 *  `224782A`, `62264AB`. A shape neither this nor a null spelling covers is a
 *  silent key loss, so it fails the parse rather than nulling the row. */
function parseKeyCell(
  cells: string[],
  i: number,
  shape: RegExp,
  label: string,
  file: string,
): KeyCell {
  const s = strCell(cells, i);
  if (s === null) return { value: null, component: null };
  const m = s.match(shape);
  if (m === null) {
    throw new Error(
      `data/iau-wgsn/${file}: unparsed ${label} cell ${JSON.stringify(s)}.\n`
      + `Expected ${shape.source}, a component-letter form, or a null spelling `
      + `(${[...NULL_SPELLINGS].filter((n) => n !== '').join(' ')}).\n`
      + 'Add the shape to parseKeyCell once you have confirmed what it means.',
    );
  }
  return { value: Number(m[1]), component: m[2] ?? null };
}

const HIP_SHAPE = /^HIP\s+(\d+)([A-Za-z])?$/;
const HD_SHAPE = /^(\d+)([A-Za-z]{1,2})?$/;

function parseFile(
  text: string,
  expectedHeader: string,
  source: 'nec' | 'faints',
  col: Record<string, number>,
): WgsnRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines[0] !== expectedHeader) {
    throw new Error(
      `data/iau-wgsn/${source === 'nec' ? 'NEC' : 'wgsnFaints'}.csv header drifted from the frozen schema.\n`
      + `  expected: ${expectedHeader}\n  got:      ${lines[0]}\n`
      + 'Re-run scripts/refresh/refresh-iau-wgsn.py and review the upstream change.',
    );
  }
  const file = source === 'nec' ? 'NEC.csv' : 'wgsnFaints.csv';
  const rows: WgsnRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const hip = parseKeyCell(cells, col.hip, HIP_SHAPE, 'HIP', file);
    const hd = parseKeyCell(cells, col.hd, HD_SHAPE, 'HD', file);
    rows.push({
      id: (cells[0] ?? '').trim(),
      name: strCell(cells, col.name),
      hip: hip.value,
      hipComponent: hip.component,
      hr: intCell(cells, col.hr),
      hd: hd.value,
      hdComponent: hd.component,
      bayerOther: strCell(cells, col.bayer),
      vmag: floatCell(cells, col.vmag),
      wds: col.wds !== undefined ? strCell(cells, col.wds) : null,
      source,
    });
  }
  return rows;
}

export function parseNecCsv(text: string): WgsnRow[] {
  return parseFile(text, NEC_HEADER, 'nec', {
    name: 1, hip: 2, vmag: 5, hr: 8, hd: 9, bayer: 10,
  });
}

export function parseWgsnFaintsCsv(text: string): WgsnRow[] {
  return parseFile(text, FAINTS_HEADER, 'faints', {
    name: 1, hip: 2, vmag: 5, hr: 7, hd: 8, bayer: 9, wds: 15,
  });
}
