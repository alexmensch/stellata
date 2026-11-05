// The built catalogue's float32 record columns, each decoded whole. See README.md.

import {
  decodeRecordColumn, readCatalogHeader, wholeRecordSpan, CATALOG_MANIFEST_FILENAME, type Float32RecordField,
} from '../../src/catalog-format/record/catalog-pure';
import { publicFile } from '../util/paths';
import { readCatalogBuffer } from './catalog-lookup';

export type CatalogColumns<F extends Float32RecordField> = { readonly count: number } & { readonly [K in F]: Float32Array };

export async function readCatalogColumns<F extends Float32RecordField>(
  fields: readonly F[],
  manifestPath: string = publicFile(CATALOG_MANIFEST_FILENAME),
): Promise<CatalogColumns<F>> {
  const buffer = await readCatalogBuffer(manifestPath);
  const header = readCatalogHeader(buffer);
  const view = new DataView(buffer);
  const span = wholeRecordSpan(header);
  const columns = Object.fromEntries(fields.map((field) => {
    const out = new Float32Array(header.count);
    decodeRecordColumn(view, span, field, out);
    return [field, out];
  }));
  return { ...columns, count: header.count } as CatalogColumns<F>;
}
