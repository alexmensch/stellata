import { describe, expect, it } from 'vitest';

import { uploadedVersionOf } from './version-upload-pure';

const line = (entry: Record<string, unknown>) => JSON.stringify(entry);
const session = line({ type: 'wrangler-session', version: 1, wrangler_version: '4.129.1' });
const upload = (fields: Record<string, unknown>) =>
  line({ type: 'version-upload', version: 1, worker_name: 'stellata', ...fields });

describe('uploadedVersionOf', () => {
  it('reads the version ID and preview URL among the file’s other entries', () => {
    const ndjson = [session, upload({ version_id: 'a1b2c3d4-e5', preview_url: 'https://a1b2c3d4-stellata.x.workers.dev' }), ''].join('\n');
    expect(uploadedVersionOf(ndjson)).toEqual({
      versionId: 'a1b2c3d4-e5',
      previewUrl: 'https://a1b2c3d4-stellata.x.workers.dev',
    });
  });

  it('refuses an upload with no preview URL, naming the cause', () => {
    expect(() => uploadedVersionOf(upload({ version_id: 'a1b2c3d4-e5' }))).toThrow(/previews are off/);
  });

  it('refuses an aborted upload, which records a null version ID', () => {
    expect(() => uploadedVersionOf(upload({ version_id: null, preview_url: 'https://p' }))).toThrow(/no version ID/);
  });

  it.each([
    ['none', session],
    ['two', [upload({ version_id: 'a', preview_url: 'https://a' }), upload({ version_id: 'b', preview_url: 'https://b' })].join('\n')],
  ])('refuses a file with %s version-upload entries', (_, ndjson) => {
    expect(() => uploadedVersionOf(ndjson)).toThrow(/expected one version-upload entry/);
  });
});
