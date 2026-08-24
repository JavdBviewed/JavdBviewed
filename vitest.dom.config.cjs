const path = require('node:path');
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  cacheDir: path.resolve(__dirname, 'tmp/vitest-dom-cache'),
  test: {
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    environment: 'jsdom',
    testTimeout: 20000,
    include: ['tests/dom/**/*.test.ts', 'tests/dom/**/*.test.tsx'],
    setupFiles: ['tests/setup/proxy.ts', 'tests/setup/dom.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/dom',
      include: ['apps/extension/src/dashboard/components/**/*.ts', 'apps/extension/src/dashboard/ui/**/*.ts', 'apps/extension/src/components/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
});
