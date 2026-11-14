// Stage 6: the multiples.tsv records, kept pairs then standalone components, and the counts it completes. See README.md.

import { fold, prefixed } from '../../util/counts/tally-pure';
import type { Stage3Result } from '../astrometry/attach-astrometry';
import { firstPerSystem } from '../astrometry/system-anchors-pure';
import { componentKey, type ComponentKey } from '../component-tokens-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import { A_VIA, ASTROMETRY_VIA, ORBIT_ROLES, SPECT_VIA, type MultiplesRecord } from '../multiples-record-pure';
import { OPTICAL_VIA_PROPERTIES } from '../optical/optical-tiers-pure';
import type { Stage5Result } from '../optical/attach-optical';
import type { Stage4Result } from '../orbits/attach-orbits';
import { computeAnchorOffsets } from './anchor-offsets-pure';
import { pairRows, positionPc, standaloneRow } from './multiples-rows-pure';

export interface Stage6Result {
  /** Two per kept, placed pair in Stage 3's order, then one per standalone component. */
  readonly rows: readonly MultiplesRecord[];
  /** `<wds_id><components>` of each kept pair with no position: they never reach the file. */
  readonly droppedNoPosition: readonly string[];
  /** `<wds_id><components>` of each pair whose magnitudes the MSC filled. */
  readonly mscMagFills: readonly string[];
}

export function attachStage6(
  stage3: Stage3Result, stage4: Stage4Result, stage5: Stage5Result,
  reference: Pick<ReferenceCatalogs, 'indices' | 'simbadWdsXids'>,
): Stage6Result {
  const { indices } = reference;
  const systemAnchors = firstPerSystem(stage3.pairs, stage3.astrometry, positionPc);
  const anchors = computeAnchorOffsets(stage3.pairs, stage5.optical, indices.msc);
  const rows: MultiplesRecord[] = [];
  const droppedNoPosition: string[] = [];
  const mscMagFills: string[] = [];
  const emitted = new Set<ComponentKey>();
  for (const p of stage3.pairs) {
    if (!OPTICAL_VIA_PROPERTIES[stage5.optical.get(p)!].physical) continue;
    const label = `${p.pair.wdsId}${p.pair.components}`;
    const built = pairRows(
      p, stage3.astrometry.get(p)!, stage4.orbits.get(p)!, systemAnchors.get(p.pair.wdsId) ?? null, { indices, anchors },
    );
    if (built === null) {
      droppedNoPosition.push(label);
      continue;
    }
    rows.push(...built.rows);
    if (built.mscMags) mscMagFills.push(label);
    emitted.add(componentKey(p.pair.wdsId, p.primary.component));
    emitted.add(componentKey(p.pair.wdsId, p.secondary.component));
  }
  for (const [key, xid] of reference.simbadWdsXids) {
    if (!emitted.has(key)) rows.push(standaloneRow(xid, systemAnchors.get(xid.wdsId) ?? null, indices, anchors));
  }
  return Object.freeze({
    rows: Object.freeze(rows.map((r) => Object.freeze(r))),
    droppedNoPosition: Object.freeze(droppedNoPosition),
    mscMagFills: Object.freeze(mscMagFills),
  });
}

const PRESENCE = ['populated', 'empty'] as const;

function populated(rows: readonly MultiplesRecord[], value: (r: MultiplesRecord) => unknown): number {
  return fold(PRESENCE, rows, (r) => (value(r) === null ? 'empty' : 'populated')).populated;
}

export function stage6Counts(result: Stage6Result) {
  const { rows } = result;
  return {
    msc_pair_mags_filled: result.mscMagFills.length,
    multiples_rows_emitted: rows.length,
    multiples_pairs_dropped_no_position: result.droppedNoPosition.length,
    multiples_astrometry_system_inherited: fold(ASTROMETRY_VIA, rows, (r) => r.astrometryVia).system_inherited,
    multiples_standalone_emitted: fold(ORBIT_ROLES, rows, (r) => r.orbitRole).standalone,
    multiples_hd_populated: populated(rows, (r) => r.hd),
    multiples_sep_arcsec_populated: populated(rows, (r) => r.sepArcsec),
    multiples_pa_deg_populated: populated(rows, (r) => r.paDeg),
    multiples_sep_pa_epoch_populated: populated(rows, (r) => r.sepPaEpochJd),
    multiples_dmag_populated: populated(rows, (r) => r.dmag),
    multiples_orbit_q_populated: populated(rows, (r) => (r.orbitVia === 'none' ? null : r.q)),
    ...prefixed('a_via_', fold(A_VIA, rows, (r) => r.aVia)),
    ...prefixed('spect_', fold(SPECT_VIA, rows, (r) => r.spectVia)),
  };
}

export type Stage6Counts = ReturnType<typeof stage6Counts>;
