import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import { manualDescription, manualFreshness, pullQueryHash, requestHash } from './freshness';
import { loadTable } from './step-table/load-table';
import { pipelineTree } from './pipeline-tree';
import { holdLocks } from './locks';
import { tsManualFixture } from './manual-step-fixture';
import { recordStep, type RecordOutcome } from './record-step';
import type { ManualStep, StepEntry } from './step-table/step-table-pure';

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'record-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  write('.gitignore', '*.ckpt\n');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const at = (name: string): string => join(root, name);
function write(name: string, text: string): void {
  mkdirSync(join(at(name), '..'), { recursive: true });
  writeFileSync(at(name), text);
}

const DESCRIBE = (query: string) => `
import json, sys
from pathlib import Path
if sys.argv[1:] == ["--describe"]:
    print(json.dumps({"query": ${JSON.stringify(query)}, "services": ["esa", "ari"], "release": "DR3"}))
    sys.exit(0)
`;

/** A pull that reads req.tsv, a helper module and a git-ignored checkpoint,
 *  reports which service answered, and writes pull.tsv. */
function pull(body = ''): ManualStep {
  write('helper.py', 'VALUE = 1\n');
  write('pull.tsv.ckpt', 'cached batch\n');
  write('steps/pull.py', `${DESCRIBE('SELECT *')}
sys.path.insert(0, ${JSON.stringify(root)})
import helper
from scripts.util.build_stamp import report_service
Path(${JSON.stringify(at('req.tsv'))}).read_text()
Path(${JSON.stringify(at('pull.tsv.ckpt'))}).read_text()
report_service("ari")
Path(${JSON.stringify(at('pull.tsv'))}).write_text("rows\\n")
${body}`);
  return { name: 'refresh:pull', kind: 'pull', language: 'python', entry: at('steps/pull.py'), outputs: [at('pull.tsv')] };
}

const pythonBake = (): ManualStep => ({ name: 'build:bake', kind: 'bake', describes: false, language: 'python', entry: at('steps/bake.py'), outputs: [at('baked.bin')] });

async function record(steps: StepEntry[], name: string, force = false, args: string[] = []): Promise<RecordOutcome> {
  const loaded = await loadTable({ steps, registryFiles: [] }, { root, deriveInputs: async () => [] });
  if (loaded.kind !== 'loaded') throw new Error(loaded.problems.join('; '));
  return recordStep(loaded, { root, step: name, force, args, deriveInputs: async () => [], log: () => {} });
}

const stamp = (name: string) => JSON.parse(readFileSync(pipelineTree(root).manualStamp(name), 'utf8'));
const fresh = (step: ManualStep): string => {
  const tree = pipelineTree(root);
  return manualFreshness(step, { files: (step.outputs as string[]), families: [] }, tree, manualDescription(step, tree)).kind;
};

describe('recordStep', () => {
  it('records a pull\'s data inputs, query, answering service and release, never its code or scratch', async () => {
    write('req.tsv', 'r1\n');
    const step = pull();
    expect((await record([step], step.name)).kind).toBe('recorded');
    expect(stamp(step.name)).toEqual({
      inputs: { 'req.tsv': expect.any(String) },
      outputs: { 'pull.tsv': expect.any(String) },
      query: pullQueryHash({ query: 'SELECT *', services: ['esa', 'ari'] }),
      answeredBy: ['ari'],
      release: 'DR3',
      requestFrom: [],
    });
    expect(fresh(step)).toBe('fresh');
  });

  it('leaves the pull fresh, skips a re-run, and re-runs under --force', async () => {
    write('req.tsv', 'r1\n');
    const step = pull(`with open(${JSON.stringify(at('runs.ckpt'))}, "a") as f: f.write("run\\n")`);
    await record([step], step.name);
    expect((await record([step], step.name)).kind).toBe('fresh');
    expect((await record([step], step.name, true)).kind).toBe('recorded');
    expect(readFileSync(at('runs.ckpt'), 'utf8')).toBe('run\nrun\n');
  });

  it('stales the recorded pull when its request file or its query text changes', async () => {
    write('req.tsv', 'r1\n');
    const step = pull();
    await record([step], step.name);
    write('req.tsv', 'r2\n');
    expect(fresh(step)).toBe('stale');
    await record([step], step.name);
    write('steps/pull.py', readFileSync(at('steps/pull.py'), 'utf8').replace('"SELECT *"', '"SELECT ra"'));
    expect(fresh(step)).toBe('stale');
  });

  it('runs a step given arguments but writes no record, so what the partial run moved reads stale', async () => {
    write('req.tsv', 'r1\n');
    const step = pull(`if sys.argv[1:] == ["--only", "x"]:\n    Path(${JSON.stringify(at('pull.tsv'))}).write_text("one slice\\n")`);
    await record([step], step.name);
    const before = readFileSync(pipelineTree(root).manualStamp(step.name), 'utf8');
    expect(await record([step], step.name, false, ['--only', 'x'])).toEqual({ kind: 'partial' });
    expect(readFileSync(pipelineTree(root).manualStamp(step.name), 'utf8')).toBe(before);
    expect(fresh(step)).toBe('stale');
  });

  it('fails a run whose lock holder died and leaves the record as it was', async () => {
    write('req.tsv', 'r1\n');
    const step = pull(`import subprocess\nsubprocess.run(["pkill", "-f", ${JSON.stringify(pipelineTree(root).locks)}])`);
    expect(await record([step], step.name)).toEqual({ kind: 'failed', reason: 'its lock holder died while it ran' });
    expect(existsSync(pipelineTree(root).manualStamp(step.name))).toBe(false);
  });

  it('fails a run that writes a file it does not declare and leaves the record as it was', async () => {
    write('req.tsv', 'r1\n');
    const step = pull(`Path(${JSON.stringify(at('stray.tsv'))}).write_text("s")`);
    expect(await record([step], step.name)).toEqual({
      kind: 'failed', reason: `refresh:pull wrote ${at('stray.tsv')}, which it does not declare`,
    });
    expect(existsSync(pipelineTree(root).manualStamp(step.name))).toBe(false);
  });

  it('counts a file a pull reads only to derive its request through the request', async () => {
    write('manifest.tsv', 'b\na\n');
    write('steps/derived.py', `
import json, sys
from pathlib import Path
keys = sorted(Path(${JSON.stringify(at('manifest.tsv'))}).read_text().split())
if sys.argv[1:] == ["--describe"]:
    print(json.dumps({"query": "Q", "services": ["simbad"], "request": keys, "requestFrom": ["manifest.tsv"]}))
    sys.exit(0)
Path(${JSON.stringify(at('derived.tsv'))}).write_text("\\n".join(keys))
`);
    const step: ManualStep = { name: 'refresh:derived', kind: 'pull', language: 'python', entry: at('steps/derived.py'), outputs: [at('derived.tsv')] };
    await record([step], step.name);
    expect(stamp(step.name)).toMatchObject({ inputs: {}, request: requestHash(['a', 'b']), requestFrom: ['manifest.tsv'] });
    write('manifest.tsv', 'a\nb\n');
    expect(fresh(step)).toBe('fresh');
  });

  it('records a TypeScript pull: its derived data inputs, never its code, and the services that answered it', async () => {
    write('roster.json', '["a"]');
    const fixture = await tsManualFixture(root, {
      name: 'fetch:x', kind: { kind: 'pull' }, out: at('fetched.json'), inputs: [at('roster.json')], source: `
import { writeFileSync } from 'node:fs';
import { reportService } from ${JSON.stringify(join(REPO_ROOT, 'scripts/util/answered-by'))};
export const describe = () => ({ query: 'Q', services: ['ssd.jpl.nasa.gov'] });
export function main(): void {
  for (const name of ['mirror-b', 'mirror-a', 'mirror-b']) reportService(name);
  writeFileSync(${JSON.stringify(at('fetched.json'))}, 'rows');
}
`,
    });
    expect((await fixture.record()).kind).toBe('recorded');
    expect(stamp('fetch:x')).toMatchObject({
      inputs: { 'roster.json': expect.any(String) },
      outputs: { 'fetched.json': expect.any(String) },
      query: pullQueryHash({ query: 'Q', services: ['ssd.jpl.nasa.gov'] }),
      answeredBy: ['mirror-b', 'mirror-a'],
    });
    expect(Object.keys(stamp('fetch:x').inputs)).toEqual(['roster.json']);
  });

  it('records no file beside a TypeScript pull\'s modules: a count snapshot there is no input of the pull', async () => {
    write('roster.json', '["a"]');
    write('steps/fetch-x-expected.json', '{"rows":1}');
    const fixture = await tsManualFixture(root, {
      name: 'fetch:x', kind: { kind: 'pull' }, out: at('fetched.json'),
      inputs: [at('roster.json'), at('steps/fetch-x-expected.json')], source: `
import { writeFileSync } from 'node:fs';
export const describe = () => ({ query: 'Q', services: ['ssd.jpl.nasa.gov'] });
export function main(): void { writeFileSync(${JSON.stringify(at('fetched.json'))}, 'rows'); }
`,
    });
    expect((await fixture.record()).kind).toBe('recorded');
    expect(Object.keys(stamp('fetch:x').inputs)).toEqual(['roster.json']);
    write('steps/fetch-x-expected.json', '{"rows":2}');
    expect(fixture.freshness()).toEqual({ kind: 'fresh' });
  });

  it('hashes a TypeScript step\'s inputs before it runs, so an input edited mid-run reads stale', async () => {
    write('roster.json', '["a"]');
    const fixture = await tsManualFixture(root, {
      name: 'fetch:x', kind: { kind: 'pull' }, out: at('fetched.json'), inputs: [at('roster.json')], source: `
import { writeFileSync } from 'node:fs';
export const describe = () => ({ query: 'Q', services: ['ssd.jpl.nasa.gov'] });
export function main(): void { writeFileSync(${JSON.stringify(at('roster.json'))}, '["b"]'); writeFileSync(${JSON.stringify(at('fetched.json'))}, 'rows'); }
`,
    });
    expect((await fixture.record()).kind).toBe('recorded');
    expect(fixture.freshness()).toEqual({ kind: 'stale', changed: ['roster.json'] });
  });

  it('keeps a bake\'s code among its inputs', async () => {
    write('helper.py', 'VALUE = 1\n');
    write('src.png', 'pixels');
    write('steps/bake.py', `
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
import helper
Path(${JSON.stringify(at('baked.bin'))}).write_bytes(Path(${JSON.stringify(at('src.png'))}).read_bytes())
`);
    const step = pythonBake();
    await record([step], step.name);
    expect(Object.keys(stamp(step.name).inputs).sort()).toEqual(['helper.py', 'src.png', 'steps/bake.py']);
    write('helper.py', 'VALUE = 2\n');
    expect(fresh(step)).toBe('stale');
  });

  it('leaves a bake fresh across comment and docstring edits to the Python it imports and the TypeScript it reads', async () => {
    write('model.py', 'def scale(x):\n    return x * 2\n');
    write('ladder.ts', 'export const LADDER = [1, 2];\n');
    write('steps/bake.py', `
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
import model
rungs = Path(${JSON.stringify(at('ladder.ts'))}).read_text().split("[")[1].split("]")[0]
Path(${JSON.stringify(at('baked.bin'))}).write_text(f"{model.scale(1)} {rungs}")
`);
    const step = pythonBake();
    await record([step], step.name);
    write('model.py', '"""Cloud model."""\n\n# Doubles.\ndef scale(x):\n    """Twice x."""\n    return x * 2  # exact\n');
    write('ladder.ts', '/** Rungs. */\nexport const LADDER = [1, 2]; // generated\n');
    expect(fresh(step)).toBe('fresh');
    write('ladder.ts', 'export const LADDER = [1, 3];\n');
    expect(fresh(step)).toBe('stale');
    write('ladder.ts', 'export const LADDER = [1, 2];\n');
    write('model.py', 'def scale(x):\n    return x * 3\n');
    expect(fresh(step)).toBe('stale');
  });

  const projectingBake = (others: StepEntry[] = []) => tsManualFixture(root, {
    name: 'build:bake', kind: { kind: 'bake', describes: true }, out: at('surfaces.bin'), inputs: [at('clouds.json')], others, source: `
import { readFile, writeFile } from 'node:fs/promises';
const shape = async () => JSON.parse(await readFile(${JSON.stringify(at('clouds.json'))}, 'utf8')).shape;
export const describe = async () => ({ request: [await shape()], requestFrom: ['clouds.json'] });
export async function main(): Promise<void> { await writeFile(${JSON.stringify(at('surfaces.bin'))}, await shape()); }
`,
  });

  it('records a TypeScript bake through the projection its async describe prints, and freshens it on a re-run', async () => {
    write('clouds.json', '{"shape": "ellipse", "sid": 1}');
    const fixture = await projectingBake();

    expect((await fixture.record()).kind).toBe('recorded');
    expect(stamp('build:bake')).toEqual({
      inputs: { 'steps/build-bake.ts': expect.any(String) },
      outputs: { 'surfaces.bin': expect.any(String) },
      request: requestHash(['ellipse']),
      requestFrom: ['clouds.json'],
    });
    write('clouds.json', '{"shape": "ellipse", "sid": 2}');
    expect(fixture.freshness().kind).toBe('fresh');
    write('clouds.json', '{"shape": "torus", "sid": 2}');
    expect(fixture.freshness().kind).toBe('stale');
    expect((await fixture.record()).kind).toBe('recorded');
    expect(fixture.freshness().kind).toBe('fresh');
  });

  it('holds a first record behind the build writing the file its describe projects, though no record names that file yet', async () => {
    write('clouds.json', '{"shape": "ellipse"}');
    write('steps/writer-outputs.ts', `
import { declareOutputs } from ${JSON.stringify(join(REPO_ROOT, 'scripts/util/emit-artifacts'))};
export const OUT = declareOutputs({ out: ${JSON.stringify(at('clouds.json'))} });
`);
    const writer: StepEntry = {
      name: 'build:writer', kind: 'build', language: 'ts', entry: at('steps/writer.ts'), outputs: { module: at('steps/writer-outputs.ts'), name: 'OUT' },
    };
    const fixture = await projectingBake([writer]);
    const building = await holdLocks(pipelineTree(root).locks, { step: 'build:writer', exclusive: true, shared: [] }, () => {});
    let settled = false;
    const recording = fixture.record().then((outcome) => { settled = true; return outcome; });
    await new Promise((done) => { setTimeout(done, 300); });
    expect(settled).toBe(false);
    await building.release();
    expect((await recording).kind).toBe('recorded');
  });
});

describe('recordStep — what a Python step listed and probed', () => {
  function bake(body: string): ManualStep {
    write('steps/bake.py', `
import os
from pathlib import Path
${body}
Path(${JSON.stringify(at('baked.bin'))}).write_text("baked")
`);
    return pythonBake();
  }
  const lists = (dir: string): string => `os.listdir(${JSON.stringify(at(dir))})`;

  it('stales the step when a folder it listed gains a file', async () => {
    write('folder/one', '');
    const step = bake(lists('folder'));
    await record([step], step.name);
    expect(fresh(step)).toBe('fresh');
    write('folder/two', '');
    expect(fresh(step)).toBe('stale');
  });

  it('leaves a git-ignored name out of a listing, so a local cache neither stales nor freshens the step', async () => {
    write('.gitignore', 'folder/.cache*\n');
    write('folder/one', '');
    write('folder/.cache-a', '');
    const step = bake(lists('folder'));
    await record([step], step.name);
    rmSync(at('folder/.cache-a'));
    write('folder/.cache-b', '');
    expect(fresh(step)).toBe('fresh');
  });

  it('records no input for a listed folder git ignores', async () => {
    write('.gitignore', 'scratch/\n');
    write('scratch/one', '');
    const step = bake(lists('scratch'));
    await record([step], step.name);
    expect(stamp(step.name).recorded.listings).toEqual({});
    write('scratch/two', '');
    expect(fresh(step)).toBe('fresh');
  });

  it('records no input for a git-ignored folder the step listed and then deleted', async () => {
    write('.gitignore', 'scratch/\n');
    write('scratch/one', '');
    const step = bake(`${lists('scratch')}\nimport shutil\nshutil.rmtree(${JSON.stringify(at('scratch'))})`);
    await record([step], step.name);
    expect(stamp(step.name).recorded.listings).toEqual({});
    expect(fresh(step)).toBe('fresh');
  });

  it('stales the step when a path it probed appears', async () => {
    const step = bake(`from scripts.util.build_stamp import probe\nprobe(Path(${JSON.stringify(at('maybe.txt'))}))`);
    await record([step], step.name);
    expect(fresh(step)).toBe('fresh');
    write('maybe.txt', '');
    expect(fresh(step)).toBe('stale');
  });
});
