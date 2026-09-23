/**
 * Cloudflare Workers static-asset size budget: the per-file ceiling and the verdict over a built dist/.
 */

export const WORKERS_MAX_ASSET_BYTES = 25 * 1024 * 1024;

export const ASSET_WARN_FRACTION = 0.8;

export interface AssetSize {
  path: string;
  bytes: number;
}

export interface AssetSizeVerdict {
  oversize: AssetSize[];
  nearLimit: AssetSize[];
}

export function judgeAssetSizes(
  assets: readonly AssetSize[],
  limitBytes: number = WORKERS_MAX_ASSET_BYTES,
  warnFraction: number = ASSET_WARN_FRACTION,
): AssetSizeVerdict {
  const bySizeDesc = [...assets].sort((a, b) => b.bytes - a.bytes);
  return {
    oversize: bySizeDesc.filter((a) => a.bytes > limitBytes),
    nearLimit: bySizeDesc.filter((a) => a.bytes <= limitBytes && a.bytes > limitBytes * warnFraction),
  };
}

export function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
