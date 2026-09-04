// Extraction and resolution for `<file>.md § <Heading>` doc pointers — the
// codebase's wiki links. Pure so the scanner's matcher can be asserted on
// synthetic input rather than only on the tree.
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface DocPointer {
  citedPath: string;
  section: string;
  line: number;
}

// Subsystem READMEs are cited from docs/ by their src/client-relative path
// alone (`hdr/exposure/README.md § …`), which is the house shorthand.
const SEARCH_ROOTS = ['src/client'];

// The grammar, and why a leading `~` or `/` disqualifies a path and a period
// before a digit does not: tests/README.md § Doc-pointer resolution.
const POINTER =
  /(?<![~/.\w])`?((?:\.{1,2}\/)*[\w@.-]+(?:\/[\w@.-]+)*\.md)`?\s+§\s+((?:[^.;:()`\n]|\.(?=\d))+)/g;

const COMMENT_LEADER = /^\s*(?:\/\/+|\/\*+|\*+\/|\*+|#+)\s?/;

/**
 * Word list a cited section and a real heading are compared through: the text
 * before any ` — ` or `:` subtitle, lowercased, emphasis and backticks
 * dropped, clause punctuation trimmed.
 */
export function titleWords(text: string): string[] {
  return text
    .split(/\s+[—–]\s+|:/)[0]
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/^[,;("'[]+|[,;."'“”)\]]+$/g, ''))
    .filter((w) => w.length > 0);
}

/**
 * Every heading a pointer may legitimately name — `#` headings, bold leaders
 * and a Files roster's backticked module name. Which, and the strictness that
 * costs: tests/README.md § Doc-pointer resolution.
 */
export function sectionTitles(markdown: string): string[][] {
  const titles: string[][] = [];
  for (const line of markdown.split('\n')) {
    const atx = /^#{1,6}\s+(.*)$/.exec(line);
    if (atx) {
      titles.push(titleWords(atx[1]));
      continue;
    }
    const leader = /^\s*(?:(?:[-*+]|\d+\.)\s+)?(?:\*\*(.+?)(?:\*\*|$)|`([^`]+)`)/.exec(line);
    if (leader) titles.push(titleWords(leader[1] ?? leader[2]));
  }
  return titles.filter((t) => t.length > 0);
}

// `4.5`, `8.4.` and the possessive `§ 5's bright tier` all name section 5.
const SECTION_NUMBER = /^(\d+(?:\.\d+)*)(?:\.|'s)?$/;

function leadingNumber(words: string[]): string | null {
  return (words.length > 0 ? SECTION_NUMBER.exec(words[0])?.[1] : null) ?? null;
}

// One name is the other's opening, and stops at a word boundary rather than
// mid-word: `§ Time` must not resolve to `## Timescales`.
function prefixes(shorter: string, longer: string): boolean {
  return longer.startsWith(shorter) && !/[a-z0-9]/.test(longer.charAt(shorter.length));
}

function sharesPrefix(cited: string[], title: string[]): boolean {
  if (title.length === 0 || cited.length === 0) return false;
  const c = cited.join(' ');
  const t = title.join(' ');
  if (prefixes(c, t) || prefixes(t, c)) return true;
  // Two shared opening words are the guard's resolution — tests/README.md.
  const lead = Math.min(2, title.length, cited.length);
  return title.slice(0, lead).every((w, i) => cited[i] === w);
}

/**
 * A pointer resolves when its cited words and a heading share an opening;
 * under- and over-quoting are both normal. A numbered section's number is
 * its identity, cited with or without the title. See tests/README.md.
 */
export function citesSection(section: string, titles: string[][]): boolean {
  const cited = titleWords(section);
  if (cited.length === 0) return false;
  const citedNumber = leadingNumber(cited);
  return titles.some((title) => {
    const titleNumber = leadingNumber(title);
    if (citedNumber !== null) return citedNumber === titleNumber;
    if (sharesPrefix(cited, title)) return true;
    return titleNumber !== null && sharesPrefix(cited, title.slice(1));
  });
}

/**
 * Pointers are written root-relative and file-relative in the same folder, so
 * both readings are tried, referring directory first. A `../` chain that
 * climbs out of the repo resolves to nothing. See tests/README.md.
 */
export function resolveDocPath(citedPath: string, fromDir: string, root: string): string | null {
  const bases = [fromDir, root, ...SEARCH_ROOTS.map((r) => join(root, r))];
  const inRepo = (p: string): boolean => !relative(root, p).startsWith('..');
  return bases.map((base) => join(base, citedPath)).find((p) => inRepo(p) && existsSync(p)) ?? null;
}

/**
 * Comments wrap, and a section name wraps with them, so each line is joined
 * with its successor and the doubled reading dropped below. The wrap cases:
 * tests/README.md § Doc-pointer resolution.
 */
export function extractPointers(text: string): DocPointer[] {
  const lines = text.split('\n').map((line) => line.replace(COMMENT_LEADER, ''));
  const found: DocPointer[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const joint = lines[i].endsWith('/') ? '' : ' ';
    const window = `${lines[i]}${joint}${lines[i + 1] ?? ''}`;
    const continuation = i > 0 && lines[i - 1].endsWith('/');
    for (const m of window.matchAll(POINTER)) {
      if (continuation && m.index === 0) continue;
      const [, citedPath, section] = m;
      const trimmed = section.trim().replace(/\s+/g, ' ');
      // `§ <named section>` and `§ …` cite the syntax, they do not name one.
      if (/^[<…]/.test(trimmed)) continue;
      found.push({ citedPath, section: trimmed, line: i + 1 });
    }
  }
  // Adjacency is load-bearing: widen it and a stale pointer that happens to
  // be the opening of a valid one elsewhere in the file is silently dropped.
  return found.filter(
    (p, i) =>
      !found.some(
        (other, j) =>
          j !== i &&
          Math.abs(other.line - p.line) <= 1 &&
          other.citedPath === p.citedPath &&
          other.section.startsWith(p.section) &&
          (other.section.length > p.section.length || j > i),
      ),
  );
}
