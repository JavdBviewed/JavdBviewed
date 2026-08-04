const path = require('node:path');
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  cacheDir: path.resolve(__dirname, 'tmp/vitest-extension-cache'),
  test: {
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    environment: 'jsdom',
    testTimeout: 60000,
    environmentOptions: {
      jsdom: {
        url: 'https://javdb.com/v/abc123',
      },
    },
    include: ['tests/extension/**/*.test.ts'],
    setupFiles: ['tests/setup/chrome.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage/extension',
      include: [
        'apps/extension/src/content/taskRuntime.ts',
        'apps/extension/src/content/pageContext.ts',
        'apps/extension/src/shared/taskCenterProtocol.ts',
        'apps/extension/src/utils/storage.ts',
        'apps/extension/src/manifest.json',
      ],
      exclude: ['**/*.test.ts'],
    },
  },
});
