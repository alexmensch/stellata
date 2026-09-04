import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import { GPU_SAMPLES_MODULE_URL } from './measure';

type ConfigFn = (env: object) => { root: string } | Promise<{ root: string }>;

describe('GPU_SAMPLES_MODULE_URL', () => {
  it('names a file under the Vite root, where the dev server serves modules from', async () => {
    const config = await (viteConfig as unknown as ConfigFn)({
      command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false,
    });
    expect(GPU_SAMPLES_MODULE_URL.startsWith('/')).toBe(true);
    expect(existsSync(resolve(config.root, GPU_SAMPLES_MODULE_URL.slice(1)))).toBe(true);
  });
});
