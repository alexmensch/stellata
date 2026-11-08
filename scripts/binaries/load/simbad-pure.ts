// SIMBAD's WDS component cross-IDs and their per-component spectral types.

import type { Declared } from '../../util/sources/source';
import { readTable, type ColumnTable } from '../../util/tsv/table-pure';
import { componentKey, type ComponentKey } from '../component-tokens-pure';

/** SIMBAD's object for one WDS component. `gaiaSourceId` is null where SIMBAD
 *  carries no DR3 cross-ID (α Cen A/B's saturation gap) though the HIP may stand. */
export interface SimbadWdsXid {
  readonly wdsId: string;
  readonly component: string;
  readonly simbadOid: number;
  readonly simbadMainId: string;
  readonly gaiaSourceId: string | null;
  readonly hip: number | null;
}

const XID_COLUMNS = ['wds_id', 'component', 'simbad_oid', 'simbad_main_id', 'gaia_source_id', 'hip'] as const;

/** A repeated component keeps its last row. */
export function parseSimbadWdsXids(table: ColumnTable): Map<ComponentKey, SimbadWdsXid> {
  const out = new Map<ComponentKey, SimbadWdsXid>();
  for (const row of table(XID_COLUMNS)) {
    const wdsId = row.text('wds_id');
    const component = row.text('component');
    const simbadOid = row.int('simbad_oid');
    if (wdsId === null || component === null || simbadOid === null) continue;
    out.set(componentKey(wdsId, component), {
      wdsId,
      component,
      simbadOid,
      simbadMainId: row.text('simbad_main_id') ?? '',
      gaiaSourceId: row.sourceId('gaia_source_id'),
      hip: row.int('hip'),
    });
  }
  return out;
}

/** simbad_oid → sp_type, typed objects only; a repeated oid keeps its last row. */
export function parseSptypeByOid(text: string, from: Declared): Map<number, string> {
  const out = new Map<number, string>();
  for (const row of readTable({ ...from, columns: ['simbad_oid', 'sp_type'] as const }, text)) {
    const oid = row.int('simbad_oid');
    const sp = row.text('sp_type');
    if (oid !== null && sp !== null) out.set(oid, sp);
  }
  return out;
}

/** sp_type per component, joined on simbad_oid. */
export function joinSimbadWdsSpectra(
  spByOid: ReadonlyMap<number, string>, xids: ReadonlyMap<ComponentKey, SimbadWdsXid>,
): Map<ComponentKey, string> {
  const out = new Map<ComponentKey, string>();
  for (const [key, xid] of xids) {
    const sp = spByOid.get(xid.simbadOid);
    if (sp !== undefined) out.set(key, sp);
  }
  return out;
}
