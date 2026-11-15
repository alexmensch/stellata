// What promotion reads back off a record already built: its distance from Sol and its class.

import { classifyFromSimbad, type SpectralInfo } from '../../../../src/catalog-format/spectral/spectral-classify';
import { decodeSpectralBytes, encodeSpectralBytes } from '../../../../src/catalog-format/spectral/spectral-record-bytes';
import type { Star } from '../../parse/stars-parse';

export function starDistPc(s: { x: number; y: number; z: number }): number {
  return Math.hypot(s.x, s.y, s.z);
}

// Not `star.spectral`: see README.md#reading-a-records-class-back.
export function recordSpectralInfo(star: Star): SpectralInfo {
  return (star.spectDisplay ? classifyFromSimbad(star.spectDisplay) : null)
    ?? decodeSpectralBytes(encodeSpectralBytes(star.spectral));
}
