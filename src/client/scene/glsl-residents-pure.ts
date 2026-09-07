// Objects in a scene graph carrying a raw-GLSL material, which the WebGPU
// renderer cannot build a pipeline for (../webgpu/README.md § One scene
// per boot).

import type * as THREE from 'three';

/** three's node materials set `isNodeMaterial` and never this flag, so it
 *  separates hand-written GLSL from every built-in and every TSL surface
 *  without importing either renderer. Testing `isNodeMaterial` instead
 *  would flag `LineBasicMaterial` and every mesh three converts itself. */
function isGlslMaterial(material: THREE.Material): boolean {
  return (material as { isShaderMaterial?: boolean }).isShaderMaterial === true;
}

/** Empty is the invariant a WebGPU boot holds; a non-empty return names
 *  what would fail pipeline creation, one entry per offending material. */
export function findGlslResidents(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.traverse((object) => {
    const material = (object as Partial<THREE.Mesh>).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (isGlslMaterial(m)) out.push(`${object.name || object.type} → ${m.type}`);
    }
  });
  return out;
}
