import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'],
    // Corpus suites sweep the whole 380k-record catalog; vitest's 5 s
    // default is a unit-test ceiling they cross under parallel load.
    // See tests/README.md § Suite-wide timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/client/**/*.ts', 'scripts/**/*.ts'],
      exclude: [
        'src/client/main.ts',
        'src/client/stellata.ts',
        'src/client/**/*.glsl',
        'src/worker.ts',
        '**/*.test.ts',
        '**/*.d.ts',
        'scripts/dust/sync-dust.ts',
        'scripts/catalog/validate/verify-catalog.ts',
      ],
    },
  },
});
