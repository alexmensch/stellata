// Top-level argument list of a call in GLSL source, for the drift tests
// that pin what a shader passes where. See README.md.

const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

/**
 * The top-level arguments of the first `name(` call in `src`. Walks the
 * parens rather than matching a regex, so a nested call in an earlier slot
 * cannot split the list in the wrong place.
 *
 * The match is whole-identifier: callers assert on argument text, so a hit
 * inside a longer name would pin a different call and still pass.
 */
export function glslCallArgs(src: string, name: string): string[] {
  let open = src.indexOf(`${name}(`);
  while (open > 0 && IDENTIFIER_CHAR.test(src[open - 1])) {
    open = src.indexOf(`${name}(`, open + 1);
  }
  if (open < 0) throw new Error(`no ${name}( in shader`);
  const args: string[] = [];
  let depth = 1;
  let start = open + name.length + 1;
  for (let i = start; depth > 0; i++) {
    const c = src[i];
    if (c === undefined) throw new Error(`unbalanced ${name}( in shader`);
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
    if (depth === 0) args.push(src.slice(start, i).trim());
  }
  return args;
}
