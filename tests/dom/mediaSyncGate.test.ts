/**
 * @file mediaSyncGate.test.ts
 * @description 媒体库页「同步资料库」手动同步按钮的总开关门控（BUG-P2-1）源码锁
 * @module tests/dom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pagePath = resolve(process.cwd(), 'apps/extension/src/apps/dashboard/pages/media/MediaLibraryPage.tsx');
const modelPath = resolve(process.cwd(), 'apps/extension/src/apps/dashboard/pages/media/mediaBrowseModel.ts');

describe('媒体库页手动同步总开关门控（BUG-P2-1 源码锁）', () => {
  it('页面：按钮 disabled 与 title 均由 resolveMediaSyncGate 结果驱动', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('const syncGate = resolveMediaSyncGate({ syncTargets, embyLibraryEnabled });');
    expect(src).toContain('disabled={syncing || syncGate.disabled}');
    expect(src).toContain('title={syncGate.tooltip}');
    expect(src).toContain('resolveMediaSyncGate,');
  });

  it('页面：总开关状态与 syncTargets 同批加载（try 写入 / catch 清零）', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('import { STORAGE_KEYS, isEmbyLibraryEnabled } from \'../../../../utils/config\';');
    expect(src).toContain('const [embyLibraryEnabled, setEmbyLibraryEnabled] = useState(false);');
    expect(src).toContain('setEmbyLibraryEnabled(isEmbyLibraryEnabled((settings as any)?.emby));');
    expect(src).toContain('setEmbyLibraryEnabled(false);');
  });

  it('模型：门控纯函数 + 双文案常量（阻断文案指向设置页总开关）', () => {
    const src = readFileSync(modelPath, 'utf8');
    expect(src).toContain("export const MEDIA_SYNC_TOOLTIP = '同步资料库与播放状态';");
    expect(src).toContain('export const MEDIA_SYNC_BLOCKED_TOOLTIP');
    expect(src).toContain('启用资料库同步与入库状态');
    expect(src).toContain('export function resolveMediaSyncGate(');
    expect(src).toContain("target.kind === 'media-server'");
    expect(src).toContain('hasEmbyTarget && !input.embyLibraryEnabled');
  });

  it('负锁：页面不再硬编码旧 title 字面量（文案已移 model 常量）', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).not.toContain('title="同步资料库与播放状态"');
  });
});
