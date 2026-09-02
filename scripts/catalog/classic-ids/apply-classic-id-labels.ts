// The record build's label layer: load the committed overlay + IV/27A and
// merge them onto the spine-derived records. See README.md § The label merge.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NO_CONSTELLATION_INDEX } from '../catalog-pure';
import type { Star } from '../parse/stars-parse';
import { parseCrossIndexTsv } from './classic-ids-parse';
import { parseOverlayTsv, type ClassicIdOverlay } from './classic-id-overlay-pure';
import {
  buildDesignationConIndex,
  resolveDesignationConIndex,
  type DesignationConIndex,
} from './designation-constellation-pure';
import {
  CLASSIC_ID_OVERRIDES_FILE,
  LABEL_FLIPS_FILE,
  labelFlipsTsv,
  labelForReview,
  mergeClassicIdLabels,
  parseLabelOverridesTsv,
  type LabelMergeCounts,
  type LabelOverrides,
} from './label-merge-pure';
import { parseMultiplesTsv, sourceIdsWithSiblingComponent } from '../companions/companion-promotion';
import { REPO_ROOT as ROOT } from '../../util/paths';

const SRC_OVERLAY = resolve(ROOT, 'data/classic-ids/classic_id_overlay.tsv');
const SRC_CROSS_INDEX = resolve(ROOT, 'data/classic-ids/cross_index.tsv');
const SRC_OVERRIDES = resolve(ROOT, CLASSIC_ID_OVERRIDES_FILE);
const SRC_LABEL_FLIPS = resolve(ROOT, LABEL_FLIPS_FILE);
const SRC_MULTIPLES = resolve(ROOT, 'data/binaries/multiples.tsv');

/** The label layer's inputs, for the artifact's mtime invalidation. */
export const CLASSIC_ID_LABEL_INPUT_PATHS: readonly string[] = [
  SRC_OVERLAY, SRC_CROSS_INDEX, SRC_OVERRIDES, SRC_LABEL_FLIPS, SRC_MULTIPLES,
];

export interface ClassicIdLabelInputs {
  overlay: ClassicIdOverlay;
  desigCon: DesignationConIndex;
  overrides: LabelOverrides;
  /** The committed review queue, for the equality check in the pass below. */
  committedFlipsTsv: string;
  siblingRenderedSourceIds: ReadonlySet<string>;
  crossIndexUnknownCst: number;
}

/** Both tables are committed artifacts and neither is optional: without the
 *  overlay every record would silently ship AT-HYG's inherited cross-IDs, and
 *  without IV/27A every Bayer / Flamsteed designation would fall back to its
 *  positional constellation — the ρ Aql rewrite. A missing file is a hard fail
 *  rather than a degraded tier, the same call `loadReadStarsInputs` makes for
 *  the dust grid. */
export function loadClassicIdLabelInputs(): ClassicIdLabelInputs {
  for (const path of [SRC_OVERLAY, SRC_CROSS_INDEX, SRC_LABEL_FLIPS]) {
    if (existsSync(path)) continue;
    throw new Error(
      `Missing ${path}. Confirm git LFS is pulled (\`git lfs pull\`), then ` +
        `re-run \`pnpm run build:classic-ids\`.`,
    );
  }
  const overlay = parseOverlayTsv(readFileSync(SRC_OVERLAY, 'utf8'));
  const { index: desigCon, counts } = buildDesignationConIndex(
    parseCrossIndexTsv(readFileSync(SRC_CROSS_INDEX, 'utf8')),
  );
  return {
    overlay,
    desigCon,
    overrides: existsSync(SRC_OVERRIDES)
      ? parseLabelOverridesTsv(readFileSync(SRC_OVERRIDES, 'utf8'))
      : new Map(),
    committedFlipsTsv: readFileSync(SRC_LABEL_FLIPS, 'utf8'),
    siblingRenderedSourceIds: existsSync(SRC_MULTIPLES)
      ? sourceIdsWithSiblingComponent(parseMultiplesTsv(readFileSync(SRC_MULTIPLES, 'utf8')))
      : new Set<string>(),
    crossIndexUnknownCst: counts.crossIndexUnknownCst,
  };
}

export interface ClassicIdLabelCounts extends LabelMergeCounts {
  /** Records whose designation constellation came from IV/27A. */
  desigConFromCrossIndex: number;
  crossIndexUnknownCst: number;
}

/** Apply the label layer to the record set, in place.
 *
 *  Runs as a POST-PASS over `readStars`' output, never inside the walk: the
 *  direction, distance, V and spectral cascades key on the spine's frozen
 *  `hip`, and re-deciding that binding mid-walk is exactly what
 *  `../spine/README.md` § The identifier columns are read, never re-derived
 *  forbids. What the merge changes is the record's LABELS.
 *
 *  It runs before companion promotion, so a promoted companion composes its
 *  name from an anchor whose designations are already the merged ones. */
export function applyClassicIdLabels(
  stars: Star[],
  inputs: ClassicIdLabelInputs,
): ClassicIdLabelCounts {
  const labels = stars.map((s) => labelForReview(s));
  const { counts, flips } = mergeClassicIdLabels({
    records: stars,
    labels,
    overlay: inputs.overlay,
    overrides: inputs.overrides,
    siblingRenderedSourceIds: inputs.siblingRenderedSourceIds,
  });

  // The committed queue is written by `build:classic-ids` from the spine, this
  // one from the records the spine produced, through the same pure merge — so
  // the two are byte-identical or one of the inputs moved without the other.
  const actual = labelFlipsTsv(flips);
  if (actual !== inputs.committedFlipsTsv) {
    throw new Error(
      `${LABEL_FLIPS_FILE} does not describe the labels this build wrote ` +
        `(${flips.length} review rows here). Re-run ` +
        `\`pnpm run build:classic-ids\` and commit the result.`,
    );
  }

  // The constellation a Bayer / Flamsteed designation is NAMED for, which is
  // fixed by nomenclature and does not migrate when proper motion carries the
  // star across a 1930 boundary. The GCVS pass overwrites this downstream where
  // a variable's own designation carries one.
  let desigConFromCrossIndex = 0;
  for (const star of stars) {
    const conIndex = resolveDesignationConIndex(inputs.desigCon, star.hd, star.hip);
    if (conIndex === NO_CONSTELLATION_INDEX) continue;
    star.desigConIndex = conIndex;
    desigConFromCrossIndex++;
  }

  return {
    ...counts,
    desigConFromCrossIndex,
    crossIndexUnknownCst: inputs.crossIndexUnknownCst,
  };
}
