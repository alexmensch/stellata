import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import { FRAME_COST_MODULE_URL, GPU_SAMPLES_MODULE_URL } from './measure';

type ConfigFn = (env: object) => { root: string } | Promise<{ root: string }>;

describe('the module URLs a dwell imports through the dev server', () => {
  it.each([GPU_SAMPLES_MODULE_URL, FRAME_COST_MODULE_URL])(
    '%s names a file under the Vite root, where the dev server serves modules from',
    async (url) => {
      const config = await (viteConfig as unknown as ConfigFn)({
        command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false,
      });
      expect(url.startsWith('/')).toBe(true);
      expect(existsSync(resolve(config.root, url.slice(1)))).toBe(true);
    },
  );
});
