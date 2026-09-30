import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isProductionTs, walkFiles } from './walk-files';

const CLIENT = fileURLToPath(new URL('../src/client', import.meta.url));
const sources = [...walkFiles(CLIENT, { include: isProductionTs })].map((p) => relative(CLIENT, p));

const WINDOW_WRITE =
  /\bwindow\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)|\(\s*window\s+as\b[^)]*\)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)|(?:Object\.assign|Reflect\.set|Object\.defineProperty)\(\s*window\b/;

describe('window globals under src/client', () => {
  it('scans the client tree', () => {
    expect(sources).toContain(join('util', 'page-teardown.ts'));
  });

  it('are assigned only through expose', () => {
    const writers = sources.filter((f) =>
      readFileSync(join(CLIENT, f), 'utf8').split('\n').some((line) => WINDOW_WRITE.test(line)));
    expect(writers).toEqual([]);
  });

  it.each([
    'window.foo = 1;',
    "window['foo'] = x;",
    '(window as unknown as { foo: X }).foo = x;',
    'Object.assign(window, { foo });',
  ])('flags %s', (line) => {
    expect(WINDOW_WRITE.test(line)).toBe(true);
  });

  it.each([
    'if (window.foo === 1) {}',
    'const w = window.innerWidth;',
    'window.addEventListener("resize", f);',
  ])('passes %s', (line) => {
    expect(WINDOW_WRITE.test(line)).toBe(false);
  });
});

const GLOBAL_TARGETS = new Set(['window', 'document']);

interface ListenerCall {
  method: string;
  key: string;
  hasSignal: boolean;
}

function listenerCalls(source: string): ListenerCall[] {
  const file = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true);
  const calls: ListenerCall[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && GLOBAL_TARGETS.has(node.expression.expression.text)
      && (node.expression.name.text === 'addEventListener' || node.expression.name.text === 'removeEventListener')
    ) {
      const [event, , options] = node.arguments;
      const eventName = event !== undefined && ts.isStringLiteralLike(event) ? event.text : '<dynamic>';
      calls.push({
        method: node.expression.name.text,
        key: `${node.expression.expression.text}:${eventName}`,
        hasSignal: options !== undefined && ts.isObjectLiteralExpression(options)
          && options.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'signal'),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

function unreleasedListeners(source: string): string[] {
  const calls = listenerCalls(source);
  const removed = new Set(calls.filter((c) => c.method === 'removeEventListener').map((c) => c.key));
  return calls
    .filter((c) => c.method === 'addEventListener' && !c.hasSignal && !removed.has(c.key))
    .map((c) => c.key);
}

describe('window and document listeners under src/client', () => {
  it('each pass the teardown signal or are removed in their own file', () => {
    const offenders = sources.flatMap((f) =>
      unreleasedListeners(readFileSync(join(CLIENT, f), 'utf8')).map((key) => `${f} ${key}`));
    expect(offenders).toEqual([]);
  });

  it.each([
    ["window.addEventListener('keydown', (e) => { f(e); });", ['window:keydown']],
    ["document.addEventListener('keydown', f, { capture: true });", ['document:keydown']],
    ["window.addEventListener('resize', f); window.removeEventListener('blur', f);", ['window:resize']],
  ])('flags %s', (source, expected) => {
    expect(unreleasedListeners(source)).toEqual(expected);
  });

  it.each([
    "window.addEventListener('keydown', (e) => { f(e); }, { capture: true, signal });",
    "window.addEventListener('resize', f, { signal: deps.signal });",
    "window.addEventListener('resize', f); window.removeEventListener('resize', f);",
    "canvas.addEventListener('pointerdown', f);",
  ])('passes %s', (source) => {
    expect(unreleasedListeners(source)).toEqual([]);
  });
});
