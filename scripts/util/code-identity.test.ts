import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { codeIdentities, tsIdentity } from './code-identity';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'code-identity-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function pyIdentity(source: string): string {
  const path = join(dir, `m${Math.random().toString(36).slice(2)}.py`);
  writeFileSync(path, source);
  return codeIdentities([path])[path];
}

describe('tsIdentity', () => {
  const base = 'export const r = /[//]/g;\nconst t = `a ${x} // kept`;\n';

  it('ignores comments, JSDoc and layout', () => {
    expect(tsIdentity(`/** Doc. */\n// line\n${base.replace(';\n', '; /* block */\n')}`)).toBe(tsIdentity(base));
    expect(tsIdentity('export const r = /[//]/g;   const t = `a ${ x } // kept`;')).toBe(tsIdentity(base));
  });

  it('keeps a regex or template literal whole, though its text reads like a comment', () => {
    expect(tsIdentity(base.replace('// kept', '// moved'))).not.toBe(tsIdentity(base));
    expect(tsIdentity(base.replace('[//]', '[//x]'))).not.toBe(tsIdentity(base));
  });

  it('changes with any executed token', () => {
    expect(tsIdentity(base.replace('${x}', '${y}'))).not.toBe(tsIdentity(base));
  });
});

describe('Python identity', () => {
  const base = 'import os\n\ndef f(x):\n    return x + 1\n';

  it('ignores comments, docstrings, blank lines and indentation width', () => {
    const noted = '"""Module."""\n# c\nimport os  # tail\n\n\ndef f(x):\n    """Doc."""\n    return x + 1  # c\n';
    expect(pyIdentity(noted)).toBe(pyIdentity(base));
    expect(pyIdentity('import os\ndef f(x):\n        return x + 1\n')).toBe(pyIdentity(base));
  });

  it('keeps a string that is not a whole statement, and a bare f-string, which runs its fields', () => {
    expect(pyIdentity('X = "a"\n')).not.toBe(pyIdentity('X = "b"\n'));
    expect(pyIdentity('f"{g()}"\n')).not.toBe(pyIdentity(''));
  });

  it('changes with any executed token', () => {
    expect(pyIdentity(base.replace('+ 1', '+ 2'))).not.toBe(pyIdentity(base));
  });
});
