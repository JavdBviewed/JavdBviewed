// src/dashboard/tabs/mount.ts
// 负责在需要时挂载 Tab 的 partial 与样式

import { ensureMounted, loadPartial, injectPartial } from '../loaders/partialsLoader';
import { ensureStylesLoaded } from '../loaders/stylesLoader';
import { TAB_PARTIALS } from './resources';

function getTabPartial(tabId: string) {
  return TAB_PARTIALS[tabId] ?? null;
}

export async function mountTabIfNeeded(tabId: string): Promise<void> {
  try {
    // 处理设置页面的子路径（tab-settings/xxx-settings）
    if (tabId === 'tab-settings') {
      const hash = window.location.hash.substring(1);
      const [mainTab, subSection] = hash.split('/');
      
      // 如果有子路径，直接加载对应的子页面
      if (mainTab === 'tab-settings' && subSection) {
        console.debug('[mount] 检测到设置子页面:', subSection);

        // 进入子页前卸掉 React 索引，避免与 partial 叠层
        try {
          const { unmountSettingsIndexPage } = await import('../../apps/dashboard/pages/settings/mountSettingsIndexPage');
          unmountSettingsIndexPage('#tab-settings');
        } catch {}

        // 完整 React 内容页（如 Cloud）：无遗留 partial，直接挂载
        try {
          const { isReactFullSettingsPage } = await import('../../apps/dashboard/pages/settings/shared/reactFullPageIds');
          if (isReactFullSettingsPage(subSection)) {
            if (subSection === 'cloud-settings') {
              const { mountCloudSettingsPage } = await import('../../apps/dashboard/pages/settings/cloud/mountCloudSettingsPage');
              mountCloudSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 cloud-settings');
              return;
            }
            if (subSection === 'drive115-settings') {
              // 先加载 115 页级 CSS（React 页也会自行 import，这里保证 partial 同源样式就绪）
              try {
                const subCfg = getTabPartial('tab-settings-drive115');
                if (subCfg?.styles?.length) {
                  await ensureStylesLoaded(subCfg.styles);
                }
              } catch {}
              const { mountDrive115SettingsPage } = await import('../../apps/dashboard/pages/settings/drive115/mountDrive115SettingsPage');
              mountDrive115SettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 drive115-settings');
              return;
            }
            if (subSection === 'emby-settings') {
              const { mountEmbySettingsPage } = await import('../../apps/dashboard/pages/settings/emby/mountEmbySettingsPage');
              mountEmbySettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 emby-settings');
              return;
            }
            if (subSection === 'update-settings') {
              const { mountUpdateSettingsPage } = await import('../../apps/dashboard/pages/settings/update/mountUpdateSettingsPage');
              mountUpdateSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 update-settings');
              return;
            }
            if (subSection === 'enhancement-settings') {
              const { mountEnhancementSettingsPage } = await import('../../apps/dashboard/pages/settings/enhancement/mountEnhancementSettingsPage');
              mountEnhancementSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 enhancement-settings');
              return;
            }
            if (subSection === 'display-settings') {
              const { mountDisplaySettingsPage } = await import('../../apps/dashboard/pages/settings/display/mountDisplaySettingsPage');
              mountDisplaySettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 display-settings');
              return;
            }
            if (subSection === 'search-engine-settings') {
              const { mountSearchEngineSettingsPage } = await import('../../apps/dashboard/pages/settings/searchEngine/mountSearchEngineSettingsPage');
              mountSearchEngineSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 search-engine-settings');
              return;
            }
            if (subSection === 'ai-settings') {
              const { mountAISettingsPage } = await import('../../apps/dashboard/pages/settings/ai/mountAISettingsPage');
              mountAISettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 ai-settings');
              return;
            }
            if (subSection === 'privacy-settings') {
              const { mountPrivacySettingsPage } = await import('../../apps/dashboard/pages/settings/privacy/mountPrivacySettingsPage');
              mountPrivacySettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 privacy-settings');
              return;
            }
            if (subSection === 'webdav-settings') {
              const { mountWebdavSettingsPage } = await import('../../apps/dashboard/pages/settings/webdav/mountWebdavSettingsPage');
              mountWebdavSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 webdav-settings');
              return;
            }
            if (subSection === 'sync-settings') {
              const { mountSyncSettingsPage } = await import('../../apps/dashboard/pages/settings/sync/mountSyncSettingsPage');
              mountSyncSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 sync-settings');
              return;
            }
            if (subSection === 'insights-settings') {
              const { mountInsightsSettingsPage } = await import('../../apps/dashboard/pages/settings/insights/mountInsightsSettingsPage');
              mountInsightsSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 insights-settings');
              return;
            }
            if (subSection === 'log-settings') {
              const { mountLogSettingsPage } = await import('../../apps/dashboard/pages/settings/log/mountLogSettingsPage');
              mountLogSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 log-settings');
              return;
            }
            if (subSection === 'advanced-settings') {
              const { mountAdvancedSettingsPage } = await import('../../apps/dashboard/pages/settings/advanced/mountAdvancedSettingsPage');
              mountAdvancedSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 advanced-settings');
              return;
            }
            if (subSection === 'network-test-settings') {
              const { mountNetworkTestSettingsPage } = await import('../../apps/dashboard/pages/settings/networkTest/mountNetworkTestSettingsPage');
              mountNetworkTestSettingsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 network-test-settings');
              return;
            }
            if (subSection === 'global-actions') {
              const { mountGlobalActionsPage } = await import('../../apps/dashboard/pages/settings/globalActions/mountGlobalActionsPage');
              mountGlobalActionsPage('#tab-settings');
              console.debug('[mount] 设置子页：React 全页 global-actions');
              return;
            }
          }
        } catch (e) {
          console.warn('[mount] React 全页设置挂载失败，回退 partial（若有）', e);
        }

        // 设置子页：统一 React 壳（固定返回钮）+ 原 partial HTML/CSS/弹窗交互
        // 完整 React 内容页默认极少接入，避免覆盖已微调样式
        const subPageKey = `tab-settings-${subSection.replace('-settings', '')}`;
        const subCfg = getTabPartial(subPageKey);

        console.debug('[mount] 子页面配置键:', subPageKey);
        console.debug('[mount] 子页面配置:', subCfg);

        if (subCfg) {
          const html = await loadPartial(subCfg.name);
          if (html) {
            const { resolveSettingsSubpageMeta } = await import('../../apps/dashboard/pages/settings/settingsNavModel');
            const { mountSettingsSubpageShell } = await import('../../apps/dashboard/pages/settings/mountSettingsSubpageShell');
            const meta = resolveSettingsSubpageMeta(subSection);
            mountSettingsSubpageShell({
              title: meta.title,
              description: meta.description,
              panelHtml: html,
              panelRootId: meta.panelRootId,
            });
            console.debug('[mount] 设置子页：React 壳 + 原 partial', subSection);
          } else {
            console.warn('[mount] 设置子页 partial 为空:', subCfg.name);
          }

          if (subCfg.styles && subCfg.styles.length) {
            await ensureStylesLoaded(subCfg.styles);
          }

          return;
        } else {
          console.warn('[mount] 未找到子页面配置，回退到导航页:', subPageKey);
        }
      }
      
      // 没有子路径：设置中心索引页由 React 接管，跳过 HTML partial
      const cfg = getTabPartial('tab-settings');
      if (cfg?.styles?.length) {
        await ensureStylesLoaded(cfg.styles);
      }
      // 清空可能残留的子页 HTML，交给 initSettingsTab 挂 React
      const host = document.getElementById('tab-settings');
      if (host && host.querySelector('[data-settings-react-root]') == null) {
        // 保留空容器；init 会渲染
      }
      console.debug('[mount] 设置导航页交给 React 入口');
      return;
    }
    
    // 原有逻辑
    const cfg = getTabPartial(tabId);
    if (!cfg) return;

    // React/脚本自建 DOM 的 tab：不注入 HTML partial
    if (cfg.skipPartial) {
      if (cfg.styles && cfg.styles.length) {
        await ensureStylesLoaded(cfg.styles);
      }
      return;
    }

    const selector = `#${tabId}`;
    const el = document.querySelector(selector) as HTMLElement | null;

    // 先尝试仅在空容器时挂载，兼容已迁移完成的占位容器
    await ensureMounted(selector, cfg.name);

    // 如果仍然是旧的内联DOM（未标记partialLoaded），执行一次性替换为partial
    if (el && (el as any).dataset?.partialLoaded !== 'true') {
      const html = await loadPartial(cfg.name);
      if (html) {
        await injectPartial(selector, html, { mode: 'replace' });
      }
    }

    if (cfg.styles && cfg.styles.length) {
      await ensureStylesLoaded(cfg.styles);
    }
  } catch (e) {
    console.warn('[Dashboard] mountTabIfNeeded failed for', tabId, e);
  }
}
