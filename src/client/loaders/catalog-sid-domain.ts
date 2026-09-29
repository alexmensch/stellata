// The star SID domain over a catalogue that may still be streaming. See README.md#progressive-catalog-load.

import { sidColumnIndex, type SidDomain } from '../util/sid-resolver';
import { isDecodedRecord, type Catalog } from './catalog-loader';

export type SidCatalog = Pick<Catalog, 'sid' | 'loadedCount' | 'onRecordsDecoded' | 'complete'>;

export function catalogSidDomain(catalog: SidCatalog): SidDomain {
  return {
    localIndexOf: sidColumnIndex(catalog.sid, () => catalog.loadedCount),
    sidOf: (i) => (isDecodedRecord(catalog, i) && catalog.sid[i] > 0 ? catalog.sid[i] : null),
    fill: () => (catalog.complete.state().status === 'pending' ? 'filling' : 'complete'),
    onGrow: (listener) => {
      const offChunk = catalog.onRecordsDecoded(() => listener());
      const offComplete = catalog.complete.observe(() => listener());
      return () => { offChunk(); offComplete(); };
    },
  };
}
