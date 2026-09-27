import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const SHELL = resolve(__dirname, '../src/client/stellata.ts');

const COMPOSITION: readonly string[] = [
  'adaptation', 'aim', 'binaries', 'bus', 'cadence', 'camera', 'cameraClaim', 'catalog', 'chartLabels', 'chromeLines',
  'clock', 'constellationBoundaries', 'controls', 'coordSpheres', 'declutter', 'disposed', 'exposure', 'extinction', 'exposureFrame', 'filters',
  'floatingOrigin', 'focalRides', 'focus', 'focusables', 'hdr', 'hud', 'input', 'kinds', 'layers', 'localDepthPass', 'milkyway', 'monochrome',
  'observe', 'observeControls', 'observeLookPin', 'occluders', 'orbitFramePort', 'orbitFrameTick',
  'picker', 'pois', 'renderGate', 'renderer', 'roll', 'scene', 'sharedUniforms',
  'solarSystem', 'systemMembership', 'tmpRecenter', 'warp', 'webgpu',
];

const AWAITING_EXTRACTION: readonly string[] = [
  '_epochFollowDelta',
  '_realtimeFramesNeeded', '_suppressPulsation', 'absorbedSuppressCount',
  'conFigureSig',
  'constellationFigureLayer', 'coreMaskEnabled',
  'frameCtx', 'glslResidentsChecked',
  'offCatalogRecords', 'passDebugScratch',
  'pickSizeScratch', 'starAttrs', 'starFrame', 'starSizeInputs',
  'starLocalCluster',
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

const isFunctionLike = (n: ts.Node) =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);

/** `this.X` for a node that is exactly that property access. */
const thisMember = (n: ts.Node): string | null =>
  ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword
    ? n.name.text : null;

/** Visits `node`'s subtree in evaluation order, never entering a nested
 *  function: a callback runs later, not where it is written. */
function walkEager(node: ts.Node, visit: (n: ts.Node) => void): void {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    walkEager(node.right, visit);
    visit(node);
    return;
  }
  visit(node);
  ts.forEachChild(node, (c) => { if (!isFunctionLike(c)) walkEager(c, visit); });
}

/** Each constructor call `this.m()` that reaches a field the constructor has
 *  not assigned yet, directly or through the methods `m` calls. */
function readsBeforeAssignment(file: string, text: string, className: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === className);
  if (!cls) throw new Error(`class ${className} not found`);
  const late = new Set(cls.members
    .filter((m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && !m.initializer)
    .map((m) => m.name.getText(source)));
  const methods = new Map(cls.members
    .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && m.body !== undefined)
    .map((m) => [m.name.getText(source), m.body!] as const));
  const reach = new Map<string, Set<string>>();
  const fieldsReached = (name: string): Set<string> => {
    const known = reach.get(name);
    if (known) return known;
    const out = new Set<string>();
    reach.set(name, out);
    walkEager(methods.get(name)!, (n) => {
      const member = thisMember(n);
      if (member === null) return;
      if (late.has(member)) out.add(member);
      else if (methods.has(member) && ts.isCallExpression(n.parent) && n.parent.expression === n) {
        for (const f of fieldsReached(member)) out.add(f);
      }
    });
    return out;
  };
  const ctor = cls.members.find(ts.isConstructorDeclaration);
  if (!ctor?.body) return [];
  const assigned = new Set<string>();
  const offenders: string[] = [];
  walkEager(ctor.body, (n) => {
    if (ts.isBinaryExpression(n)) {
      const member = thisMember(n.left);
      if (member !== null) assigned.add(member);
      return;
    }
    const member = thisMember(n);
    if (member === null || !methods.has(member)) return;
    if (!ts.isCallExpression(n.parent) || n.parent.expression !== n) return;
    const missing = [...fieldsReached(member)].filter((f) => !assigned.has(f));
    if (missing.length > 0) offenders.push(`${member}() reads ${missing.sort().join(', ')}`);
  });
  return offenders;
}

describe('stellata.ts constructor order', () => {
  it('calls no method before the fields it reads are assigned', () => {
    expect(
      readsBeforeAssignment(SHELL, readFileSync(SHELL, 'utf8'), 'Stellata'),
      'construct what a method reads before the constructor calls it — typecheck cannot see through the call',
    ).toEqual([]);
  });

  it('sees a read through a called method, and not one inside a callback', () => {
    const probe = [
      'class P {',
      '  a: number; b: number;',
      '  constructor() {',
      '    this.on(() => this.useB());',
      '    this.useA();',
      '    this.a = 1; this.b = 2;',
      '    this.useA();',
      '  }',
      '  on(f: () => void) {}',
      '  useA() { this.inner(); }',
      '  inner() { return this.a; }',
      '  useB() { return this.b; }',
      '}',
    ].join('\n');
    expect(readsBeforeAssignment('probe.ts', probe, 'P')).toEqual(['useA() reads a']);
  });
});

describe('stellata.ts integration-shell ratchet', () => {
  const fields = shellFields();

  it('admits no field outside the two lists', () => {
    const allowed = new Set([...COMPOSITION, ...AWAITING_EXTRACTION]);
    expect(
      fields.filter((f) => !allowed.has(f)),
      'stellata.ts is wiring only (/AGENTS.md#folder--module-conventions--where-new-code-lands): new state belongs in its subsystem folder',
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
