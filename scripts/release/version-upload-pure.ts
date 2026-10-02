/** The uploaded version's ID and preview URL, read from wrangler's output file. README.md#the-pre-traffic-check. */

export interface UploadedVersion {
  versionId: string;
  previewUrl: string;
}

export function uploadedVersionOf(ndjson: string): UploadedVersion {
  const uploads = ndjson
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.type === 'version-upload');
  if (uploads.length !== 1) throw new Error(`expected one version-upload entry, found ${uploads.length}`);

  const { version_id: versionId, preview_url: previewUrl } = uploads[0];
  if (typeof versionId !== 'string' || versionId === '') throw new Error('the upload recorded no version ID');
  if (typeof previewUrl !== 'string' || previewUrl === '') {
    throw new Error('the upload recorded no preview URL; previews are off for this Worker (wrangler triggers deploy enables them)');
  }
  return { versionId, previewUrl };
}
