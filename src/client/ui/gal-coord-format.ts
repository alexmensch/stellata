export type GalCoordFormat = 'deg' | 'dms';

let currentFormat: GalCoordFormat = 'deg';
const handlers: Array<(f: GalCoordFormat) => void> = [];

export function getGalCoordFormat(): GalCoordFormat { return currentFormat; }

export function setGalCoordFormat(f: GalCoordFormat) {
  if (currentFormat === f) return;
  currentFormat = f;
  for (const h of handlers) h(f);
}

export function onGalCoordFormatChange(h: (f: GalCoordFormat) => void) { handlers.push(h); }

// Galactic longitude wraps to [0, 360); it's never signed.
export function formatGalLon(lDeg: number): string {
  const l = ((lDeg % 360) + 360) % 360;
  return currentFormat === 'dms' ? toDms(l) : `${l.toFixed(1)}°`;
}

// Galactic latitude stays in [-90, 90]; negatives carry a leading minus in
// both formats (decimal via toFixed, DMS via toDms).
export function formatGalLat(bDeg: number): string {
  return currentFormat === 'dms' ? toDms(bDeg) : `${bDeg.toFixed(1)}°`;
}

function toDms(deg: number): string {
  const neg = deg < 0;
  const abs = Math.abs(deg);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Math.round((abs - d) * 3600 - m * 60);
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  return `${neg ? '-' : ''}${d}°${pad(m)}′${pad(s)}″`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
