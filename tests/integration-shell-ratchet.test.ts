import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const SHELL = resolve(__dirname, '../src/client/stellata.ts');

const COMPOSITION: readonly string[] = [
  'adaptation', 'aim', 'bus', 'cadence', 'camera', 'catalog', 'chartLabels', 'chromeLines',
  'clock', 'controls', 'disposed', 'exposure', 'filters', 'floatingOrigin', 'focus',
  'hdr', 'hud', 'input', 'kinds', 'layers', 'localDepthPass', 'milkyway', 'monochrome',
  'observe', 'observeControls', 'occluders', 'orbitFramePort', 'orbitFrameTick',
  'picker', 'pois', 'renderGate', 'renderer', 'roll', 'scene', 'sharedUniforms',
  'systemMembership', 'tmpRecenter', 'warp', 'webgpu',
];

const AWAITING_EXTRACTION: readonly string[] = [
  '_compositeSuppress', '_eclipseDim', '_epochFollowDelta', '_extinctionView', '_focalPert',
  '_lastAppliedPert', '_movingRideDelta', '_movingRideIdx', '_movingRideLast',
  '_movingRideLive', '_realtimeFramesNeeded', '_rideDelta', '_rideFocalIdx',
  '_rideLive', '_suppressPulsation', '_tmpAnimateLocal', 'absorbedSuppressCount',
  'binariesData', 'binaryOrbitField', 'binaryOrbitPathLayer', 'conFigureSig',
  'constellationBoundaryLayer', 'constellationFigureLayer', 'constellationLabels',
  'constellationNamer', 'coordSpheres', 'coreMaskEnabled', 'detailPermitted',
  'drawingBufferSize', 'dust', 'dustParticleSource', 'dustParticles',
  'eclipsePhotometryField', 'extinctionPrepass', 'extinctionRecomputeForced', 'focusables',
  'frameCtx', 'frameExposureRecord', 'galacticDisc', 'glslResidentsChecked',
  'lastInvalidatedDm', 'lastParticleStrength', 'observePinQuat',
  'observeTmpFwd', 'offCatalogRecords', 'orbitRingsLayer', 'passDebugScratch',
  'pickSizeScratch', 'solarCluster', 'starAttrs', 'starFrame',
  'starLocalCluster', 'tmpBound', 'tmpConstellationAbs', 'tmpHostLocal', 'tmpVec3b',
  'trackballSettle', 'webgpuStarLayer',
];

function shellFields(): string[] {
  const source = ts.createSourceFile(SHELL, readFileSync(SHELL, 'utf8'), ts.ScriptTarget.Latest);
  const shell = source.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'Stellata');
  if (!shell) throw new Error('class Stellata not found in stellata.ts');
  return shell.members
    .filter((m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m))
    .filter((p) => !(p.initializer && ts.isArrowFunction(p.initializer)))
    .map((p) => p.name.getText(source));
}

describe('stellata.ts integration-shell ratchet', () => {
  const fields = shellFields();

  it('admits no field outside the two lists', () => {
    const allowed = new Set([...COMPOSITION, ...AWAITING_EXTRACTION]);
    expect(
      fields.filter((f) => !allowed.has(f)),
      'stellata.ts is wiring only (AGENTS.md § Folder & module conventions): new state belongs in its subsystem folder',
    ).toEqual([]);
  });

  it('lists no field the shell no longer declares', () => {
    const declared = new Set(fields);
    expect(
      [...COMPOSITION, ...AWAITING_EXTRACTION].filter((f) => !declared.has(f)),
      'an extraction deletes its fields from AWAITING_EXTRACTION',
    ).toEqual([]);
  });

  it('keeps the two lists disjoint', () => {
    const composition = new Set(COMPOSITION);
    expect(AWAITING_EXTRACTION.filter((f) => composition.has(f))).toEqual([]);
  });
});
