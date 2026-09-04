// Every `<file>.md § <Heading>` citation in docs/render-rules.md and
// AGENTS.md must resolve to a heading that actually exists in the cited
// file, so a heading rename fails CI instead of leaving a dangling pointer.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SCANNED = ['docs/render-rules.md', 'AGENTS.md'];

// `path/to/file.md § Heading words` — the path may be backticked; the
// heading runs to the first sentence or clause terminator.
const CITATION = /`?([\w./-]+\.md)`?\s+§\s+([^.;:()`\n]+)/g;

const SEARCH_ROOTS = ['', 'src/client', 'docs'];

// A heading's title is the text before its first " — " or ":" subtitle;
// words are compared lowercased with clause punctuation stripped, so
// "Version policy, the" matches "## Version policy" and "Early-z is the"
// matches "## Early-z — the star layer's …".
function titleWords(text: string): string[] {
  return text
    .split(/\s+—\s+|:/)[0]
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[,;:"'`()]/g, ''))
    .filter((w) => w.length > 0);
}

function headingsOf(mdPath: string): string[][] {
  return readFileSync(mdPath, 'utf-8')
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => titleWords(line.replace(/^#{1,6}\s+/, '').replace(/^\d+\.\s+/, '')));
}

function citesHeading(cited: string, headings: string[][]): boolean {
  const words = titleWords(cited);
  // A citation may name only the heading's first word ("§ Sentinel-init" for
  // "## Sentinel-init for dirty-track"), which is how AGENTS.md cites.
  return headings.some((h) => {
    const k = Math.min(2, h.length, words.length);
    return k > 0 && h.slice(0, k).every((w, i) => words[i] === w);
  });
}

function resolveDoc(citedPath: string, fromFile: string): string | null {
  const candidates = [
    join(dirname(fromFile), citedPath),
    ...SEARCH_ROOTS.map((r) => join(ROOT, r, citedPath)),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

describe('render-rules and AGENTS.md section citations resolve', () => {
  for (const rel of SCANNED) {
    it(`${rel}: every "file.md § Heading" names a real heading`, () => {
      const file = join(ROOT, rel);
      const text = readFileSync(file, 'utf-8');
      const failures: string[] = [];
      for (const m of text.matchAll(CITATION)) {
        const [, citedPath, headingText] = m;
        // `§ <named section>` is AGENTS.md's placeholder for "the section the
        // trigger names", not a citation.
        if (headingText.trim().startsWith('<')) continue;
        const doc = resolveDoc(citedPath, file);
        if (doc === null) {
          failures.push(`${citedPath} — file not found`);
          continue;
        }
        if (!citesHeading(headingText, headingsOf(doc))) {
          failures.push(`${citedPath} § ${headingText.trim()} — no heading with that title`);
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});
