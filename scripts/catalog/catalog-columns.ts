// The built catalogue's float32 record columns, each decoded whole, and the projection a bake reading them records. See README.md.

import { resolve } from 'node:path';

import {
  decodeRecordColumn, readCatalogHeader, wholeRecordSpan, CATALOG_MANIFEST_FILENAME, type Float32RecordField,
} from '../../src/catalog-format/record/catalog-pure';
import type { Projection } from '../util/emit-artifacts';
import { publicFile, publicRepoPath, REPO_ROOT } from '../util/paths';
import { hashBytes } from '../util/stamp-hash';
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

export async function catalogColumnsProjection(fields: readonly Float32RecordField[], root: string = REPO_ROOT): Promise<Required<Projection>> {
  const manifest = publicRepoPath(CATALOG_MANIFEST_FILENAME);
  const columns = await readCatalogColumns(fields, resolve(root, manifest));
  const request = fields.map((field) => {
    const column = columns[field];
    return `${field} ${hashBytes(new Uint8Array(column.buffer, column.byteOffset, column.byteLength))}`;
  });
  return { request, requestFrom: [manifest] };
}
