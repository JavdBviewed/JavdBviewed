const path = require('node:path');
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  cacheDir: path.resolve(__dirname, 'tmp/vitest-node-cache'),
  test: {
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    environment: 'node',
    include: [
      'apps/extension/src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tests/*.test.ts',
      'tests/regression/**/*.test.ts',
    ],
    exclude: [
      'apps/extension/src/utils/__tests__/**/*.test.ts',
      'apps/extension/src/content/__tests__/**/*.test.ts',
      'apps/extension/src/services/dataAggregator/__tests__/**/*.test.ts',
      'tests/dom/**/*.test.ts',
      'tests/extension/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/node',
      include: ['apps/extension/src/**/*.ts', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        'apps/extension/src/**/*.d.ts',
        'apps/extension/src/assets/**',
        'apps/extension/src/vite-env.d.ts',
      ],
    },
  },
});
