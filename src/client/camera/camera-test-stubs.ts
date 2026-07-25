// Shared doubles for the camera controller tests: TrackballControls,
// ObserveControls, AimController. Each carries the union of the fields
// the five controllers touch, so one builder serves every suite.

import * as THREE from 'three';
import { vi } from 'vitest';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { AimController } from './controls/aim-controller';
import type { ObserveControls } from './observe/observe-controls';

export type ControlsStub = TrackballControls & {
  update: ReturnType<typeof vi.fn>;
};

export function makeControlsStub(): ControlsStub {
  return {
    enabled: true,
    target: new THREE.Vector3(0, 0, 0),
    minDistance: 0,
    update: vi.fn(),
  } as unknown as ControlsStub;
}

export type ObserveControlsStub = ObserveControls & {
  enable: ReturnType<typeof vi.fn>;
  disable: ReturnType<typeof vi.fn>;
};

export function makeObserveControlsStub(): ObserveControlsStub {
  return {
    enable: vi.fn(),
    disable: vi.fn(),
  } as unknown as ObserveControlsStub;
}

export type AimStub = AimController & {
  cancel: ReturnType<typeof vi.fn>;
  isActive: ReturnType<typeof vi.fn>;
};

export function makeAimStub(): AimStub {
  return {
    cancel: vi.fn(),
    isActive: vi.fn(() => false),
  } as unknown as AimStub;
}
