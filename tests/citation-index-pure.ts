// Parsing for data/papers/index.md entries and manifest.json copies. Rules: /data/papers/README.md#cited-papers.

export interface IndexEntry {
  key: string;
  line: number;
  copy: string;
}

export interface PinnedCopy {
  file: string;
  source_url: string;
  sha256: string;
  bytes: number;
}

const ANCHOR = /^<a id="([^"]+)"><\/a>$/;
const COPY = /^- \*\*Copy:\*\* (.*)$/;
const NOT_HELD = /^(not held|unobtainable)\b/;

export function parseIndex(markdown: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  markdown.split('\n').forEach((text, i) => {
    const anchor = ANCHOR.exec(text);
    if (anchor) entries.push({ key: anchor[1], line: i + 1, copy: '' });
    const copy = COPY.exec(text);
    if (copy && entries.length > 0) entries[entries.length - 1].copy = copy[1];
  });
  return entries;
}

export const holdsCopy = (entry: IndexEntry): boolean => entry.copy !== '' && !NOT_HELD.test(entry.copy);
