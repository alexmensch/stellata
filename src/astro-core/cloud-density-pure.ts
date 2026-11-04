// See /docs/science-molecular-clouds.md#4-per-cloud-density-model--the-presence-pass-field.

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 1 inside, fading to 0 between `fadeStart · uEnv` and `uEnv` of the ellipsoidal radius `u`. */
export function cloudEnvelope(u: number, uEnv: number, fadeStart: number): number {
  return 1 - smoothstep(fadeStart * uEnv, uEnv, u);
}

/** Unit-amplitude Plummer profile at radius `rPc`. */
export function plummerProfile(rPc: number, rflatPc: number, p: number): number {
  const q = rPc / rflatPc;
  return (1 + q * q) ** (-p / 2);
}
