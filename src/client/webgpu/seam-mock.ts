// WebGpuSeam test double. See README.md § Files in this area.

import type { WebGpuSeam, WebGpuPlanetGlare } from './seam';

function refuse(name: string): never {
  throw new Error(`fakeWebGpuSeam: ${name} reached without an override`);
}

/** Every member present, and every one that a suite has not supplied
 *  refuses by name. An empty object cast to the seam hands a kind
 *  `undefined` instead, which surfaces as a crash somewhere else or as a
 *  suite staying green over a leg it never wired. */
export function fakeWebGpuSeam(overrides: Partial<WebGpuSeam> = {}): WebGpuSeam {
  const base: WebGpuSeam = {
    get renderer(): WebGpuSeam['renderer'] { return refuse('renderer'); },
    timestampsAvailable: false,
    get hdr(): WebGpuSeam['hdr'] { return refuse('hdr'); },
    uniformNodes: null,
    bindSharedUniforms: () => refuse('bindSharedUniforms'),
    syncUniformNodes: () => refuse('syncUniformNodes'),
    attachStarLayer: () => refuse('attachStarLayer'),
    setDustTexture: () => refuse('setDustTexture'),
    onOutOfMemory: () => refuse('onOutOfMemory'),
    uploadTexture: () => refuse('uploadTexture'),
    attachExtinctionPrepass: () => refuse('attachExtinctionPrepass'),
    dispose: () => {},
    solarSystemMaterials: () => refuse('solarSystemMaterials'),
    get probeMaterial(): WebGpuSeam['probeMaterial'] { return refuse('probeMaterial'); },
    get chromeLineMaterials(): WebGpuSeam['chromeLineMaterials'] {
      return refuse('chromeLineMaterials');
    },
    get shellMaterials(): WebGpuSeam['shellMaterials'] { return refuse('shellMaterials'); },
    get dustParticleMaterials(): WebGpuSeam['dustParticleMaterials'] {
      return refuse('dustParticleMaterials');
    },
    get cloudMaterials(): WebGpuSeam['cloudMaterials'] { return refuse('cloudMaterials'); },
    get lgEmissionMaterials(): WebGpuSeam['lgEmissionMaterials'] {
      return refuse('lgEmissionMaterials');
    },
    get bandMaterials(): WebGpuSeam['bandMaterials'] { return refuse('bandMaterials'); },
    attachPlanetGlare: () => refuse('attachPlanetGlare'),
  };
  return Object.defineProperties(
    base,
    Object.getOwnPropertyDescriptors(overrides),
  ) as WebGpuSeam;
}

export interface FakePlanetGlare {
  glare: WebGpuPlanetGlare;
  monochrome: boolean[];
  visible: boolean[];
  disposed: boolean;
}

/** Records what the module drove the glare with. Typed as the interface,
 *  so a suite cannot declare a method the real glare does not have. */
export function fakePlanetGlare(): FakePlanetGlare {
  const record: FakePlanetGlare = {
    monochrome: [],
    visible: [],
    disposed: false,
    glare: {
      setMonochrome: (on) => { record.monochrome.push(on); },
      setVisible: (on) => { record.visible.push(on); },
      dispose: () => { record.disposed = true; },
    },
  };
  return record;
}
