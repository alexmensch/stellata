import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { releaseAt, releaseCommitAt, releaseOn, versionOfTag } from './release-version';

describe('versionOfTag', () => {
  it('strips the prefix of a release tag', () => {
    expect(versionOfTag('v7.1.15')).toBe('7.1.15');
  });

  it('refuses a tag that is not one', () => {
    expect(() => versionOfTag('7.1.15')).toThrow(/not a release version/);
    expect(() => versionOfTag('v7.1')).toThrow(/not a release version/);
    expect(() => versionOfTag('v7.1.15-rc.1')).toThrow(/not a release version/);
  });
});

describe('releaseAt', () => {
  let repo: string;
  const git = (...argv: string[]) => execFileSync('git', argv, { cwd: repo, encoding: 'utf-8' }).trim();
  const identity = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
  const commit = (message: string) => git(...identity, 'commit', '--allow-empty', '-q', '-m', message);
  const tag = (name: string) => git(...identity, 'tag', '-a', name, '-m', name);

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'release-version-'));
    git('init', '-q');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('is the newest release tag reachable from the ref, ignoring other tags', () => {
    commit('one');
    tag('v1.0.0');
    commit('two');
    tag('v1.1.0');
    commit('three');
    tag('not-a-release');
    expect(releaseAt('HEAD', repo)).toBe('1.1.0');
    expect(releaseAt('HEAD~1', repo)).toBe('1.1.0');
    expect(releaseAt('HEAD~2', repo)).toBe('1.0.0');
  });

  it('throws where no release tag is reachable', () => {
    commit('one');
    expect(() => releaseAt('HEAD', repo)).toThrow(/^no release tag reachable from HEAD: fetch tags/);
    expect(() => releaseCommitAt('HEAD', repo)).toThrow(/^no release tag reachable from HEAD/);
  });

  it('reads the release a commit was tagged as, newest by version, and null where none was cut', () => {
    commit('one');
    tag('v7.1.9');
    tag('v7.1.10');
    tag('not-a-release');
    commit('two');
    expect(releaseOn('HEAD~1', repo)).toBe('7.1.10');
    expect(releaseOn('HEAD', repo)).toBeNull();
  });

  it('names the commit the newest reachable release was cut at, past any unreleased commits', () => {
    commit('one');
    tag('v1.0.0');
    commit('two');
    const released = git('rev-parse', 'HEAD');
    tag('v1.0.1');
    commit('three');
    commit('four');
    expect(releaseCommitAt('HEAD', repo)).toBe(released);
    expect(releaseCommitAt('HEAD~2', repo)).toBe(released);
  });
});

describe('the release tags are the one source of the version', () => {
  it('package.json states none', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as object;
    expect(manifest).not.toHaveProperty('version');
  });
});

describe('runs under plain node, with nothing installed', () => {
  it('imports only node builtins', () => {
    const source = readFileSync(resolve(__dirname, 'release-version.ts'), 'utf-8');
    for (const [, spec] of source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      expect(spec, `release-version.ts imports ${spec}`).toMatch(/^node:/);
    }
  });
});
