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
/** An inline `register({ … })` call — the shell's own registrations. */
const INLINE_REGISTRATION = /\.register\(\s*\{/g;

interface Found {
  file: string;
  kind: string;
}

function scan(): { declarations: Found[]; inlineRegistrations: Map<string, number> } {
  const declarations: Found[] = [];
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
    const n = [...src.matchAll(INLINE_REGISTRATION)].length;
    if (n > 0) inlineRegistrations.set(rel, n);
  }
  return { declarations, inlineRegistrations };
}

describe('shipped scene-layer time declarations', () => {
  const { declarations, inlineRegistrations } = scan();

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
    // Eight views of moving content: the planet bodies (their own module
    // layer, plus the mesh / rings / local-cluster entries anchored to
    // them) and the binary walk (its module-less orbit entry, plus the
    // paths, star cluster and constellation figures riding the slots it
    // writes), with the probe field's marker layer alongside. Everything
    // else is fixed geometry or pure projection.
    expect(census).toEqual({ static: 10, clock: 8, realtime: 0 });
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
