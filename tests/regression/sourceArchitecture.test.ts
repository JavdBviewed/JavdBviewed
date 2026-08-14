/**
 * @file sourceArchitecture.test.ts
 * @description source architecture cleanup 测试
 * @module tests/regression
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function listSourceFiles(dir: string): string[] {
  const absoluteDir = path.resolve(root, dir);
  const result: string[] = [];
  const visit = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) {
        result.push(absolutePath);
      }
    }
  };
  visit(absoluteDir);
  return result;
}

function readRelativeImports(source: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) imports.push(specifier);
    }
  }

  return imports;
}

function resolveImportPath(fromFile: string, specifier: string): string {
  return path.relative(root, path.resolve(path.dirname(fromFile), specifier)).replace(/\\/g, '/');
}

describe('source architecture cleanup', () => {
  it('keeps generated background backup snapshots out of apps/extension/src/background', () => {
    const backgroundDir = path.resolve(root, 'apps/extension/src/background');
    const backupFiles = fs
      .readdirSync(backgroundDir)
      .filter((file) => file.endsWith('.bak') || /^background\.ts\.step/.test(file));

    expect(backupFiles).toEqual([]);
  });

  it('keeps test files out of apps/extension/src/background', () => {
    const backgroundDir = path.resolve(root, 'apps/extension/src/background');
    const testFiles = fs
      .readdirSync(backgroundDir)
      .filter((file) => /\.test\.tsx?$/.test(file));

    expect(testFiles).toEqual([]);
  });

  it('keeps feature tests out of apps/extension/src/utils', () => {
    const utilsDir = path.resolve(root, 'apps/extension/src/utils');
    const testFiles = fs
      .readdirSync(utilsDir, { recursive: true })
      .map((entry) => String(entry).replace(/\\/g, '/'))
      .filter((file) => /\.test\.tsx?$/.test(file));

    expect(testFiles).toEqual([]);
  });

  it('keeps feature tests out of apps/extension/src/content', () => {
    const contentDir = path.resolve(root, 'apps/extension/src/content');
    const testFiles = fs
      .readdirSync(contentDir, { recursive: true })
      .map((entry) => String(entry).replace(/\\/g, '/'))
      .filter((file) => /\.test\.tsx?$/.test(file));

    expect(testFiles).toEqual([]);
  });

  it('keeps platform modules independent from app and feature layers', () => {
    const violations: string[] = [];
    const forbidden = [
      /^src\/features\//,
      /^src\/content\//,
      /^src\/services\//,
      /^src\/background\//,
      /^src\/dashboard\//,
    ];

    for (const file of listSourceFiles('apps/extension/src/platform')) {
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of readRelativeImports(source)) {
        const target = resolveImportPath(file, specifier);
        if (forbidden.some((pattern) => pattern.test(target))) {
          violations.push(`${path.relative(root, file).replace(/\\/g, '/')} -> ${target}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps magnets domain, application, and adapters independent from content runtime', () => {
    const violations: string[] = [];

    for (const area of ['domain', 'application', 'adapters']) {
      for (const file of listSourceFiles(`apps/extension/src/features/magnets/${area}`)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const specifier of readRelativeImports(source)) {
          const target = resolveImportPath(file, specifier);
          if (/^src\/content\//.test(target) || /^src\/background\//.test(target) || /^src\/dashboard\//.test(target)) {
            violations.push(`${path.relative(root, file).replace(/\\/g, '/')} -> ${target}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps newWorks implementation under features and services as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/newWorks/index.ts',
      'apps/extension/src/features/newWorks/collector.ts',
      'apps/extension/src/features/newWorks/manager.ts',
      'apps/extension/src/features/newWorks/scheduler.ts',
      'apps/extension/src/features/newWorks/types.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    for (const file of listSourceFiles('apps/extension/src/services/newWorks')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(12);
      expect(source, `${relative} should re-export from features/newWorks`).toMatch(/features\/newWorks/);
    }
  });

  it('keeps actors implementation under features and services as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/actors/index.ts',
      'apps/extension/src/features/actors/actorManager.ts',
      'apps/extension/src/features/actors/actorSync.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const serviceFiles = [
      'apps/extension/src/services/actorManager.ts',
      'apps/extension/src/services/actorSync.ts',
    ];

    for (const relative of serviceFiles) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/actors`).toMatch(/features\/actors/);
    }
  });

  it('keeps relatedLists implementation under features and service path as a compatibility export', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/relatedLists/index.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const relative = 'apps/extension/src/services/relatedLists/index.ts';
    const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(source, `${relative} should re-export from features/relatedLists`).toMatch(/features\/relatedLists/);
  });

  it('keeps review unlock implementation under features and service path as a compatibility export', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/reviewUnlock/index.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const relative = 'apps/extension/src/services/reviewBreaker/index.ts';
    const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(source, `${relative} should re-export from features/reviewUnlock`).toMatch(/features\/reviewUnlock/);
  });

  it('keeps fc2Breaker implementation under features and service path as a compatibility export', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/fc2Breaker/index.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const relative = 'apps/extension/src/services/fc2Breaker/index.ts';
    const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(source, `${relative} should re-export from features/fc2Breaker`).toMatch(/features\/fc2Breaker/);
  });

  it('keeps actorRemarks implementation under features and service path as a compatibility export', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/actorRemarks/index.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const relative = 'apps/extension/src/services/actorRemarks/index.ts';
    const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(source, `${relative} should re-export from features/actorRemarks`).toMatch(/features\/actorRemarks/);
  });

  it('keeps insights implementation under features and services as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/insights/index.ts',
      'apps/extension/src/features/insights/aggregator.ts',
      'apps/extension/src/features/insights/compareAggregator.ts',
      'apps/extension/src/features/insights/generationTrace.ts',
      'apps/extension/src/features/insights/personas.ts',
      'apps/extension/src/features/insights/prompts.ts',
      'apps/extension/src/features/insights/reportGenerator.ts',
      'apps/extension/src/features/insights/contentCollector.ts',
      'apps/extension/src/features/insights/ui/homeInsightsWidget.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    for (const file of listSourceFiles('apps/extension/src/services/insights')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/insights`).toMatch(/features\/insights/);
    }

    const legacyContentPath = 'apps/extension/src/content/insightsCollector.ts';
    const legacyContentSource = fs.readFileSync(path.resolve(root, legacyContentPath), 'utf8');
    const legacyContentLines = legacyContentSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(legacyContentLines.length, `${legacyContentPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacyContentSource, `${legacyContentPath} should re-export from features/insights`).toMatch(/features\/insights/);

    const bootstrapSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    expect(bootstrapSource, 'content bootstrap should use the insights feature directly').not.toMatch(/content\/insightsCollector/);
    expect(bootstrapSource, 'content bootstrap should import initInsightsCollector from features/insights').toMatch(/features\/insights/);

    const legacyHomeWidgetPath = 'apps/extension/src/content/homeInsightsWidget.ts';
    const legacyHomeWidgetSource = fs.readFileSync(path.resolve(root, legacyHomeWidgetPath), 'utf8');
    const legacyHomeWidgetLines = legacyHomeWidgetSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(legacyHomeWidgetLines.length, `${legacyHomeWidgetPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacyHomeWidgetSource, `${legacyHomeWidgetPath} should re-export from features/insights`).toMatch(/features\/insights/);
  });

  it('keeps dataAggregator implementation under features and services as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/dataAggregator/index.ts',
      'apps/extension/src/features/dataAggregator/types.ts',
      'apps/extension/src/features/dataAggregator/sources/aiTranslator.ts',
      'apps/extension/src/features/dataAggregator/sources/blogJav.ts',
      'apps/extension/src/features/dataAggregator/sources/javLibrary.ts',
      'apps/extension/src/features/dataAggregator/sources/translator.ts',
      'apps/extension/src/features/dataAggregator/__tests__/dataAggregator.test.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyTest = 'apps/extension/src/services/dataAggregator/__tests__/dataAggregator.test.ts';
    expect(fs.existsSync(path.resolve(root, legacyTest)), `${legacyTest} should be migrated`).toBe(false);

    for (const file of listSourceFiles('apps/extension/src/services/dataAggregator')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(12);
      if (relative.endsWith('/httpClient.ts')) {
        expect(source, `${relative} should re-export from platform/network`).toMatch(/platform\/network/);
      } else {
        expect(source, `${relative} should re-export from features/dataAggregator`).toMatch(/features\/dataAggregator/);
      }
    }
  });

  it('keeps update checker implementation under features and service path as a compatibility export', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/updateChecker/index.ts',
      'apps/extension/src/features/updateChecker/checker.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const relative = 'apps/extension/src/services/update/checker.ts';
    const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(source, `${relative} should re-export from features/updateChecker`).toMatch(/features\/updateChecker/);
  });

  it('keeps AI service implementation under features and services as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/ai/index.ts',
      'apps/extension/src/features/ai/aiService.ts',
      'apps/extension/src/features/ai/config.ts',
      'apps/extension/src/features/ai/modelManager.ts',
      'apps/extension/src/features/ai/newApiClient.ts',
      'apps/extension/src/features/ai/rateLimiter.ts',
      'apps/extension/src/features/ai/types.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    for (const file of listSourceFiles('apps/extension/src/services/ai')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/ai`).toMatch(/features\/ai/);
    }
  });

  it('keeps privacy service implementation under features and services as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/privacy/index.ts',
      'apps/extension/src/features/privacy/BlurController.ts',
      'apps/extension/src/features/privacy/LockScreen.ts',
      'apps/extension/src/features/privacy/PasswordService.ts',
      'apps/extension/src/features/privacy/PrivacyManager.ts',
      'apps/extension/src/features/privacy/RecoveryService.ts',
      'apps/extension/src/features/privacy/SessionManager.ts',
      'apps/extension/src/features/privacy/blurAreaMapper.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    for (const file of listSourceFiles('apps/extension/src/services/privacy')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/privacy`).toMatch(/features\/privacy/);
    }
  });

  it('keeps drive115 implementation under features and services as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/drive115/index.ts',
      'apps/extension/src/features/drive115/legacy/index.ts',
      'apps/extension/src/features/drive115/legacy/config.ts',
      'apps/extension/src/features/drive115/legacy/types.ts',
      'apps/extension/src/features/drive115/app/index.ts',
      'apps/extension/src/features/drive115/app/adapters.ts',
      'apps/extension/src/features/drive115/app/logger.ts',
      'apps/extension/src/features/drive115/app/runtime.ts',
      'apps/extension/src/features/drive115/app/types.ts',
      'apps/extension/src/features/drive115/content/index.ts',
      'apps/extension/src/features/drive115/router/index.ts',
      'apps/extension/src/features/drive115/v2/index.ts',
      'apps/extension/src/features/drive115/v2/errorCodes.ts',
      'apps/extension/src/features/drive115/v2/logs.ts',
      'apps/extension/src/features/drive115/v2/pkce.ts',
      'apps/extension/src/features/drive115/v2/search.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    for (const serviceDir of ['apps/extension/src/services/drive115', 'apps/extension/src/services/drive115App', 'apps/extension/src/services/drive115Router', 'apps/extension/src/services/drive115v2']) {
      for (const file of listSourceFiles(serviceDir)) {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        const source = fs.readFileSync(file, 'utf8');
        const nonEmptyLines = source
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
        expect(source, `${relative} should re-export from features/drive115`).toMatch(/features\/drive115/);
      }
    }

    const legacyContentPath = 'apps/extension/src/content/drive115.ts';
    const legacyContentSource = fs.readFileSync(path.resolve(root, legacyContentPath), 'utf8');
    const legacyContentLines = legacyContentSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(legacyContentLines.length, `${legacyContentPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacyContentSource).toMatch(/features\/drive115\/content/);

    const bootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    const magnetManager = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/magnets/ui/magnetSearchManager.ts'), 'utf8');
    expect(bootstrap).toMatch(/features\/drive115\/content/);
    expect(magnetManager).toMatch(/drive115\/content/);
  });

  it('keeps privacy utilities under the privacy feature and utils path as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/privacy/utils/crypto.ts',
      'apps/extension/src/features/privacy/utils/storage.ts',
      'apps/extension/src/features/privacy/utils/validation.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    for (const file of listSourceFiles('apps/extension/src/utils/privacy')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/privacy/utils`).toMatch(/features\/privacy\/utils/);
    }
  });

  it('keeps the background service worker entry thin and boots through apps/background', () => {
    const bootstrapPath = 'apps/extension/src/apps/background/bootstrap.ts';
    expect(fs.existsSync(path.resolve(root, bootstrapPath)), `${bootstrapPath} should exist`).toBe(true);

    const entryPath = 'apps/extension/src/background/background.ts';
    const source = fs.readFileSync(path.resolve(root, entryPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${entryPath} should stay a thin manifest entry`).toBeLessThanOrEqual(8);
    expect(source, `${entryPath} should import apps/background/bootstrap`).toMatch(/apps\/background\/bootstrap/);
  });

  it('keeps background bootstrap focused on wiring and delegates operational areas to app modules', () => {
    const bootstrapPath = 'apps/extension/src/apps/background/bootstrap.ts';
    const source = fs.readFileSync(path.resolve(root, bootstrapPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${bootstrapPath} should stay focused on wiring`).toBeLessThanOrEqual(180);

    const expectedModules = [
      'apps/extension/src/apps/background/dynamicContentScripts.ts',
      'apps/extension/src/apps/background/dnrRules.ts',
      'apps/extension/src/apps/background/routeAutoUpdate.ts',
      'apps/extension/src/apps/background/drive115UserRefresh.ts',
      'apps/extension/src/apps/background/alarmRouter.ts',
      'apps/extension/src/apps/background/errorHandlers.ts',
    ];

    for (const file of expectedModules) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
      expect(source, `${bootstrapPath} should import ${file}`).toContain(`./${path.basename(file, '.ts')}`);
    }
  });

  it('keeps the main content script entry thin and boots through apps/content', () => {
    const bootstrapPath = 'apps/extension/src/apps/content/bootstrap.ts';
    expect(fs.existsSync(path.resolve(root, bootstrapPath)), `${bootstrapPath} should exist`).toBe(true);

    const entryPath = 'apps/extension/src/content/index.ts';
    const source = fs.readFileSync(path.resolve(root, entryPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${entryPath} should stay a thin manifest entry`).toBeLessThanOrEqual(8);
    expect(source, `${entryPath} should import apps/content/bootstrap`).toMatch(/apps\/content\/bootstrap/);
    expect(source, `${entryPath} should re-export onExecute for the CRX loader`).toMatch(/export\s+\{\s*onExecute\s*\}/);
  });

  it('keeps content bootstrap focused on initialization and delegates runtime listeners', () => {
    const bootstrapPath = 'apps/extension/src/apps/content/bootstrap.ts';
    const source = fs.readFileSync(path.resolve(root, bootstrapPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${bootstrapPath} should stay focused on initialization`).toBeLessThanOrEqual(900);

    const expectedModules = [
      'apps/extension/src/apps/content/consoleSettingsBridge.ts',
      'apps/extension/src/apps/content/contentLifecycle.ts',
      'apps/extension/src/apps/content/contentMessageRouter.ts',
      'apps/extension/src/apps/content/orchestratorStateBridge.ts',
      'apps/extension/src/apps/content/pageChrome.ts',
      'apps/extension/src/features/previews/previewVolumeControl.ts',
    ];

    for (const file of expectedModules) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    expect(source).toMatch(/\.\/consoleSettingsBridge/);
    expect(source).toMatch(/\.\/contentLifecycle/);
    expect(source).toMatch(/\.\/contentMessageRouter/);
    expect(source).toMatch(/\.\/orchestratorStateBridge/);
    expect(source).toMatch(/\.\/pageChrome/);
    expect(source).toMatch(/features\/previews/);
  });

  it('keeps drive115 content script entries thin and boots through apps/content', () => {
    const expectedBootstraps = [
      'apps/extension/src/apps/content/drive115Content.ts',
      'apps/extension/src/apps/content/drive115Verify.ts',
    ];

    for (const file of expectedBootstraps) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const entries = [
      { path: 'apps/extension/src/content/drive115-content.ts', pattern: /apps\/content\/drive115Content/ },
      { path: 'apps/extension/src/content/drive115-verify.ts', pattern: /apps\/content\/drive115Verify/ },
    ];

    for (const entry of entries) {
      const source = fs.readFileSync(path.resolve(root, entry.path), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${entry.path} should stay a thin manifest entry`).toBeLessThanOrEqual(8);
      expect(source, `${entry.path} should import its apps/content bootstrap`).toMatch(entry.pattern);
    }
  });

  it('keeps the dashboard page entry thin and boots through apps/dashboard', () => {
    const bootstrapPath = 'apps/extension/src/apps/dashboard/bootstrap.ts';
    expect(fs.existsSync(path.resolve(root, bootstrapPath)), `${bootstrapPath} should exist`).toBe(true);

    const entryPath = 'apps/extension/src/dashboard/dashboard.ts';
    const source = fs.readFileSync(path.resolve(root, entryPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${entryPath} should stay a thin page entry`).toBeLessThanOrEqual(8);
    expect(source, `${entryPath} should import apps/dashboard/bootstrap`).toMatch(/apps\/dashboard\/bootstrap/);
  });

  it('keeps dashboard bootstrap delegated to focused app modules', () => {
    const bootstrapPath = 'apps/extension/src/apps/dashboard/bootstrap.ts';
    const bootstrapSource = fs.readFileSync(path.resolve(root, bootstrapPath), 'utf8');
    const delegatedModules = [
      'apps/extension/src/apps/dashboard/themeBootstrap.ts',
      'apps/extension/src/apps/dashboard/consoleBootstrap.ts',
      'apps/extension/src/apps/dashboard/privacyBootstrap.ts',
    ];

    for (const modulePath of delegatedModules) {
      expect(fs.existsSync(path.resolve(root, modulePath)), `${modulePath} should exist`).toBe(true);
      const importPattern = new RegExp(`\\./${path.basename(modulePath, '.ts')}`);
      expect(bootstrapSource, `${bootstrapPath} should import ${modulePath}`).toMatch(importPattern);
    }

    expect(bootstrapSource, `${bootstrapPath} should delegate console proxy configuration`).not.toMatch(/\binstallConsoleProxy\(/);
    expect(bootstrapSource, `${bootstrapPath} should delegate theme switcher details`).not.toMatch(/\bThemeSwitcher\b/);
    expect(bootstrapSource, `${bootstrapPath} should delegate privacy initialization`).not.toMatch(/\binitializePrivacySystem\b/);
  });

  it('keeps the popup page entry thin and boots through apps/popup', () => {
    const bootstrapPath = 'apps/extension/src/apps/popup/bootstrap.ts';
    expect(fs.existsSync(path.resolve(root, bootstrapPath)), `${bootstrapPath} should exist`).toBe(true);

    const entryPath = 'apps/extension/src/popup/popup.ts';
    const source = fs.readFileSync(path.resolve(root, entryPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${entryPath} should stay a thin popup entry`).toBeLessThanOrEqual(8);
    expect(source, `${entryPath} should import apps/popup/bootstrap`).toMatch(/apps\/popup\/bootstrap/);
  });

  it('keeps online availability implementation under features and content path as a compatibility export', () => {
    const featurePath = 'apps/extension/src/features/onlineAvailability/index.ts';
    expect(fs.existsSync(path.resolve(root, featurePath)), `${featurePath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/onlineAvailability.ts';
    const source = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(source, `${legacyPath} should re-export from features/onlineAvailability`).toMatch(/features\/onlineAvailability/);
  });

  it('keeps video status implementation under features and legacy paths as compatibility exports', () => {
    const expectedFeatureFiles = [
      'apps/extension/src/features/videoStatus/index.ts',
      'apps/extension/src/features/videoStatus/statusManager.ts',
      'apps/extension/src/features/videoStatus/statusPriority.ts',
    ];

    for (const file of expectedFeatureFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyFiles = [
      'apps/extension/src/content/statusManager.ts',
      'apps/extension/src/utils/statusPriority.ts',
    ];

    for (const relative of legacyFiles) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/videoStatus`).toMatch(/features\/videoStatus/);
    }
  });

  it('keeps shared list record helpers under shared utils with utils path as a compatibility export', () => {
    const sharedPath = 'apps/extension/src/shared/utils/listRecordHelpers.ts';
    expect(fs.existsSync(path.resolve(root, sharedPath)), `${sharedPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/utils/listRecordHelpers.ts';
    const source = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(source, `${legacyPath} should re-export from shared/utils/listRecordHelpers`).toMatch(/shared\/utils\/listRecordHelpers/);
  });

  it('keeps pure reusable utilities under shared utils with utils paths as compatibility exports', () => {
    const modules = [
      'codeParser',
      'md5',
      'tagFilter',
      'versionInfo',
    ];

    for (const moduleName of modules) {
      const sharedPath = `apps/extension/src/shared/utils/${moduleName}.ts`;
      expect(fs.existsSync(path.resolve(root, sharedPath)), `${sharedPath} should exist`).toBe(true);

      const legacyPath = `apps/extension/src/utils/${moduleName}.ts`;
      const source = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${legacyPath} should re-export from shared/utils/${moduleName}`).toMatch(new RegExp(`shared\\/utils\\/${moduleName}`));
    }

    const violations: string[] = [];
    const legacyUtilityImport = /(?:^|['"])(?:\.\.\/)+utils\/(?:codeParser|md5|tagFilter|versionInfo)(?:['"]|$)/;

    for (const file of listSourceFiles('apps/extension/src')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (relative.startsWith('apps/extension/src/utils/')) continue;

      const source = fs.readFileSync(file, 'utf8');
      if (legacyUtilityImport.test(source)) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps content video id parsing as a shared pure utility with page extraction under platform browser', () => {
    const sharedPath = 'apps/extension/src/shared/utils/videoId.ts';
    expect(fs.existsSync(path.resolve(root, sharedPath)), `${sharedPath} should exist`).toBe(true);

    const platformPath = 'apps/extension/src/platform/browser/videoId.ts';
    expect(fs.existsSync(path.resolve(root, platformPath)), `${platformPath} should exist`).toBe(true);

    const contentSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/content/videoId.ts'), 'utf8');
    const nonEmptyLines = contentSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(nonEmptyLines.length, 'apps/extension/src/content/videoId.ts should stay a thin compatibility wrapper').toBeLessThanOrEqual(8);
    expect(contentSource, 'apps/extension/src/content/videoId.ts should re-export from platform/browser/videoId').toMatch(/platform\/browser\/videoId/);

    const platformSource = fs.readFileSync(path.resolve(root, platformPath), 'utf8');
    expect(platformSource, `${platformPath} should reuse shared pure parser`).toMatch(/shared\/utils\/videoId/);

    const directConsumers = [
      'apps/extension/src/features/onlineAvailability/index.ts',
      'apps/extension/src/features/magnets/ui/magnetSearchManager.ts',
      'apps/extension/src/features/drive115/content/index.ts',
      'apps/extension/src/features/insights/contentCollector.ts',
      'apps/extension/src/features/videoDetail/pageHandler.ts',
      'apps/extension/src/features/videoDetail/favoriteRating.ts',
      'apps/extension/src/features/videoDetail/enhancer.ts',
      'apps/extension/src/features/videoStatus/statusManager.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use platform/browser video id helpers`).not.toMatch(/content\/videoId/);
      expect(source, `${relative} should reference platform/browser`).toMatch(/platform\/browser/);
    }
  });

  it('keeps console proxy under platform logging with utils path as a compatibility export', () => {
    const targetPath = 'apps/extension/src/platform/logging/consoleProxy.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/utils/consoleProxy.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from platform/logging/consoleProxy`).toMatch(/platform\/logging\/consoleProxy/);

    const directConsumers = [
      'apps/extension/src/apps/content/consoleSettingsBridge.ts',
      'apps/extension/src/apps/dashboard/consoleBootstrap.ts',
      'apps/extension/src/platform/logging/backgroundConsole.ts',
      'apps/extension/src/platform/logging/index.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use platform/logging/consoleProxy directly`).not.toMatch(/utils\/consoleProxy/);
      expect(source, `${relative} should reference platform logging console proxy`).toMatch(/consoleProxy/);
    }
  });

  it('keeps route management under features with utils path as a compatibility export', () => {
    const featurePath = 'apps/extension/src/features/routeManagement/index.ts';
    expect(fs.existsSync(path.resolve(root, featurePath)), `${featurePath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/utils/routeManager.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from features/routeManagement`).toMatch(/features\/routeManagement/);

    const directConsumers = [
      'apps/extension/src/apps/background/routeAutoUpdate.ts',
      'apps/extension/src/dashboard/dataSync/api.ts',
      'apps/extension/src/dashboard/tabs/actors.ts',
      'apps/extension/src/dashboard/tabs/settings/networkTest/NetworkTestSettings.ts',
      'apps/extension/src/features/newWorks/collector.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use features/routeManagement directly`).not.toMatch(/utils\/routeManager/);
      expect(source, `${relative} should reference route management feature`).toMatch(/features\/routeManagement|routeManagement/);
    }
  });

  it('keeps background route updates off browser-only network modules', () => {
    const routeManagementSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/routeManagement/index.ts'), 'utf8');

    expect(routeManagementSource, 'RouteManager runs from the MV3 service worker and must not pull the platform/network barrel').not.toMatch(/platform\/network['"]/);
    expect(routeManagementSource, 'RouteManager should import only the server endpoint resolver helpers it needs').toMatch(/platform\/network\/serverEndpointResolver/);
  });

  it('keeps TTL cache under platform storage with utils path as a compatibility export', () => {
    const targetPath = 'apps/extension/src/platform/storage/cache.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/utils/cache.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from platform/storage/cache`).toMatch(/platform\/storage\/cache/);

    const directConsumers = [
      'apps/extension/src/features/dataAggregator/index.ts',
      'apps/extension/src/components/ActorAvatar.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use platform storage cache directly`).not.toMatch(/utils\/cache/);
      expect(source, `${relative} should reference platform storage cache`).toMatch(/platform\/storage\/cache/);
    }
  });

  it('keeps content DB runtime client under platform storage', () => {
    const targetPath = 'apps/extension/src/platform/storage/dbRuntimeClient.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/dbClient.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from platform/storage/dbRuntimeClient`).toMatch(/platform\/storage\/dbRuntimeClient/);

    const directConsumers = [
      'apps/extension/src/features/records/content/concurrency.ts',
      'apps/extension/src/features/fc2Breaker/index.ts',
      'apps/extension/src/features/magnets/ui/magnetSearchManager.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use platform storage DB runtime client directly`).not.toMatch(/content\/dbClient|\.\/dbClient/);
      expect(source, `${relative} should reference platform storage DB runtime client`).toMatch(/platform\/storage\/dbRuntimeClient/);
    }
  });

  it('keeps network test domain configuration under the network test feature', () => {
    const targetPath = 'apps/extension/src/features/networkTest/domain/domainConfig.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/utils/domainConfig.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from features/networkTest/domain/domainConfig`).toMatch(/features\/networkTest\/domain\/domainConfig/);

    const directConsumer = 'apps/extension/src/dashboard/tabs/settings/networkTest/NetworkTestSettings.ts';
    const source = fs.readFileSync(path.resolve(root, directConsumer), 'utf8');
    expect(source, `${directConsumer} should use the feature domain config directly`).not.toMatch(/utils\/domainConfig/);
    expect(source, `${directConsumer} should reference network test feature`).toMatch(/features\/networkTest/);
  });

  it('keeps content-side record concurrency under the records feature with content paths as compatibility exports', () => {
    const expectedFiles = [
      'apps/extension/src/features/records/content/index.ts',
      'apps/extension/src/features/records/content/concurrency.ts',
      'apps/extension/src/features/records/content/concurrencyTest.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyFiles = [
      {
        legacyPath: 'apps/extension/src/content/concurrency.ts',
        targetPattern: /features\/records\/content/,
      },
      {
        legacyPath: 'apps/extension/src/content/concurrencyTest.ts',
        targetPattern: /features\/records\/content\/concurrencyTest/,
      },
    ];

    for (const item of legacyFiles) {
      const legacySource = fs.readFileSync(path.resolve(root, item.legacyPath), 'utf8');
      const nonEmptyLines = legacySource
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${item.legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(legacySource, `${item.legacyPath} should re-export from records content feature`).toMatch(item.targetPattern);
    }

    const directConsumers = [
      'apps/extension/src/features/videoDetail/pageHandler.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use records content concurrency directly`).not.toMatch(/content\/concurrency/);
      expect(source, `${relative} should reference records content feature`).toMatch(/features\/records\/content|records\/content/);
    }
  });

  it('keeps content-side JAVBUS tab fetch client under platform browser', () => {
    const targetPath = 'apps/extension/src/platform/browser/javbusRuntimeClient.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/javbusTabFetch.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from platform/browser/javbusRuntimeClient`).toMatch(/platform\/browser\/javbusRuntimeClient/);

    const directConsumer = 'apps/extension/src/features/magnets/ui/magnetSearchManager.ts';
    const source = fs.readFileSync(path.resolve(root, directConsumer), 'utf8');
    expect(source, `${directConsumer} should use platform browser JAVBUS runtime client directly`).not.toMatch(/content\/javbusTabFetch/);
    expect(source, `${directConsumer} should reference platform browser JAVBUS runtime client`).toMatch(/platform\/browser\/javbusRuntimeClient/);
  });

  it('keeps small background modules under platform or features with background paths as compatibility exports', () => {
    const modules = [
      {
        legacyPath: 'apps/extension/src/background/consoleConfig.ts',
        targetPath: 'apps/extension/src/platform/logging/backgroundConsole.ts',
        targetPattern: /platform\/logging\/backgroundConsole/,
      },
      {
        legacyPath: 'apps/extension/src/background/netProxy.ts',
        targetPath: 'apps/extension/src/platform/network/backgroundFetchRouter.ts',
        targetPattern: /platform\/network\/backgroundFetchRouter/,
      },
      {
        legacyPath: 'apps/extension/src/background/javbusTabFetch.ts',
        targetPath: 'apps/extension/src/platform/browser/javbusTabFetch.ts',
        targetPattern: /platform\/browser\/javbusTabFetch/,
      },
      {
        legacyPath: 'apps/extension/src/background/viewedTagStats.ts',
        targetPath: 'apps/extension/src/features/records/tagStats.ts',
        targetPattern: /features\/records\/tagStats/,
      },
    ];

    for (const item of modules) {
      expect(fs.existsSync(path.resolve(root, item.targetPath)), `${item.targetPath} should exist`).toBe(true);

      const source = fs.readFileSync(path.resolve(root, item.legacyPath), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${item.legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${item.legacyPath} should re-export from ${item.targetPath}`).toMatch(item.targetPattern);
    }
  });

  it('keeps WebDAV sync foundation under features while background controller uses the new modules', () => {
    const expectedFiles = [
      'apps/extension/src/features/webdavSync/domain/types.ts',
      'apps/extension/src/features/webdavSync/domain/paths.ts',
      'apps/extension/src/features/webdavSync/infrastructure/webdavClient.ts',
      'apps/extension/src/features/webdavSync/infrastructure/propfindParser.ts',
      'apps/extension/src/features/webdavSync/application/clientIdentity.ts',
      'apps/extension/src/features/webdavSync/application/clientRegistry.ts',
      'apps/extension/src/features/webdavSync/background/controller.ts',
      'apps/extension/src/features/webdavSync/index.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const source = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/webdavSync/background/controller.ts'), 'utf8');
    expect(source).toMatch(/\.\.\/domain\/paths/);
    expect(source).toMatch(/\.\.\/infrastructure\/webdavClient/);
    expect(source).toMatch(/\.\.\/infrastructure\/propfindParser/);
    expect(source).toMatch(/\.\.\/application\/clientIdentity/);
    expect(source).toMatch(/\.\.\/application\/clientRegistry/);
  });

  it('keeps WebDAV backup upload chain under features while background controller delegates to it', () => {
    const expectedFiles = [
      'apps/extension/src/features/webdavSync/application/backupCollector.ts',
      'apps/extension/src/features/webdavSync/application/uploadIndex.ts',
      'apps/extension/src/features/webdavSync/application/uploadService.ts',
      'apps/extension/src/features/webdavSync/application/cleanupService.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const source = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/webdavSync/background/controller.ts'), 'utf8');
    expect(source).toMatch(/\.\.\/application\/backupCollector/);
    expect(source).toMatch(/\.\.\/application\/uploadIndex/);
    expect(source).toMatch(/\.\.\/application\/uploadService/);
    expect(source).toMatch(/\.\.\/application\/cleanupService/);
  });

  it('keeps WebDAV restore, diagnostics, and message router under features', () => {
    const expectedFiles = [
      'apps/extension/src/features/webdavSync/application/restorePreview.ts',
      'apps/extension/src/features/webdavSync/application/restoreService.ts',
      'apps/extension/src/features/webdavSync/application/restoreStorage.ts',
      'apps/extension/src/features/webdavSync/application/importSanitizer.ts',
      'apps/extension/src/features/webdavSync/application/dataDiff.ts',
      'apps/extension/src/features/webdavSync/application/dataMerge.ts',
      'apps/extension/src/features/webdavSync/application/mergeKeyedMap.ts',
      'apps/extension/src/features/webdavSync/application/backupMigration.ts',
      'apps/extension/src/features/webdavSync/application/diagnostics.ts',
      'apps/extension/src/features/webdavSync/background/router.ts',
      'apps/extension/src/features/webdavSync/background/controller.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const source = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/webdavSync/background/controller.ts'), 'utf8');
    expect(source).toMatch(/\.\.\/application\/restorePreview/);
    expect(source).toMatch(/\.\.\/application\/restoreService/);
    expect(source).toMatch(/\.\.\/application\/restoreStorage/);
    expect(source).toMatch(/\.\.\/application\/importSanitizer/);
    expect(source).toMatch(/\.\.\/application\/diagnostics/);
    expect(source).toMatch(/\.\/router/);

    const dashboardRestore = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore.ts'), 'utf8');
    expect(dashboardRestore).toMatch(/features\/webdavSync\/application\/dataDiff/);
    expect(dashboardRestore).toMatch(/features\/webdavSync\/application\/dataMerge/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/fileListModel/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/conflictController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/conflictDetailModel/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreApplyController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreAnalysisController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreFilePreviewController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreModalShellController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreOptionsController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreUnifiedExecutorController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreResultController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreProgressResultsController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/restoreWizardController/);
    expect(dashboardRestore).toMatch(/\.\/webdavRestore\/settingsDifferenceModel/);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/fileListModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreOptionsModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/conflictController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/conflictDisplayModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/conflictDetailModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/conflictNavigationModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreResultsModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreBackupModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/strategyPreviewModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreConfirmationModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreWizardStateModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreExecuteConfirmModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreModeStatsModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreValidationModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreApplyPlanModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreModalStateModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreFooterModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreApplyController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreAnalysisController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreFilePreviewController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreModalShellController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreOptionsController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreUnifiedExecutorController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreResultController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreProgressResultsController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreWizardController.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/operationSummaryModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/previewStatsModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/quickRestoreModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/settingsDifferenceModel.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreProgressModel.ts'))).toBe(true);

    const conflictController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/conflictController.ts'), 'utf8');
    expect(conflictController).toMatch(/\.\/conflictDisplayModel/);
    expect(conflictController).toMatch(/\.\/conflictDetailModel/);
    expect(conflictController).toMatch(/\.\/conflictNavigationModel/);

    const restoreResultController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreResultController.ts'), 'utf8');
    expect(restoreResultController).toMatch(/\.\/operationSummaryModel/);
    expect(restoreResultController).toMatch(/\.\/restoreBackupModel/);

    const restoreProgressResultsController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreProgressResultsController.ts'), 'utf8');
    expect(restoreProgressResultsController).toMatch(/\.\/restoreProgressModel/);
    expect(restoreProgressResultsController).toMatch(/\.\/restoreResultsModel/);

    const restoreWizardController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreWizardController.ts'), 'utf8');
    expect(restoreWizardController).toMatch(/\.\/quickRestoreModel/);
    expect(restoreWizardController).toMatch(/\.\/restoreConfirmationModel/);
    expect(restoreWizardController).toMatch(/\.\/restoreModeStatsModel/);
    expect(restoreWizardController).toMatch(/\.\/restoreModeUiModel/);
    expect(restoreWizardController).toMatch(/\.\/restoreWizardStateModel/);
    expect(restoreWizardController).toMatch(/\.\/strategyPreviewModel/);

    const restoreApplyController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreApplyController.ts'), 'utf8');
    expect(restoreApplyController).toMatch(/\.\/restoreApplyPlanModel/);
    expect(restoreApplyController).toMatch(/\.\/restoreBackupModel/);
    expect(restoreApplyController).toMatch(/\.\/restoreModalStateModel/);
    expect(restoreApplyController).toMatch(/\.\/restoreValidationModel/);

    const restoreAnalysisController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreAnalysisController.ts'), 'utf8');
    expect(restoreAnalysisController).toMatch(/features\/webdavSync\/application\/dataDiff/);
    expect(restoreAnalysisController).toMatch(/\.\/restoreModalStateModel/);

    const restoreFilePreviewController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreFilePreviewController.ts'), 'utf8');
    expect(restoreFilePreviewController).toMatch(/features\/webdavSync\/application\/backupMigration/);
    expect(restoreFilePreviewController).toMatch(/\.\/fileListModel/);
    expect(restoreFilePreviewController).toMatch(/\.\/previewStatsModel/);
    expect(restoreFilePreviewController).toMatch(/\.\/restoreModalStateModel/);

    const restoreModalShellController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreModalShellController.ts'), 'utf8');
    expect(restoreModalShellController).toMatch(/\.\/restoreFooterModel/);
    expect(restoreModalShellController).toMatch(/\.\/restoreModalStateModel/);

    const restoreOptionsController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreOptionsController.ts'), 'utf8');
    expect(restoreOptionsController).toMatch(/\.\/restoreOptionsModel/);

    const restoreUnifiedExecutorController = fs.readFileSync(path.resolve(root, 'apps/extension/src/dashboard/webdavRestore/restoreUnifiedExecutorController.ts'), 'utf8');
    expect(restoreUnifiedExecutorController).toMatch(/features\/webdavSync\/application\/dataDiff/);
    expect(restoreUnifiedExecutorController).toMatch(/\.\/restoreExecuteConfirmModel/);

    const removedExpertDiffArtifacts = [
      'displayDiffAnalysis',
      'generateDiffSummaryHTML',
      'bindConflictDetailEvents',
      'bindExpertModeEvents',
      'bindExpertStrategyChangeEvents',
      'updateExpertImpactPreview',
      'expertMergeStrategy',
      'expertSmartMerge',
      'expertKeepLocal',
      'expertKeepCloud',
      'expertManualResolve',
    ];

    for (const artifact of removedExpertDiffArtifacts) {
      expect(dashboardRestore, `${artifact} should be removed from deprecated expert restore mode`).not.toContain(artifact);
    }

    const removedRestoreSaveArtifacts = [
      'saveRestoredData',
      'dbActorsBulkPut',
    ];

    for (const artifact of removedRestoreSaveArtifacts) {
      expect(dashboardRestore, `${artifact} should be removed from legacy restore save flow`).not.toContain(artifact);
    }

    const legacyFiles = [
      {
        legacyPath: 'apps/extension/src/utils/dataDiff.ts',
        targetPattern: /features\/webdavSync\/application\/dataDiff/,
      },
      {
        legacyPath: 'apps/extension/src/utils/dataMerge.ts',
        targetPattern: /features\/webdavSync\/application\/dataMerge/,
      },
      {
        legacyPath: 'apps/extension/src/utils/mergeKeyedMap.ts',
        targetPattern: /features\/webdavSync\/application\/mergeKeyedMap/,
      },
    ];

    for (const item of legacyFiles) {
      const legacySource = fs.readFileSync(path.resolve(root, item.legacyPath), 'utf8');
      const nonEmptyLines = legacySource
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${item.legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(legacySource, `${item.legacyPath} should re-export from webdavSync application`).toMatch(item.targetPattern);
    }
  });

  it('keeps WebDAV background entry as compatibility export after moving controller under feature', () => {
    const legacyPath = 'apps/extension/src/background/webdav.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(14);
    expect(legacySource).toMatch(/features\/webdavSync\/background\/controller/);

    const bootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/bootstrap.ts'), 'utf8');
    const scheduler = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/scheduler.ts'), 'utf8');
    expect(bootstrap).toMatch(/features\/webdavSync\/background\/controller/);
    expect(scheduler).toMatch(/features\/webdavSync\/background\/controller/);
  });

  it('keeps record refresh implementation under features with background sync as a compatibility export', () => {
    const expectedFiles = [
      'apps/extension/src/features/records/refresh/domain/types.ts',
      'apps/extension/src/features/records/refresh/application/cloudflareVerification.ts',
      'apps/extension/src/features/records/refresh/application/fc2Refresh.ts',
      'apps/extension/src/features/records/refresh/application/javdbParsers.ts',
      'apps/extension/src/features/records/refresh/application/recordRefresh.ts',
      'apps/extension/src/features/records/refresh/index.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const syncSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/background/sync.ts'), 'utf8');
    const syncNonEmptyLines = syncSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(syncNonEmptyLines.length, 'apps/extension/src/background/sync.ts should stay a thin compatibility wrapper').toBeLessThanOrEqual(10);
    expect(syncSource).toMatch(/features\/records\/refresh/);

    const miscSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/miscMessageRouter.ts'), 'utf8');
    expect(miscSource).toMatch(/features\/records\/refresh/);
  });

  it('keeps utility migration targets in features and platform while utils paths stay compatibility exports', () => {
    const modules = [
      {
        legacyPath: 'apps/extension/src/utils/searchEngines.ts',
        targetPath: 'apps/extension/src/features/externalSearch/domain/searchEngines.ts',
        targetPattern: /features\/externalSearch\/domain\/searchEngines/,
      },
      {
        legacyPath: 'apps/extension/src/utils/net.ts',
        targetPath: 'apps/extension/src/platform/network/clientFetch.ts',
        targetPattern: /platform\/network\/clientFetch/,
      },
      {
        legacyPath: 'apps/extension/src/utils/ipLookup.ts',
        targetPath: 'apps/extension/src/platform/network/ipLookup.ts',
        targetPattern: /platform\/network\/ipLookup/,
      },
      {
        legacyPath: 'apps/extension/src/utils/webdavDiagnostic.ts',
        targetPath: 'apps/extension/src/features/webdavSync/application/webdavDiagnostic.ts',
        targetPattern: /features\/webdavSync\/application\/webdavDiagnostic/,
      },
    ];

    for (const item of modules) {
      expect(fs.existsSync(path.resolve(root, item.targetPath)), `${item.targetPath} should exist`).toBe(true);

      const source = fs.readFileSync(path.resolve(root, item.legacyPath), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${item.legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${item.legacyPath} should re-export from ${item.targetPath}`).toMatch(item.targetPattern);
    }
  });

  it('keeps preview implementation under features with content paths as compatibility exports', () => {
    const expectedFiles = [
      'apps/extension/src/features/previews/index.ts',
      'apps/extension/src/features/previews/nativeJavdbPreview.ts',
      'apps/extension/src/features/previews/previewSourceRules.ts',
      'apps/extension/src/features/previews/previewVideoPreload.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyFiles = [
      'apps/extension/src/content/nativeJavdbPreview.ts',
      'apps/extension/src/content/previewSourceRules.ts',
      'apps/extension/src/content/previewVideoPreload.ts',
    ];

    for (const relative of legacyFiles) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/previews`).toMatch(/features\/previews/);
    }

    const contentBootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    const detailEnhancer = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/videoDetail/enhancer.ts'), 'utf8');
    const listEnhancement = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/listEnhancement/listEnhancementManager.ts'), 'utf8');
    expect(contentBootstrap).toMatch(/features\/previews/);
    expect(detailEnhancer).toMatch(/['"]\.\.\/previews['"]/);
    expect(listEnhancement).toMatch(/['"]\.\.\/previews['"]/);
  });

  it('keeps super ranking navigation under features with content path as a compatibility export', () => {
    const expectedFiles = [
      'apps/extension/src/features/rankings/index.ts',
      'apps/extension/src/features/rankings/superRankingNav.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyPath = 'apps/extension/src/content/superRankingNav.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/features\/rankings/);

    const featureSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/rankings/superRankingNav.ts'), 'utf8');
    expect(featureSource).not.toMatch(/from ['"].*content\//);

    const contentBootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    const listEnhancement = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/listEnhancement/listEnhancementManager.ts'), 'utf8');
    expect(contentBootstrap).toMatch(/features\/rankings/);
    expect(listEnhancement).toMatch(/['"]\.\.\/rankings['"]/);
  });

  it('keeps content filter implementation under features with content path as a compatibility export', () => {
    const expectedFiles = [
      'apps/extension/src/features/contentFilter/index.ts',
      'apps/extension/src/features/contentFilter/contentFilterManager.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyPath = 'apps/extension/src/content/contentFilter.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/features\/contentFilter/);

    const contentBootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    const keyboardShortcuts = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/keyboardShortcuts/index.ts'), 'utf8');
    expect(contentBootstrap).toMatch(/features\/contentFilter/);
    expect(keyboardShortcuts).toMatch(/\.\.\/contentFilter/);
  });

  it('keeps keyboard shortcuts under features with content path as a compatibility export', () => {
    const featurePath = 'apps/extension/src/features/keyboardShortcuts/index.ts';
    expect(fs.existsSync(path.resolve(root, featurePath)), `${featurePath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/keyboardShortcuts.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/features\/keyboardShortcuts/);

    const bootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    const lifecycle = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/contentLifecycle.ts'), 'utf8');
    expect(bootstrap).toMatch(/features\/keyboardShortcuts/);
    expect(lifecycle).toMatch(/features\/keyboardShortcuts/);
  });

  it('keeps list enhancement implementation under features with content path as a compatibility export', () => {
    const expectedFiles = [
      'apps/extension/src/features/listEnhancement/index.ts',
      'apps/extension/src/features/listEnhancement/listEnhancementManager.ts',
      'apps/extension/src/features/listEnhancement/content/itemProcessor.ts',
      'apps/extension/src/features/listEnhancement/domain/config.ts',
      'apps/extension/src/features/listEnhancement/application/actorMatching.ts',
      'apps/extension/src/features/listEnhancement/application/actorHiding.ts',
      'apps/extension/src/features/listEnhancement/application/actorHidingWorkflow.ts',
      'apps/extension/src/features/listEnhancement/application/actorWatermark.ts',
      'apps/extension/src/features/listEnhancement/application/listSorting.ts',
      'apps/extension/src/features/listEnhancement/application/popularityEffects.ts',
      'apps/extension/src/features/listEnhancement/application/scrollPaging.ts',
      'apps/extension/src/features/listEnhancement/ui/clickEnhancement.ts',
      'apps/extension/src/features/listEnhancement/ui/listItemObserver.ts',
      'apps/extension/src/features/listEnhancement/ui/listItemDom.ts',
      'apps/extension/src/features/listEnhancement/ui/listScrollState.ts',
      'apps/extension/src/features/listEnhancement/ui/listDisplayControl.ts',
      'apps/extension/src/features/listEnhancement/ui/listSortingControls.ts',
      'apps/extension/src/features/listEnhancement/ui/previewHoverController.ts',
      'apps/extension/src/features/listEnhancement/ui/styles.ts',
      'apps/extension/src/features/previews/listPreviewLoader.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyPath = 'apps/extension/src/content/enhancements/listEnhancement.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/features\/listEnhancement/);

    const legacyItemProcessorPath = 'apps/extension/src/content/itemProcessor.ts';
    const legacyItemProcessorSource = fs.readFileSync(path.resolve(root, legacyItemProcessorPath), 'utf8');
    const legacyItemProcessorLines = legacyItemProcessorSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(legacyItemProcessorLines.length, `${legacyItemProcessorPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacyItemProcessorSource).toMatch(/features\/listEnhancement\/content\/itemProcessor/);

    const featureSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/listEnhancement/listEnhancementManager.ts'), 'utf8');
    const managerLineCount = featureSource.split(/\r?\n/).length;
    expect(managerLineCount, 'listEnhancementManager.ts should keep shrinking as config, pure helpers, and styles move out').toBeLessThanOrEqual(900);
    expect(featureSource).toMatch(/\.\/domain\/config/);
    expect(featureSource).toMatch(/\.\/application\/actorHidingWorkflow/);
    expect(featureSource).toMatch(/\.\/application\/actorWatermark/);
    expect(featureSource).toMatch(/\.\/ui\/listSortingControls/);
    expect(featureSource).toMatch(/loadListPreviewVideo/);
    expect(featureSource).toMatch(/\.\/application\/popularityEffects/);
    expect(featureSource).toMatch(/\.\/application\/scrollPaging/);
    expect(featureSource).toMatch(/\.\/ui\/clickEnhancement/);
    expect(featureSource).toMatch(/\.\/ui\/listItemObserver/);
    expect(featureSource).toMatch(/\.\/ui\/listItemDom/);
    expect(featureSource).toMatch(/\.\/ui\/listScrollState/);
    expect(featureSource).toMatch(/\.\/ui\/listDisplayControl/);
    expect(featureSource).toMatch(/\.\/ui\/previewHoverController/);
    expect(featureSource).toMatch(/\.\/ui\/styles/);
    expect(featureSource).toMatch(/['"]\.\.\/previews['"]/);
    expect(featureSource).toMatch(/['"]\.\.\/rankings['"]/);

    const contentBootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    expect(contentBootstrap).toMatch(/features\/listEnhancement/);

    const directConsumers = [
      'apps/extension/src/apps/content/bootstrap.ts',
      'apps/extension/src/apps/content/contentMessageRouter.ts',
      'apps/extension/src/features/listEnhancement/listEnhancementManager.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use list enhancement item processor directly`).not.toMatch(/(?:\.\.\/)+content\/itemProcessor|src\/content\/itemProcessor/);
      expect(source, `${relative} should reference list enhancement feature`).toMatch(/features\/listEnhancement/);
    }
  });

  it('keeps content task runtime helpers under platform with content paths as compatibility exports', () => {
    const modules = [
      {
        legacyPath: 'apps/extension/src/content/pageContext.ts',
        targetPath: 'apps/extension/src/platform/browser/pageContext.ts',
        targetPattern: /platform\/browser\/pageContext/,
      },
      {
        legacyPath: 'apps/extension/src/content/taskRuntime.ts',
        targetPath: 'apps/extension/src/platform/tasks/contentRuntime.ts',
        targetPattern: /platform\/tasks\/contentRuntime/,
      },
      {
        legacyPath: 'apps/extension/src/content/taskDetailReporter.ts',
        targetPath: 'apps/extension/src/platform/tasks/contentTaskDetailReporter.ts',
        targetPattern: /platform\/tasks\/contentTaskDetailReporter/,
      },
      {
        legacyPath: 'apps/extension/src/content/taskHeartbeat.ts',
        targetPath: 'apps/extension/src/platform/tasks/taskHeartbeatReporter.ts',
        targetPattern: /platform\/tasks\/taskHeartbeatReporter/,
      },
      {
        legacyPath: 'apps/extension/src/content/taskVisibilityReporter.ts',
        targetPath: 'apps/extension/src/platform/tasks/taskVisibilityReporter.ts',
        targetPattern: /platform\/tasks\/taskVisibilityReporter/,
      },
      {
        legacyPath: 'apps/extension/src/content/taskChunking.ts',
        targetPath: 'apps/extension/src/platform/tasks/chunking.ts',
        targetPattern: /platform\/tasks\/chunking/,
      },
      {
        legacyPath: 'apps/extension/src/content/performanceOptimizer.ts',
        targetPath: 'apps/extension/src/platform/tasks/performanceOptimizer.ts',
        targetPattern: /platform\/tasks\/performanceOptimizer/,
      },
    ];

    for (const item of modules) {
      expect(fs.existsSync(path.resolve(root, item.targetPath)), `${item.targetPath} should exist`).toBe(true);

      const source = fs.readFileSync(path.resolve(root, item.legacyPath), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${item.legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${item.legacyPath} should re-export from ${item.targetPath}`).toMatch(item.targetPattern);
    }

    const directConsumers = [
      'apps/extension/src/apps/content/bootstrap.ts',
      'apps/extension/src/apps/content/contentLifecycle.ts',
      'apps/extension/src/apps/content/consoleSettingsBridge.ts',
      'apps/extension/src/features/actorEnhancement/actorEnhancementManager.ts',
      'apps/extension/src/features/contentFilter/contentFilterManager.ts',
      'apps/extension/src/features/magnets/ui/magnetSearchManager.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use platform task/browser helpers directly`).not.toMatch(/content\/(?:task(?:Runtime|Chunking|DetailReporter|Heartbeat|VisibilityReporter)|pageContext|performanceOptimizer)|\.\.\/\.\.\/content\/(?:task|pageContext|performanceOptimizer)/);
    }
  });

  it('keeps content init orchestrator under apps/content with content path as a compatibility export', () => {
    const expectedFiles = [
      'apps/extension/src/apps/content/orchestrator/index.ts',
      'apps/extension/src/apps/content/orchestrator/initOrchestrator.ts',
      'apps/extension/src/apps/content/orchestrator/types.ts',
      'apps/extension/src/apps/content/orchestrator/hardwareConcurrency.ts',
      'apps/extension/src/apps/content/orchestrator/metrics.ts',
      'apps/extension/src/apps/content/orchestrator/schedulingRules.ts',
      'apps/extension/src/apps/content/orchestrator/retryTimers.ts',
      'apps/extension/src/apps/content/orchestrator/highPhaseScheduler.ts',
      'apps/extension/src/apps/content/orchestrator/pageLifecycleBindings.ts',
      'apps/extension/src/apps/content/orchestrator/dashboardMetricsMessages.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyPath = 'apps/extension/src/content/initOrchestrator.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/apps\/content\/orchestrator/);

    const bootstrapSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    expect(bootstrapSource).toMatch(/\.\/orchestrator/);
    expect(bootstrapSource).not.toMatch(/content\/initOrchestrator/);

    const videoDetailSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/videoDetail/pageHandler.ts'), 'utf8');
    const enhancedVideoDetailSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/videoDetail/enhancer.ts'), 'utf8');
    expect(videoDetailSource).toMatch(/apps\/content\/orchestrator/);
    expect(enhancedVideoDetailSource).toMatch(/apps\/content\/orchestrator/);

    const orchestratorSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/orchestrator/initOrchestrator.ts'), 'utf8');
    expect(orchestratorSource).toMatch(/platform\/tasks/);
    expect(orchestratorSource).toMatch(/platform\/browser/);
    expect(orchestratorSource).toMatch(/\.\/types/);
    expect(orchestratorSource).toMatch(/\.\/hardwareConcurrency/);
    expect(orchestratorSource).toMatch(/\.\/metrics/);
    expect(orchestratorSource).toMatch(/\.\/schedulingRules/);
    expect(orchestratorSource).toMatch(/\.\/retryTimers/);
    expect(orchestratorSource).toMatch(/\.\/highPhaseScheduler/);
    expect(orchestratorSource).toMatch(/\.\/pageLifecycleBindings/);
    expect(orchestratorSource).toMatch(/\.\/dashboardMetricsMessages/);
    expect(orchestratorSource).not.toMatch(/function getDefaultVisibilityPolicy/);
    expect(orchestratorSource).not.toMatch(/navigator\.hardwareConcurrency/);
    expect(orchestratorSource).not.toMatch(/completedTasks:\s*0/);
    expect(orchestratorSource).not.toMatch(/priorityB - priorityA/);
    expect(orchestratorSource).not.toMatch(/waitReason === 'tab-hidden' \? 1200 : 400/);
    expect(orchestratorSource).not.toMatch(/visibilityPolicy === 'background_allowed' \? 300 : 150/);
    expect(orchestratorSource).not.toMatch(/window\.addEventListener\('pagehide'/);
    expect(orchestratorSource).not.toMatch(/chrome\.runtime\.onMessage\.addListener/);
    expect(orchestratorSource).not.toMatch(/deferredRetryTimers/);
    expect(orchestratorSource).not.toMatch(/warning: circular dependency or missing dependency detected/);
  });

  it('keeps actor enhancement implementation under features with content paths as compatibility exports', () => {
    const expectedFiles = [
      'apps/extension/src/features/actorEnhancement/index.ts',
      'apps/extension/src/features/actorEnhancement/actorEnhancementManager.ts',
      'apps/extension/src/features/actorEnhancement/actorQuickActionsManager.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyFiles = [
      'apps/extension/src/content/enhancements/actorEnhancement.ts',
      'apps/extension/src/content/enhancements/actorQuickActions.ts',
    ];

    for (const relative of legacyFiles) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      const nonEmptyLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${relative} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(source, `${relative} should re-export from features/actorEnhancement`).toMatch(/features\/actorEnhancement/);
    }

    const contentBootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    expect(contentBootstrap).toMatch(/features\/actorEnhancement/);
  });

  it('keeps background misc message router under apps with legacy background path as compatibility export', () => {
    const expectedFiles = [
      'apps/extension/src/apps/background/miscMessageRouter.ts',
      'apps/extension/src/features/previews/backgroundHandlers.ts',
      'apps/extension/src/features/newWorks/backgroundMessages.ts',
      'apps/extension/src/apps/background/orchestratorMetrics.ts',
      'apps/extension/src/apps/background/embyDynamicContentScripts.ts',
      'apps/extension/src/apps/background/tabMessageHandlers.ts',
      'apps/extension/src/apps/background/networkMessageHandlers.ts',
      'apps/extension/src/apps/background/userProfileMessageHandler.ts',
      'apps/extension/src/apps/background/utilityMessageHandlers.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const miscRouter = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/miscMessageRouter.ts'), 'utf8');
    expect(miscRouter).toMatch(/features\/previews/);
    expect(miscRouter).toMatch(/features\/newWorks\/backgroundMessages/);
    expect(miscRouter).toMatch(/\.\/orchestratorMetrics/);
    expect(miscRouter).toMatch(/\.\/embyDynamicContentScripts/);
    expect(miscRouter).toMatch(/\.\/tabMessageHandlers/);
    expect(miscRouter).toMatch(/\.\/networkMessageHandlers/);
    expect(miscRouter).toMatch(/\.\/userProfileMessageHandler/);
    expect(miscRouter).toMatch(/\.\/utilityMessageHandlers/);

    const legacyPath = 'apps/extension/src/background/miscHandlers.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/apps\/background\/miscMessageRouter/);

    const bootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/bootstrap.ts'), 'utf8');
    expect(bootstrap).toMatch(/\.\/miscMessageRouter/);
  });

  it('keeps background DB router under apps with legacy background path as compatibility export', () => {
    const targetPath = 'apps/extension/src/apps/background/dbMessageRouter.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/apps/background/dbTagsMessageHandlers.ts')), 'apps/extension/src/apps/background/dbTagsMessageHandlers.ts should exist').toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/apps/background/dbMagnetPushLogMessageHandlers.ts')), 'apps/extension/src/apps/background/dbMagnetPushLogMessageHandlers.ts should exist').toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/apps/background/dbInsightsMessageHandlers.ts')), 'apps/extension/src/apps/background/dbInsightsMessageHandlers.ts should exist').toBe(true);
    expect(fs.existsSync(path.resolve(root, 'apps/extension/src/apps/background/dbLogMessageHandlers.ts')), 'apps/extension/src/apps/background/dbLogMessageHandlers.ts should exist').toBe(true);

    const legacyPath = 'apps/extension/src/background/dbRouter.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/apps\/background\/dbMessageRouter/);

    const bootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/bootstrap.ts'), 'utf8');
    expect(bootstrap).toMatch(/\.\/dbMessageRouter/);

    const dbRouter = fs.readFileSync(path.resolve(root, targetPath), 'utf8');
    expect(dbRouter).toMatch(/\.\/dbTagsMessageHandlers/);
    expect(dbRouter).toMatch(/\.\/dbMagnetPushLogMessageHandlers/);
    expect(dbRouter).toMatch(/\.\/dbInsightsMessageHandlers/);
    expect(dbRouter).toMatch(/\.\/dbLogMessageHandlers/);
  });

  it('keeps background scheduler under apps with legacy background path as compatibility export', () => {
    const targetPath = 'apps/extension/src/apps/background/scheduler.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/background/scheduler.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/apps\/background\/scheduler/);

    const alarmRouter = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/alarmRouter.ts'), 'utf8');
    const utilityHandlers = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/utilityMessageHandlers.ts'), 'utf8');
    expect(alarmRouter).toMatch(/\.\/scheduler/);
    expect(utilityHandlers).toMatch(/\.\/scheduler/);
  });

  it('keeps 115 v2 background proxy under drive115 feature with legacy background path as compatibility export', () => {
    const targetPath = 'apps/extension/src/features/drive115/v2/backgroundProxy.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/background/drive115Proxy.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/features\/drive115\/v2\/backgroundProxy/);

    const bootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/bootstrap.ts'), 'utf8');
    expect(bootstrap).toMatch(/features\/drive115\/v2\/backgroundProxy/);
  });

  it('keeps storage migrations under platform with legacy background path as compatibility export', () => {
    const targetPath = 'apps/extension/src/platform/storage/migrations.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/background/migrations.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/platform\/storage\/migrations/);

    const bootstrap = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/background/bootstrap.ts'), 'utf8');
    expect(bootstrap).toMatch(/platform\/storage\/migrations/);
  });

  it('keeps IndexedDB storage split into schema, connection, log fields, and viewed index helpers', () => {
    const expectedFiles = [
      'apps/extension/src/platform/storage/indexedDb.ts',
      'apps/extension/src/platform/storage/indexedDbConnection.ts',
      'apps/extension/src/platform/storage/indexedDbSchema.ts',
      'apps/extension/src/platform/storage/indexedDbLogFields.ts',
      'apps/extension/src/platform/storage/indexedDbViewedIndexes.ts',
      'apps/extension/src/platform/storage/indexedDbActorsStats.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const indexedDbSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/platform/storage/indexedDb.ts'), 'utf8');
    const indexedDbLineCount = indexedDbSource.split(/\r?\n/).length;
    expect(indexedDbLineCount, 'indexedDb.ts should keep shrinking as storage internals move out').toBeLessThanOrEqual(2100);
    expect(indexedDbSource).toMatch(/\.\/indexedDbConnection/);
    expect(indexedDbSource).toMatch(/\.\/indexedDbSchema/);
    expect(indexedDbSource).toMatch(/\.\/indexedDbLogFields/);
    expect(indexedDbSource).toMatch(/\.\/indexedDbViewedIndexes/);
    expect(indexedDbSource).not.toMatch(/\bopenDB\b/);

    const connectionSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/platform/storage/indexedDbConnection.ts'), 'utf8');
    expect(connectionSource).toMatch(/\bopenDB\b/);
    expect(connectionSource).toMatch(/\bupgrade\b/);
    expect(connectionSource).toMatch(/indexedDbSchema/);
    expect(connectionSource).toMatch(/indexedDbViewedIndexes/);
    expect(connectionSource).toMatch(/indexedDbLogFields/);
  });

  it('keeps magnet search manager focused on UI orchestration with result metadata helpers in application', () => {
    const targetPath = 'apps/extension/src/features/magnets/application/resultMetadata.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const uiHelperPaths = [
      'apps/extension/src/features/magnets/ui/magnetStyles.ts',
      'apps/extension/src/features/magnets/ui/magnetPaginationControls.ts',
      'apps/extension/src/features/magnets/ui/magnetSourceFilterControls.ts',
      'apps/extension/src/features/magnets/ui/nativeMagnetRows.ts',
      'apps/extension/src/features/magnets/ui/unifiedMagnetItem.ts',
    ];
    for (const helperPath of uiHelperPaths) {
      expect(fs.existsSync(path.resolve(root, helperPath)), `${helperPath} should exist`).toBe(true);
    }

    const managerSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/magnets/ui/magnetSearchManager.ts'), 'utf8');
    const managerLineCount = managerSource.split(/\r?\n/).length;
    expect(managerLineCount, 'magnetSearchManager.ts should keep shrinking as pure UI helpers move out').toBeLessThanOrEqual(1900);
    expect(managerSource).toMatch(/application\/resultMetadata/);

    const helperSource = fs.readFileSync(path.resolve(root, targetPath), 'utf8');
    expect(helperSource).toMatch(/parseSizeToBytes/);
    expect(helperSource).toMatch(/detectMagnetQuality/);
    expect(helperSource).toMatch(/normalizeMagnetDate/);
    expect(helperSource).toMatch(/isValidMagnetResultName/);

    const stylesSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/features/magnets/ui/magnetStyles.ts'), 'utf8');
    expect(stylesSource).toMatch(/injectUnifiedMagnetListStyles/);
    expect(stylesSource).toMatch(/injectMagnetSourceTagStyles/);
  });

  it('keeps content-side toast UI under platform browser with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/platform/browser/toast.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/toast.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/platform\/browser\/toast/);

    const violations: string[] = [];
    for (const file of listSourceFiles('apps/extension/src')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (relative === legacyPath) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of readRelativeImports(source)) {
        const target = resolveImportPath(file, specifier);
        if (target === 'apps/extension/src/content/toast') {
          violations.push(relative);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps content shared state under features with content path as a compatibility export', () => {
    const targetPath = 'apps/extension/src/features/contentState/index.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/state.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from contentState feature`).toMatch(/features\/contentState/);

    const scannedDirs = [
      'apps/extension/src/apps/content',
      'apps/extension/src/features',
      'tests/dom',
    ];
    const violations: string[] = [];

    for (const dir of scannedDirs) {
      for (const file of listSourceFiles(dir)) {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        if (relative === legacyPath) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (/content\/state|src\/content\/state/.test(source)) {
          violations.push(relative);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps content DOM utilities under platform browser and task timeout helpers under platform tasks', () => {
    const browserTarget = 'apps/extension/src/platform/browser/domUtils.ts';
    const taskTarget = 'apps/extension/src/platform/tasks/taskTimeoutGuard.ts';
    expect(fs.existsSync(path.resolve(root, browserTarget)), `${browserTarget} should exist`).toBe(true);
    expect(fs.existsSync(path.resolve(root, taskTarget)), `${taskTarget} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/utils.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(12);
    expect(legacySource).toMatch(/platform\/browser\/domUtils/);
    expect(legacySource).toMatch(/platform\/tasks\/taskTimeoutGuard/);

    const violations: string[] = [];
    for (const file of listSourceFiles('apps/extension/src')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (relative === legacyPath) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of readRelativeImports(source)) {
        const target = resolveImportPath(file, specifier);
        if (target === 'apps/extension/src/content/utils') {
          violations.push(relative);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps enhancement loading indicator under platform browser with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/platform/browser/enhancementLoadingIndicator.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/enhancementLoadingIndicator.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/platform\/browser\/enhancementLoadingIndicator/);

    const violations: string[] = [];
    for (const file of listSourceFiles('apps/extension/src')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (relative === legacyPath) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of readRelativeImports(source)) {
        const target = resolveImportPath(file, specifier);
        if (target === 'apps/extension/src/content/enhancementLoadingIndicator') {
          violations.push(relative);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps video favorite rating under the video detail feature with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/features/videoDetail/favoriteRating.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/videoFavoriteRating.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource).toMatch(/features\/videoDetail\/favoriteRating/);

    const violations: string[] = [];
    for (const file of listSourceFiles('apps/extension/src')) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (relative === legacyPath) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of readRelativeImports(source)) {
        const target = resolveImportPath(file, specifier);
        if (target === 'apps/extension/src/content/videoFavoriteRating') {
          violations.push(relative);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps video detail page handling under features with content paths as compatibility exports', () => {
    const expectedFiles = [
      'apps/extension/src/features/videoDetail/index.ts',
      'apps/extension/src/features/videoDetail/pageHandler.ts',
      'apps/extension/src/features/videoDetail/enhancer.ts',
      'apps/extension/src/features/videoDetail/favoriteRating.ts',
      'apps/extension/src/features/videoDetail/favoriteRating.css',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyFiles = [
      {
        legacyPath: 'apps/extension/src/content/videoDetail.ts',
        targetPattern: /features\/videoDetail\/pageHandler/,
      },
      {
        legacyPath: 'apps/extension/src/content/enhancedVideoDetail.ts',
        targetPattern: /features\/videoDetail\/enhancer/,
      },
    ];

    for (const item of legacyFiles) {
      const legacySource = fs.readFileSync(path.resolve(root, item.legacyPath), 'utf8');
      const nonEmptyLines = legacySource
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${item.legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(legacySource, `${item.legacyPath} should re-export from videoDetail feature`).toMatch(item.targetPattern);
    }

    const directConsumers = [
      'apps/extension/src/apps/content/bootstrap.ts',
      'apps/extension/src/apps/content/contentLifecycle.ts',
      'apps/extension/src/apps/content/contentMessageRouter.ts',
      'apps/extension/src/features/listEnhancement/content/itemProcessor.ts',
      'apps/extension/src/dashboard/tabs/settings/enhancement/orchestrator/orchestratorDesign.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use videoDetail feature directly`).not.toMatch(/content\/(?:videoDetail|enhancedVideoDetail)/);
      expect(source, `${relative} should reference features/videoDetail`).toMatch(/features\/videoDetail|\.\.\/\.\.\/videoDetail/);
    }
  });

  it('keeps content privacy implementation under privacy feature with content paths as compatibility exports', () => {
    const expectedFiles = [
      'apps/extension/src/features/privacy/content/index.ts',
      'apps/extension/src/features/privacy/content/elementProtector.ts',
      'apps/extension/src/features/privacy/content/stateListener.ts',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.resolve(root, file)), `${file} should exist`).toBe(true);
    }

    const legacyFiles = [
      {
        legacyPath: 'apps/extension/src/content/privacy/index.ts',
        targetPattern: /features\/privacy\/content/,
      },
      {
        legacyPath: 'apps/extension/src/content/privacy/elementProtector.ts',
        targetPattern: /features\/privacy\/content\/elementProtector/,
      },
      {
        legacyPath: 'apps/extension/src/content/privacy/stateListener.ts',
        targetPattern: /features\/privacy\/content\/stateListener/,
      },
    ];

    for (const item of legacyFiles) {
      const legacySource = fs.readFileSync(path.resolve(root, item.legacyPath), 'utf8');
      const nonEmptyLines = legacySource
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(nonEmptyLines.length, `${item.legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
      expect(legacySource, `${item.legacyPath} should re-export from privacy content feature`).toMatch(item.targetPattern);
    }

    const exportSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/content/export.ts'), 'utf8');
    expect(exportSource, 'content export should re-export from the page export feature').toMatch(/features\/pageExport\/content/);
    expect(exportSource, 'content export should stay a thin compatibility wrapper').not.toMatch(/requireAuthIfRestricted|createExportUI|startExport/);
  });

  it('keeps page export implementation under its feature with content path as a compatibility export', () => {
    const targetPath = 'apps/extension/src/features/pageExport/content/index.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const source = fs.readFileSync(path.resolve(root, targetPath), 'utf8');
    expect(source, 'page export feature should use privacy service directly').toMatch(/features\/privacy/);
    expect(source, 'page export feature should not depend on content privacy compatibility exports').not.toMatch(/content\/privacy|\.\/privacy/);

    const bootstrapSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    expect(bootstrapSource, 'content bootstrap should use page export feature directly').not.toMatch(/content\/export/);
    expect(bootstrapSource, 'content bootstrap should reference page export feature').toMatch(/features\/pageExport/);
  });

  it('keeps detail search links under external search with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/features/externalSearch/ui/detailSearchPanel.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/detailSearchLinks.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(12);
    expect(legacySource, `${legacyPath} should re-export from features/externalSearch`).toMatch(/features\/externalSearch/);

    const directConsumers = [
      'apps/extension/src/features/videoDetail/pageHandler.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use external search feature directly`).not.toMatch(/content\/detailSearchLinks/);
      expect(source, `${relative} should reference externalSearch`).toMatch(/externalSearch/);
    }
  });

  it('keeps password helper content implementation under passwordHelper feature with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/features/passwordHelper/content/index.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/passwordHelper.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from features/passwordHelper/content`).toMatch(/features\/passwordHelper\/content/);

    const bootstrapSource = fs.readFileSync(path.resolve(root, 'apps/extension/src/apps/content/bootstrap.ts'), 'utf8');
    expect(bootstrapSource, 'content bootstrap should use passwordHelper feature directly').not.toMatch(/content\/passwordHelper/);
    expect(bootstrapSource, 'content bootstrap should reference features/passwordHelper/content').toMatch(/features\/passwordHelper\/content/);
  });

  it('keeps anchor optimization implementation under its feature with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/features/anchorOptimization/content/index.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/anchorOptimization.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from features/anchorOptimization/content`).toMatch(/features\/anchorOptimization\/content/);

    const directConsumers = [
      'apps/extension/src/apps/content/bootstrap.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use anchorOptimization feature directly`).not.toMatch(/content\/anchorOptimization/);
      expect(source, `${relative} should reference features/anchorOptimization/content`).toMatch(/features\/anchorOptimization\/content/);
    }
  });

  it('keeps cover enhancement implementation under its feature with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/features/coverEnhancement/content/index.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/coverEnhancement.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from features/coverEnhancement/content`).toMatch(/features\/coverEnhancement\/content/);
  });

  it('keeps Emby enhancement implementation under its feature with content path as compatibility export', () => {
    const targetPath = 'apps/extension/src/features/embyEnhancement/content/index.ts';
    expect(fs.existsSync(path.resolve(root, targetPath)), `${targetPath} should exist`).toBe(true);

    const legacyPath = 'apps/extension/src/content/embyEnhancement.ts';
    const legacySource = fs.readFileSync(path.resolve(root, legacyPath), 'utf8');
    const nonEmptyLines = legacySource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(nonEmptyLines.length, `${legacyPath} should stay a thin compatibility wrapper`).toBeLessThanOrEqual(8);
    expect(legacySource, `${legacyPath} should re-export from features/embyEnhancement/content`).toMatch(/features\/embyEnhancement\/content/);

    const directConsumers = [
      'apps/extension/src/apps/content/bootstrap.ts',
      'apps/extension/src/apps/content/contentLifecycle.ts',
      'apps/extension/src/apps/content/contentMessageRouter.ts',
    ];

    for (const relative of directConsumers) {
      const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
      expect(source, `${relative} should use Emby enhancement feature directly`).not.toMatch(/content\/embyEnhancement/);
      expect(source, `${relative} should reference features/embyEnhancement/content`).toMatch(/features\/embyEnhancement\/content/);
    }
  });
});
