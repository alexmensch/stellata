// Extraction and resolution for `<file>.md § <Heading>` doc pointers — the
// codebase's wiki links. Pure so the scanner's matcher can be asserted on
// synthetic input rather than only on the tree.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export interface DocPointer {
  citedPath: string;
  section: string;
  line: number;
}

const TOP_LEVEL_DIRS = ['src', 'scripts', 'data', 'tests', 'docs', 'research', 'public'];

// Subsystem READMEs are cited from docs/ by their src/client-relative path
// alone (`hdr/exposure/README.md § …`), which is the house shorthand.
const SEARCH_ROOTS = ['src/client'];

// `<file>.md § <Heading>`, the path optionally backticked. A leading `~` or
// `/` disqualifies it: `~/.claude/CLAUDE.md` is the user's global rules, not
// a file this repo can resolve. The section text runs to the first clause
// terminator, except that a period followed by a digit stays in, so a
// numbered section (`§ 4.5`) survives the cut.
const POINTER =
  /(?<![~/.\w])`?((?:\.{1,2}\/)*[\w@.-]+(?:\/[\w@.-]+)*\.md)`?\s+§\s+((?:[^.;:()`\n]|\.(?=\d))+)/g;

const COMMENT_LEADER = /^\s*(?:\/\/+|\/\*+|\*+\/|\*+|#+)\s?/;

/**
 * Word list a cited section and a real heading are compared through: the text
 * before any ` — ` or `:` subtitle, lowercased, emphasis and backticks
 * dropped, trailing clause punctuation trimmed off each word.
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
 * Every heading a pointer may legitimately name: ATX headings, the bold
 * leaders (`- **Anchor flux conservation.**`) the READMEs use for named
 * sub-topics, and a Files roster's backticked module name
 * (`- \`picker.ts\` — pure target resolver`), which is how a pointer names
 * one file's entry.
 */
export function sectionTitles(markdown: string): string[][] {
  const titles: string[][] = [];
  for (const line of markdown.split('\n')) {
    const atx = /^#{1,6}\s+(.*)$/.exec(line);
    if (atx) {
      titles.push(titleWords(atx[1]));
      continue;
    }
    // A bold leader wraps mid-phrase, closing `**` on the next line, so the
    // rest of the line stands in for the title — enough, since a subtitle
    // after ` — ` is dropped anyway.
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
  // A pointer routinely names a heading's opening words and carries straight
  // on in prose — `§ DR2→DR3 dry run, incl the residual` cites
  // `### 6.2 DR2→DR3 dry run (measured 2026-07-07)`. The first two words are
  // therefore the citation, which sets the guard's resolution: a rename that
  // leaves those two words alone reads as a truncated citation and passes.
  const lead = Math.min(2, title.length, cited.length);
  return title.slice(0, lead).every((w, i) => cited[i] === w);
}

/**
 * A pointer resolves when its cited words and a heading share a prefix long
 * enough to be a deliberate reference. Both under- and over-quoting are
 * normal: `§ Binary catalog format` names only the front of
 * `## Binary catalog format (public/catalog.bin + manifest)`, while a
 * greedy capture can trail extra words past the heading's end.
 *
 * A numbered section's number is its identity, cited either way round —
 * `§ 5 routes the GJ-keyed cohort here` gives the number and then runs
 * straight into prose, `§ DR2→DR3 dry run` gives the title and drops the
 * number the heading carries.
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
 * Pointers are written both root-relative (`src/client/foo/README.md`) and
 * file-relative (`./README.md`, `../companions/README.md`), often in the same
 * folder, so both readings are tried. The referring file's own directory wins
 * where it resolves — `data/textures/README.md` citing `src/README.md` means
 * the folder's own `src/`, not the repo's — then the repo root, which is how
 * `SCIENCE.md` and `AGENTS.md` are cited from anywhere.
 */
export function resolveDocPath(citedPath: string, fromDir: string, root: string): string | null {
  if (isAbsolute(citedPath)) return existsSync(citedPath) ? citedPath : null;
  const bases = [fromDir, root, ...SEARCH_ROOTS.map((r) => join(root, r))];
  return bases.map((base) => join(base, citedPath)).find((p) => existsSync(p)) ?? null;
}

/**
 * Comments wrap, and a section name wraps with them. Each line is stripped of
 * its comment leader and joined with its successor, so a pointer split across
 * two lines is seen whole; callers dedupe the doubled hits that produces.
 */
export function extractPointers(text: string): DocPointer[] {
  const lines = text.split('\n').map((line) => line.replace(COMMENT_LEADER, ''));
  const found: DocPointer[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    // A path wrapped at one of its own slashes rejoins with no space, or the
    // folder half is lost and the pointer reads as a bare `README.md`.
    const joint = lines[i].endsWith('/') ? '' : ' ';
    const window = `${lines[i]}${joint}${lines[i + 1] ?? ''}`;
    // A pointer whose path wrapped at a slash reads, one window later, as a
    // bare `README.md` starting the line. The previous window already has it
    // whole, folder half included.
    const continuation = i > 0 && lines[i - 1].endsWith('/');
    for (const m of window.matchAll(POINTER)) {
      if (continuation && m.index === 0) continue;
      const [, citedPath, section] = m;
      const trimmed = section.trim().replace(/\s+/g, ' ');
      // `§ <named section>` and `§ …` stand for a section rather than naming
      // one — the form docs use when citing the syntax itself.
      if (/^[<…]/.test(trimmed)) continue;
      found.push({ citedPath, section: trimmed, line: i + 1 });
    }
  }
  // The same pointer is seen twice — cut short by the end of its own line in
  // one window, whole in the next — so the shorter reading is dropped.
  return found.filter(
    (p, i) =>
      !found.some(
        (other, j) =>
          j !== i &&
          other.citedPath === p.citedPath &&
          other.section.startsWith(p.section) &&
          (other.section.length > p.section.length || j < i),
      ),
  );
}

export function readSectionTitles(path: string): string[][] {
  return sectionTitles(readFileSync(path, 'utf-8'));
}
