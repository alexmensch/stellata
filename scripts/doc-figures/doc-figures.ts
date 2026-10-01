// The tree's side of doc figures: the committed count snapshots, every doc that can carry a marker, and the catalogue-size scan.
import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { gitFiles, lfsTracked, presentFiles } from '../util/git-files';
import {
  catalogueSizeFigures,
  type DocKind,
  type FigureReport,
  markerlessSizeForms,
  parseSizeExemptions,
  renderFigures,
  resolveFigure,
  scannable,
  SNAPSHOT_SUFFIX,
  type Snapshots,
} from './doc-figures-pure';

export const RECORD_COUNT_KEY = 'build-catalog/recordCount';
const SPINE_ROWS_KEY = 'inherited-spine/rows';
/** The catalogue has never held fewer records than the spine nor more than today's; 5% either side catches a rounding of either end. */
const SIZE_RANGE_SLACK = 0.05;

/** Surfaces a marker cannot sit in (YAML strings, a plain-text file served as is): their catalogue size must equal the current rounding. */
export const MARKERLESS_SURFACES = ['CITATION.cff'];

export const SIZE_EXEMPTIONS_FILE = 'scripts/doc-figures/catalogue-size-exemptions.txt';
const SIZE_SCAN_KINDS = ['.md', '.html', '.ts', '.js', '.py', '.css', '.cff', '.txt'];
/** Test fixtures are data, not claims; research/ is a frozen record and the paper index quotes papers. */
const sizeScanned = (f: string): boolean =>
  SIZE_SCAN_KINDS.includes(extname(f)) &&
  !/\.test\.ts$|-fixture\.ts$|\.test\.py$/.test(f) &&
  !f.startsWith('research/') &&
  f !== 'data/papers/index.md' &&
  f !== SIZE_EXEMPTIONS_FILE;

function snapshotNumber(snapshots: Snapshots, key: string): number {
  const r = resolveFigure(key, snapshots);
  if (!r.ok) throw new Error(`catalogue size has no owner: ${r.reason}`);
  return r.value;
}

export function loadSnapshots(root: string): Snapshots {
  const snapshots = new Map<string, unknown>();
  for (const path of presentFiles(root, gitFiles(root, [`*${SNAPSHOT_SUFFIX}`], { untracked: true }))) {
    const stem = basename(path, SNAPSHOT_SUFFIX);
    if (snapshots.has(stem)) throw new Error(`two snapshots share the stem ${stem}; doc-figure keys would be ambiguous`);
    snapshots.set(stem, JSON.parse(readFileSync(join(root, path), 'utf8')));
  }
  return snapshots;
}

const docKind = (file: string): DocKind => (file.endsWith('.html') ? 'html' : 'markdown');

export function docFiles(root: string): string[] {
  return presentFiles(root, gitFiles(root, ['*.md', '*.html'], { untracked: true }));
}

export interface DocFigureScan {
  file: string;
  text: string;
  report: FigureReport;
}

export function scanDocFigures(root: string): DocFigureScan[] {
  const snapshots = loadSnapshots(root);
  return docFiles(root).map((file) => {
    const text = readFileSync(join(root, file), 'utf8');
    return { file, text, report: renderFigures(text, snapshots, docKind(file)) };
  });
}

export interface CatalogueSizeScan {
  offenders: string[];
  unusedExemptions: string[];
}

export function scanCatalogueSize(root: string): CatalogueSizeScan {
  const snapshots = loadSnapshots(root);
  const recordCount = snapshotNumber(snapshots, RECORD_COUNT_KEY);
  const range = [
    snapshotNumber(snapshots, SPINE_ROWS_KEY) * (1 - SIZE_RANGE_SLACK),
    recordCount * (1 + SIZE_RANGE_SLACK),
  ] as const;
  const allowed = new Set(markerlessSizeForms(recordCount));
  const exemptions = parseSizeExemptions(readFileSync(join(root, SIZE_EXEMPTIONS_FILE), 'utf8'));
  const used = new Set<number>();

  const names = gitFiles(root, [], { untracked: true }).filter(sizeScanned);
  const lfs = lfsTracked(root, names);
  const offenders: string[] = [];
  for (const file of presentFiles(root, names.filter((f) => !lfs.has(f)))) {
    const text = readFileSync(join(root, file), 'utf8');
    const kind: DocKind | null = file.endsWith('.md') ? 'markdown' : null;
    for (const { figure, line } of catalogueSizeFigures(kind ? scannable(text, kind) : text, range)) {
      if (MARKERLESS_SURFACES.includes(file) && allowed.has(figure)) continue;
      const exempt = exemptions.findIndex((e) => e.file === file && e.figure === figure);
      if (exempt !== -1) {
        used.add(exempt);
        continue;
      }
      offenders.push(`${file}:${line}: ${figure}`);
    }
  }
  const unusedExemptions = exemptions.filter((_, i) => !used.has(i)).map((e) => `${e.file}\t${e.figure}`);
  return { offenders, unusedExemptions };
}
