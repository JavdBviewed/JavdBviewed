/**
 * @file routeManagement.backgroundImport.test.ts
 * @description 后台线路自动更新不应引入浏览器页面配置聚合模块
 * @module features/routeManagement
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'index.ts'), 'utf-8');

describe('RouteManager background import boundary', () => {
  it('does not import utils/config when loaded by the service worker', () => {
    expect(source).not.toContain('../../utils/config');
    expect(source).not.toContain('DEFAULT_SETTINGS');
  });
});
