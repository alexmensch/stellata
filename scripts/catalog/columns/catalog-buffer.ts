// A built catalogue's chunks read off disk and reassembled into one buffer. See README.md.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  assembleCatalogChunks, catalogChunkFilename, CATALOG_MANIFEST_FILENAME, type CatalogManifest,
} from '../../../src/catalog-format/record/catalog-pure';
import { publicFile } from '../../util/paths';

export async function readCatalogBuffer(
  manifestPath: string = publicFile(CATALOG_MANIFEST_FILENAME),
): Promise<ArrayBuffer> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as CatalogManifest;
  const dir = dirname(manifestPath);
  const chunks = await Promise.all(
    manifest.chunkBytes.map((_, i) =>
      readFile(resolve(dir, catalogChunkFilename(i))).then(
        (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
      ),
    ),
  );
  return assembleCatalogChunks(chunks, manifest);
}
