/**
 * Cloudflare Workers static-asset size budget: the per-file ceiling and the verdict over a built dist/.
 */

export const MiB = 1024 * 1024;

export const WORKERS_MAX_ASSET_BYTES = 25 * MiB;

export const ASSET_WARN_FRACTION = 0.8;

export interface AssetSize {
  path: string;
  bytes: number;
}

export interface AssetSizeVerdict {
  largestFirst: AssetSize[];
  oversize: AssetSize[];
  nearLimit: AssetSize[];
}

export function judgeAssetSizes(
  assets: readonly AssetSize[],
  limitBytes: number = WORKERS_MAX_ASSET_BYTES,
  warnFraction: number = ASSET_WARN_FRACTION,
): AssetSizeVerdict {
  const largestFirst = [...assets].sort((a, b) => b.bytes - a.bytes);
  return {
    largestFirst,
    oversize: largestFirst.filter((a) => a.bytes > limitBytes),
    nearLimit: largestFirst.filter((a) => a.bytes <= limitBytes && a.bytes > limitBytes * warnFraction),
  };
}

export function formatMiB(bytes: number): string {
  return `${(bytes / MiB).toFixed(1)} MiB`;
}
