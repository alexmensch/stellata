// The parity gate's spine ↔ manifest matcher. See README.md#the-parity-gate.

import { compareDesignations, sameAsClasses, type SameasEdge } from '../../sid/sid-pure';
import { manifestDesignations, type ManifestRecord } from './membership-manifest-tsv';

export interface SpineMatch {
  /** Per spine row: the index of the one manifest row its designation class
   *  reaches, or null. */
  manifestIndex: (number | null)[];
  /** Spine rows none of whose designations the manifest knows. */
  unmatched: number[];
  /** Spine rows whose canonical key's class holds more than one manifest row —
   *  a stored bridge joining two records. */
  multiple: number[];
  /** Manifest rows no spine row reaches — the additions. */
  unreached: number[];
}

/** Resolve every spine row through `sameAsClasses` over the manifest's
 *  designations, the classes SID allocation builds, keying the row on its
 *  first ladder-ranked designation the graph knows — its canonical key. A
 *  lower-ranked designation the label merge moved to a sibling therefore does
 *  not split the match: the SID never rode on it. */
export function matchSpineToManifest(
  spineDesignations: readonly (readonly string[])[],
  manifestRows: readonly ManifestRecord[],
  storedEdges: readonly SameasEdge[],
): SpineMatch {
  const { classes, objectsByClass } = sameAsClasses(
    manifestRows.map(manifestDesignations),
    storedEdges,
  );
  const manifestIndex: (number | null)[] = [];
  const unmatched: number[] = [];
  const multiple: number[] = [];
  const reached = new Set<number>();
  spineDesignations.forEach((set, s) => {
    const key = [...set].sort(compareDesignations).find((d) => classes.has(d));
    const hits = key === undefined ? [] : objectsByClass.get(classes.find(key)) ?? [];
    if (hits.length === 1) {
      const [i] = hits;
      manifestIndex.push(i);
      reached.add(i);
    } else {
      manifestIndex.push(null);
      (hits.length === 0 ? unmatched : multiple).push(s);
    }
  });
  const unreached = manifestRows.map((_, i) => i).filter((i) => !reached.has(i));
  return { manifestIndex, unmatched, multiple, unreached };
}
