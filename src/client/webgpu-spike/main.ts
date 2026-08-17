// Boot for the WebGPU star-pipeline spike: renderer with reversed-z +
// timestamp queries, synthetic field, TSL/WGSL implementation toggle, HUD.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeColorLutTexture } from '../star-pipeline/blackbody-lut';
import {
  PASS_RENDER_ORDER, STAR_PASSES, buildSpikeUniforms, buildStarGeometry,
  type StarPass,
} from './star-common';
import { buildStarMaterialsTSL } from './star-tsl';
import { buildStarMaterialsWGSL } from './star-wgsl';
import {
  ALPHA_IDX, AU_PC, FIELD_COUNT, makeSyntheticDust, makeSyntheticStars,
} from './synthetic-stars';

type Impl = 'tsl' | 'wgsl';

const hud = document.getElementById('hud') as HTMLDivElement;

function fail(message: string): never {
  hud.textContent = message;
  throw new Error(message);
}

async function boot() {
  if (!('gpu' in navigator)) {
    fail('WebGPU is not available in this browser — the spike (and the migration) require it.');
  }

  const uniforms = buildSpikeUniforms();
  const stars = makeSyntheticStars();
  const dustTex = makeSyntheticDust(
    uniforms.uDustBoundsPc.value,
    uniforms.uDustDensityMin.value,
    uniforms.uDustLogRatio.value,
  );
  const lutTex = makeColorLutTexture();

  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    reversedDepthBuffer: true,
    trackTimestamp: true,
  });
  await renderer.init();
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(
    60, window.innerWidth / window.innerHeight, 1e-12, 1e5);
  camera.position.set(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.5 * AU_PC);
  controls.minDistance = 1e-8;
  controls.maxDistance = 500;
  controls.update();

  const geometry = buildStarGeometry(stars);
  const materials: Record<Impl, ReturnType<typeof buildStarMaterialsTSL>> = {
    tsl: buildStarMaterialsTSL(uniforms, dustTex, lutTex),
    wgsl: buildStarMaterialsWGSL(uniforms, dustTex, lutTex),
  };

  let impl: Impl =
    new URLSearchParams(location.search).get('impl') === 'wgsl' ? 'wgsl' : 'tsl';

  const meshes = new Map<StarPass, THREE.Mesh>();
  for (const pass of STAR_PASSES) {
    const mesh = new THREE.Mesh(geometry, materials[impl][pass]);
    mesh.frustumCulled = false;
    mesh.renderOrder = PASS_RENDER_ORDER[pass];
    scene.add(mesh);
    meshes.set(pass, mesh);
  }

  const setImpl = (next: Impl) => {
    impl = next;
    for (const pass of STAR_PASSES) {
      meshes.get(pass)!.material = materials[impl][pass];
    }
  };

  const syncViewportUniforms = () => {
    uniforms.uViewport.value.set(window.innerWidth, window.innerHeight);
    uniforms.uPixelRatio.value = dpr;
    uniforms.uFovYRad.value = (camera.fov * Math.PI) / 180;
  };
  syncViewportUniforms();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    syncViewportUniforms();
  });

  const toggles = {
    maskClass4: false,
    hideAlpha: false,
    memberStamp: false,
    dust: true,
    warp: false,
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 't') setImpl(impl === 'tsl' ? 'wgsl' : 'tsl');
    if (e.key === 'm') {
      toggles.maskClass4 = !toggles.maskClass4;
      uniforms.uSpectMask.value = toggles.maskClass4 ? 0x3ff & ~(1 << 4) : 0x3ff;
    }
    if (e.key === 'h') {
      toggles.hideAlpha = !toggles.hideAlpha;
      uniforms.uHideFocusIdx.value = toggles.hideAlpha ? ALPHA_IDX : -1;
    }
    if (e.key === 's') {
      toggles.memberStamp = !toggles.memberStamp;
      uniforms.uMemberIdx.value.x = toggles.memberStamp ? ALPHA_IDX : -1;
    }
    if (e.key === 'd') {
      toggles.dust = !toggles.dust;
      uniforms.uDustStrength.value = toggles.dust ? 1 : 0;
    }
    if (e.key === 'w') {
      toggles.warp = !toggles.warp;
      uniforms.uModelDaysPerRealSec.value = toggles.warp ? 30 : 1 / 86400;
    }
  });

  const adapterInfo =
    (renderer.backend as unknown as {
      device?: { adapterInfo?: { vendor?: string; architecture?: string } };
    }).device?.adapterInfo;
  const adapterLabel = adapterInfo
    ? `${adapterInfo.vendor} ${adapterInfo.architecture ?? ''}`
    : 'adapter info unavailable';

  let lastT = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fps = 0;
  let gpuMs = 0;
  let frameId = 0;

  const renderLoop = async () => {
    requestAnimationFrame(renderLoop);
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    lastT = now;

    uniforms.uModelDays.value += dt * uniforms.uModelDaysPerRealSec.value;
    controls.update();

    renderer.render(scene, camera);

    fpsAccum += dt;
    fpsFrames += 1;
    frameId += 1;
    if (fpsAccum >= 0.5) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }
    if (frameId % 30 === 0) {
      await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
      gpuMs = renderer.info.render.timestamp;
    }
    hud.textContent = [
      `impl: ${impl}  (t toggles — rebuilds nothing, swaps materials)`,
      `adapter: ${adapterLabel} · dpr ${dpr}`,
      `fps ${fps.toFixed(1)} · gpu.render ${gpuMs.toFixed(2)} ms (timestamp-query)`,
      `stars ${FIELD_COUNT} · reversed-z (depth32float) · near 1e-12 / far 1e5 pc`,
      `[m] mask spectral class 4: ${toggles.maskClass4}  [h] hide Alpha: ${toggles.hideAlpha}`,
      `[s] member near-stamp on Alpha: ${toggles.memberStamp}  [d] dust: ${toggles.dust}  [w] warp: ${toggles.warp}`,
    ].join('\n');
  };
  renderLoop();
}

boot().catch((err) => {
  hud.textContent = `spike boot failed: ${err}`;
  throw err;
});
