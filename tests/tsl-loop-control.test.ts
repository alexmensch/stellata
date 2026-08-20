// Loop-control roster for TSL: a concise arrow returns its expression, so
// `() => Break()` hands the break node back as the branch's OUTPUT and the
// generator emits it a second time. The duplicate is unreachable WGSL and
// the browser warns on every boot. Braces are the whole fix.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');

const GUIDANCE =
  'returns a TSL Break()/Continue() as a branch value. Brace the arrow body '
  + "— `() => { Break(); }` — so it yields void. Where the loop's exit is a "
  + 'plain condition rather than a jump, prefer wrapping the body in `If()` '
  + 'and emitting no jump at all (the summation convolution does this).';

// The arrow forms that leak the node: an unbraced body, and an explicit
// return. A braced body is the correct form and must not match.
const LEAK_FORMS = [
  /=>\s*(?:Break|Continue)\s*\(/,
  /\breturn\s+(?:Break|Continue)\s*\(/,
];

export function returnsTslLoopJump(src: string): boolean {
  return LEAK_FORMS.some((re) => re.test(src));
}

const isProductionTs = (p: string) =>
  p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts');

describe('TSL loop-control roster', () => {
  it('no module returns a loop jump as a branch value', () => {
    const offenders = [...walkFiles(join(ROOT, 'src'), { include: isProductionTs })]
      .filter((p) => returnsTslLoopJump(readFileSync(p, 'utf8')))
      .map((p) => `${relative(ROOT, p)} ${GUIDANCE}`);
    expect(offenders).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('catches the arrow forms that emit the jump twice', () => {
    expect(returnsTslLoopJump('If(done, () => Break())')).toBe(true);
    expect(returnsTslLoopJump('If(done, () => Continue())')).toBe(true);
    expect(returnsTslLoopJump('If(done, () =>\n  Break())')).toBe(true);
    expect(returnsTslLoopJump('Fn(() => { return Break(); })')).toBe(true);
  });

  it('leaves the braced form and unrelated identifiers alone', () => {
    expect(returnsTslLoopJump('If(done, () => { Break(); })')).toBe(false);
    expect(returnsTslLoopJump('If(done, () => { Continue(); })')).toBe(false);
    expect(returnsTslLoopJump('const onBreak = () => breakSomething();')).toBe(false);
    expect(returnsTslLoopJump('return Breakpoint(x);')).toBe(false);
  });
});
