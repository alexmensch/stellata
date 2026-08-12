// Parsers for data/iau-wgsn/NEC.csv + wgsnFaints.csv into one row shape.
// Comma-CSV with quoted cells ("C5,5" spectral types), unlike every TSV
// in the pipeline; `_`, `~` and a literal `null` are upstream null spellings.

export interface WgsnRow {
  /** NEC serial or WGSN-ID — provenance only, never a key. */
  id: string;
  /** Raw Name cell; multi-name cells split downstream. Null when unnamed. */
  name: string | null;
  hip: number | null;
  hr: number | null;
  /** HD number with any trailing component letter separated off. */
  hd: number | null;
  hdComponent: string | null;
  /** Raw `Bayer/other` cell for the normaliser. */
  bayerOther: string | null;
  /** The row's own constellation column (nominative, sometimes
   *  space-collapsed upstream: `TriangulumAustrale`). */
  constellation: string | null;
  vmag: number | null;
  /** wgsnFaints only — the WDS designation incl. component suffix. */
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

function strCell(cells: string[], i: number): string | null {
  const s = (cells[i] ?? '').trim();
  return s === '' || s === '_' || s === '~' || s === 'null' ? null : s;
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

const NEC_HEADER = 'NEC,Name,HIP,RA2000,DE2000,Vmag,Gmag,type,HR,HD,Bayer/other,constellation,distance from Sun/ ly,B-V color,VmagMax,VmagMin';
const FAINTS_HEADER = 'WGSN-ID,Name,HIP,RA2000,DE2000,Vmag,type,HR,HD,Bayer/other,constellation,distance from Sun/ ly,B-V color,VmagMax,VmagMin,WDS';

function parseHipCell(cells: string[], i: number): number | null {
  const s = strCell(cells, i);
  if (s === null) return null;
  const m = s.match(/^HIP\s+(\d+)$/);
  return m ? Number(m[1]) : null;
}

function parseHdCell(
  cells: string[],
  i: number,
): { hd: number | null; component: string | null } {
  const s = strCell(cells, i);
  if (s === null) return { hd: null, component: null };
  const m = s.match(/^(\d+)([A-Za-z]?)$/);
  if (!m) return { hd: null, component: null };
  return { hd: Number(m[1]), component: m[2] || null };
}

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
  const rows: WgsnRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const { hd, component } = parseHdCell(cells, col.hd);
    rows.push({
      id: (cells[0] ?? '').trim(),
      name: strCell(cells, col.name),
      hip: parseHipCell(cells, col.hip),
      hr: intCell(cells, col.hr),
      hd,
      hdComponent: component,
      bayerOther: strCell(cells, col.bayer),
      constellation: strCell(cells, col.con),
      vmag: floatCell(cells, col.vmag),
      wds: col.wds !== undefined ? strCell(cells, col.wds) : null,
      source,
    });
  }
  return rows;
}

export function parseNecCsv(text: string): WgsnRow[] {
  return parseFile(text, NEC_HEADER, 'nec', {
    name: 1, hip: 2, vmag: 5, hr: 8, hd: 9, bayer: 10, con: 11,
  });
}

export function parseWgsnFaintsCsv(text: string): WgsnRow[] {
  return parseFile(text, FAINTS_HEADER, 'faints', {
    name: 1, hip: 2, vmag: 5, hr: 7, hd: 8, bayer: 9, con: 10, wds: 15,
  });
}
