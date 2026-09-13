// Scans the SHIPPED scene-layer registrations for their `timeBehaviour`
// declaration. See src/client/scene/README.md § Declaring how time moves
// a layer, and src/client/render-gate/README.md § The clock cadence.
//
// A source scan rather than a unit test over a synthetic registry, because
// what needs pinning is a property of the layers that actually register:
// the live registry needs WebGL to build, and a registry a test assembles
// itself proves nothing about the one the app runs. The invariant used to
// be asserted in three READMEs and enforced by nothing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const SCAN_DIR = resolve(ROOT, 'src');
const SHELL = 'src/client/stellata.ts';

/** `timeBehaviour: { kind: 'x'`, with or without a comment line between. */
const DECLARATION = /timeBehaviour\s*:\s*\{\s*(?:\/\/[^\n]*\n\s*)?kind\s*:\s*'(\w+)'/g;
/** `contribution: { kind: 'x'`, same allowance for a comment line. */
const CONTRIBUTION = /contribution\s*:\s*\{\s*(?:\/\/[^\n]*\n\s*)?kind\s*:\s*'(\w+)'/g;
/** An inline `register({ … })` call — the shell's own registrations. */
const INLINE_REGISTRATION = /\.register\(\s*\{/g;

interface Found {
  file: string;
  kind: string;
}

function scan(): {
  declarations: Found[];
  contributions: Found[];
  inlineRegistrations: Map<string, number>;
} {
  const declarations: Found[] = [];
  const contributions: Found[] = [];
  const inlineRegistrations = new Map<string, number>();
  const files = walkFiles(SCAN_DIR, {
    // Test files and fixtures build their own registries on purpose; the
    // shipped roster is what this pins.
    include: (p) => /\.ts$/.test(p)
      && !p.endsWith('.d.ts') && !/\.test\.ts$/.test(p) && !/-mock\.ts$/.test(p),
    skipDir: (name) => ['node_modules', 'dist', '.vite', 'coverage'].includes(name),
  });
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    for (const m of src.matchAll(DECLARATION)) declarations.push({ file: rel, kind: m[1] });
    for (const m of src.matchAll(CONTRIBUTION)) contributions.push({ file: rel, kind: m[1] });
    const n = [...src.matchAll(INLINE_REGISTRATION)].length;
    if (n > 0) inlineRegistrations.set(rel, n);
  }
  return { declarations, contributions, inlineRegistrations };
}

const { declarations, contributions, inlineRegistrations } = scan();

describe('shipped scene-layer time declarations', () => {

  it('finds the roster at all — a scan that matches nothing proves nothing', () => {
    expect(declarations.length).toBeGreaterThan(10);
    expect(inlineRegistrations.get(SHELL)).toBeGreaterThan(10);
  });

  it('every declaration is one of the three kinds', () => {
    const unknown = declarations.filter(
      (d) => !['static', 'clock', 'realtime'].includes(d.kind));
    expect(unknown).toEqual([]);
  });

  it('NO layer declares realtime — the count is zero and stays zero', () => {
    // `realtime` defeats idling for as long as its predicate holds, so it
    // is the one declaration that can quietly undo this whole feature. A
    // layer that thinks it needs wall-clock frames should converge over a
    // count of RENDERED frames instead: an N-frame blend looks the same at
    // 60 Hz and at one frame per 30 s.
    //
    // Adding one is a deliberate act with a written argument, not a line
    // that slips through review — which is what this failing test is for.
    expect(declarations.filter((d) => d.kind === 'realtime')).toEqual([]);
  });

  it('the static / clock split is pinned, so a silent flip fails here', () => {
    const census: Record<string, number> = { static: 0, clock: 0, realtime: 0 };
    for (const d of declarations) census[d.kind]++;
    // Ten views of moving content: the planet bodies (their own module
    // layer, plus the focal-ride / mesh / rings / local-cluster entries
    // anchored to them) and the binary walk (its module-less orbit entry,
    // plus the paths, star cluster, constellation figures and the star
    // core mask riding the slots it writes), with the probe field's marker
    // layer alongside. Everything else is fixed geometry, pure projection,
    // or the orbit lock's sequencing-only entry — which draws nothing, so
    // it must never ask the cadence for a frame of its own.
    expect(census).toEqual({ static: 11, clock: 10, realtime: 0 });
  });

  it('every inline register({...}) in the shell carries a declaration', () => {
    // The type already refuses a layer without one. This catches the other
    // direction — an entry added with its declaration copied off a
    // neighbour by hand, where the count is the only thing that moves.
    const inShell = declarations.filter((d) => d.file === SHELL);
    expect(inShell.length).toBe(inlineRegistrations.get(SHELL));
  });

  it('every kind module that returns a layer declares one too', () => {
    // Module layers are registered by the shell's roster loop, so they
    // have no `register({` of their own to count against. There are five
    // that attach a layer (star returns null — its render layers are
    // shell-wired engine machinery, ../src/client/kinds/README.md).
    const moduleDecls = declarations.filter((d) => d.file.endsWith('-module.ts'));
    expect(moduleDecls.length).toBe(5);
  });
});

describe('shipped scene-layer contribution declarations', () => {
  // Same shape as the time census above, for the same reason: the type
  // refuses a layer without the declaration, and this pins what the
  // shipped roster actually declares (src/client/scene/README.md
  // § Declaring what a layer can put on screen).

  it('every declaration is one of the two kinds', () => {
    const unknown = contributions.filter((d) => !['always', 'gated'].includes(d.kind));
    expect(unknown).toEqual([]);
  });

  it('every layer that declares a time behaviour declares a contribution too', () => {
    expect(contributions.length).toBe(declarations.length);
  });

  it('the always / gated split is pinned, so a silent flip fails here', () => {
    // Eight gated: molecular clouds, the probe fleet, the boundary shells,
    // the galactic disc, the planet mesh LOD, the star core mask, and the
    // two diffuse emitters on the brightness test — the Milky Way band and
    // the Local Group pair. The refusals are deliberate and argued in
    // src/client/scene/README.md § Declaring what a layer can put on
    // screen: a coordinate sphere is camera-tracked at 50 kpc, so no
    // admissible test can ever fire on it.
    const census: Record<string, number> = { always: 0, gated: 0 };
    for (const d of contributions) census[d.kind]++;
    expect(census).toEqual({ always: 13, gated: 8 });
  });

  it('every inline register({...}) in the shell carries one', () => {
    const inShell = contributions.filter((d) => d.file === SHELL);
    expect(inShell.length).toBe(inlineRegistrations.get(SHELL));
  });

  it('every kind module that returns a layer declares one too', () => {
    const moduleDecls = contributions.filter((d) => d.file.endsWith('-module.ts'));
    expect(moduleDecls.length).toBe(5);
  });
});

// The core mask's `shouldEnableCoreMask` walk moved INSIDE its contribution
// predicate, and that walk is what the `coreMask` frame-cost lever's own A/B
// prices (src/client/debug/frame-cost/passes/README.md). A predicate running
// it before consulting the lever pays it on both sides of the A/B, so the row
// prices nothing — and nothing else can see that, since both orderings
// compile and both draw the same frame.
describe('the core-mask predicate refuses above the walk its lever prices', () => {
  const shell = readFileSync(resolve(ROOT, SHELL), 'utf8');

  it('consults coreMaskEnabled before marking the walk', () => {
    const guard = shell.indexOf('if (!this.coreMaskEnabled) return null;');
    const mark = shell.indexOf("perfMark('coreMask')");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(mark);
  });

  it('marks the walk exactly once, so the row is one predicate call', () => {
    expect(shell.match(/perfMark\('coreMask'\)/g)).toHaveLength(1);
  });
});
