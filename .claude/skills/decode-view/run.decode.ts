import { it } from 'vitest';
import { pickShareBlob } from '../../../src/client/util/url-state/share-path-pure';
import { decodeBlob } from '../../../src/client/util/url-state/url-state';

const KM_PER_PC = 3.0856775814913673e13;
const KM_PER_AU = 149597870.7;

function scale(pc: number): string {
  const km = pc * KM_PER_PC;
  if (km < 1e6) return `${km.toFixed(0)} km`;
  if (km < 0.5 * KM_PER_AU) return `${(km / 1e6).toFixed(3)} million km`;
  if (pc < 0.5) return `${(km / KM_PER_AU).toFixed(3)} AU`;
  return `${pc.toFixed(4)} pc`;
}

const input = process.env.VIEW ?? '';

it.skipIf(input === '')('decode a share URL or blob', () => {
  let blob = input;
  try {
    const u = new URL(input);
    blob = pickShareBlob(u.pathname, u.search).blob ?? input;
  } catch {
    // Not a URL, so the input is already a bare blob. Rethrowing here
    // would reject the bare-blob form the skill documents.
  }

  const decoded = decodeBlob(blob) as { view?: Record<string, unknown>; version?: number };
  console.log(`\nblob   ${blob}`);
  console.log(JSON.stringify(decoded, null, 2));

  const v = decoded.view ?? {};
  const vec = (k: string): number[] | null => Array.isArray(v[k]) ? v[k] as number[] : null;
  const cam = vec('cam'), tgt = vec('tgt'), off = vec('worldOffset');
  const focus = v.focus as { kind?: string; id?: number } | undefined;

  console.log('\n-- derived --');
  console.log(`schema                     v${decoded.version ?? '?'}`);
  // The local frame's origin is the focused object, so |cam| IS the
  // camera-to-focus distance whenever tgt is absent. That distance is what
  // every cadence budget divides by (render-gate/README.md).
  if (cam) console.log(`camera from local origin   ${scale(Math.hypot(...cam))}`);
  if (cam && tgt) {
    console.log(`camera to target           ${scale(Math.hypot(
      cam[0] - tgt[0], cam[1] - tgt[1], cam[2] - tgt[2]))}`);
  } else if (cam) {
    console.log(`camera to target           ${scale(Math.hypot(...cam))}  (tgt absent = local origin)`);
  }
  if (off) console.log(`worldOffset from Sol       ${scale(Math.hypot(...off))}`);
  console.log(`focus                      ${focus
    ? `sid ${focus.id} (kind needs the runtime resolver)` : '(absent = Sol)'}`);
  console.log(`clock                      ${typeof v.t === 'number'
    ? `pinned t=${v.t} = ${new Date(v.t * 1000).toISOString()}` : '(absent = live 1x)'}`);
  console.log(`fov                        ${v.fov ?? '(default)'}`);
  console.log(`mode                       ${v.mode ?? 'navigate'}`);
  console.log('');
});
