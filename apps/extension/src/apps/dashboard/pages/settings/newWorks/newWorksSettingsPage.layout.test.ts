/**
 * @file newWorksSettingsPage.layout.test.ts
 * @description 新作品设置页布局回归（源码锁）：四区块在位、字段 id/控件在位、
 * 白名单 6+311 复选框数据面、计数行与警示、跳转锚点、旧弹窗死码负锁
 * @module apps/dashboard/pages/settings/newWorks
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'NewWorksSettingsPage.tsx'), 'utf8');
const mountSourceFile = join(here, 'mountNewWorksSettingsPage.ts');
const mountSource = readFileSync(mountSourceFile, 'utf8');
const reactFullSource = readFileSync(join(here, '..', 'shared', 'reactFullPageIds.ts'), 'utf8');
const mountTabsSource = readFileSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'mount.ts'), 'utf8');
const navModelSource = readFileSync(join(here, '..', 'settingsNavModel.ts'), 'utf8');
const legacySettingsSource = readFileSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'settings', 'index.ts'), 'utf8');
const newWorksPartialSource = readFileSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'partials', 'tabs', 'new-works.html'), 'utf8');

describe('NewWorksSettingsPage 路由与导航', () => {
  it('settingsNavModel 新卡在位（title/desc/icon）', () => {
    expect(navModelSource).toContain("id: 'new-works-settings'");
    expect(navModelSource).toContain('title: \'新作品\'');
    expect(navModelSource).toContain('description: \'新作品扫描、入口与过滤\'');
    expect(navModelSource).toContain('icon: \'fa-rss\'');
  });

  it('进入 React 全页名单并注册 mount 分支（legacy 路径经 isReactFullSettingsPage 短路）', () => {
    expect(reactFullSource).toContain("'new-works-settings'");
    expect(mountTabsSource).toContain('mountNewWorksSettingsPage');
    expect(mountTabsSource).toContain("subSection === 'new-works-settings'");
    expect(mountSource).toContain('data-new-works-settings-react');
    expect(legacySettingsSource).toContain('isReactFullSettingsPage');
  });
});

describe('NewWorksSettingsPage 四区块与字段', () => {
  it('四区块标题在位：扫描/入口/过滤/清理（icon 与旧弹窗一致）', () => {
    for (const [title, icon, id] of [
      ['扫描', 'fa-sliders-h', 'new-works-scan'],
      ['入口', 'fa-bolt', 'new-works-entry'],
      ['过滤', 'fa-filter', 'new-works-filter'],
      ['清理', 'fa-broom', 'new-works-cleanup'],
    ] as const) {
      expect(pageSource).toContain(`title="${title}"`);
      expect(pageSource).toContain(`id="${id}"`);
      expect(pageSource).toContain(`fa-${icon.slice(3)}`);
    }
  });

  it('13 个表单字段 id 稳定（探针与设置搜索锚点）', () => {
    const ids = [
      'nwAutoCheckEnabled',
      'nwCheckInterval',
      'nwRequestInterval',
      'nwConcurrency',
      'nwShowActorPageScanButton',
      'nwExcludeViewed',
      'nwExcludeBrowsed',
      'nwExcludeWant',
      'nwExcludeAR',
      'nwDateRange',
      'nwApplyContentFilter',
      'nwAutoCleanup',
      'nwCleanupDays',
    ];
    for (const id of ids) {
      expect(pageSource).toContain(`id="${id}"`);
    }
  });

  it('自动检查关闭→检查间隔/请求间隔禁用（并发恒可用，镜像旧弹窗 updateFormState 联动）', () => {
    const checkInput = /<Input\s+id="nwCheckInterval"[\s\S]*?\/>/.exec(pageSource)?.[0] ?? '';
    const reqInput = /<Input\s+id="nwRequestInterval"[\s\S]*?\/>/.exec(pageSource)?.[0] ?? '';
    const concInput = /<Input\s+id="nwConcurrency"[\s\S]*?\/>/.exec(pageSource)?.[0] ?? '';
    expect(checkInput).toContain('disabled={!form.autoCheckEnabled}');
    expect(reqInput).toContain('disabled={!form.autoCheckEnabled}');
    expect(concInput).not.toContain('disabled');
  });

  it('文案逐字继承旧 configModal（含 247 线白名单/黑名单口径）', () => {
    const verbatim = [
      '启用自动检查',
      '在后台按设定周期扫描所有已启用订阅的演员。',
      '检查间隔（小时）',
      '请求间隔（秒）',
      '并发数量',
      '在演员页显示“扫描新作品”按钮',
      '这是快捷入口。点击后仍会使用这里配置的类别过滤、状态过滤和去重规则。',
      '排除已标记“看过”',
      '避免重复收集已经确认看过的作品。',
      '排除已浏览详情页',
      '减少对已经点进去看过详情作品的重复提醒。',
      '排除已标记“想看”',
      '把已加入待看清单的作品从新作品结果中剔除。',
      '排除 AR 影片',
      '过滤掉你不想纳入追踪范围的 AR 类型作品。',
      '时间范围（月）',
      '应用智能内容过滤',
      '联动“功能增强 → 内容过滤”中的隐藏规则，一起过滤不想追踪的作品。',
      '前往内容过滤设置',
      '白名单（只扫这些）',
      '勾选后只抓取属于任一已勾选类别的作品（并集）；基础过滤是每部作品都必须同时满足的条件。数字类别勾选超过',
      '项时降级为「同时满足全部（交集）」，抓取范围会明显收窄。全部不勾 = 不限制。',
      '基础过滤（作品须同时满足这些）',
      '类别黑名单（入库前剔除）',
      '命中勾选类别的影片不会保存（类别取自影片详情解析；解析失败时保留不丢片）。',
      '启用自动清理',
      '自动移除已经处理且超过保留时间的新作品记录。',
      '清理天数',
      '建议按你的追新节奏设置，例如 30～90 天。',
      '设置已保存',
    ];
    for (const text of verbatim) {
      expect(pageSource).toContain(text);
    }
  });

  it('白名单/黑名单面板：计数行、动态警示、复选框 class 在位', () => {
    expect(pageSource).toContain('id="nwWhitelistPanel"');
    expect(pageSource).toContain('id="nwBlacklistPanel"');
    expect(pageSource).toContain('id="nwCategoryWhitelistCount"');
    expect(pageSource).toContain('id="nwCategoryBlacklistCount"');
    expect(pageSource).toContain('id="nwCategoryWhitelistWarn"');
    expect(pageSource).toContain('nw-whitelist-t-checkbox');
    expect(pageSource).toContain('nw-whitelist-checkbox');
    expect(pageSource).toContain('nw-blacklist-checkbox');
    expect(pageSource).toContain('deriveWhitelistDegradation');
    expect(pageSource).toContain('hidden={!degradation.degraded}');
  });

  it('「前往内容过滤设置」= 文档内锚点深链（无跨 tab messaging）', () => {
    expect(pageSource).toContain('href="#tab-settings/enhancement-settings/list"');
  });
});

describe('NewWorksSettingsPage 保存语义', () => {
  it('纯 autosave（1s 防抖 + 卸载 flush）+ 落盘后重启调度器', () => {
    expect(pageSource).toContain('useDebouncedSettingsSave');
    expect(pageSource).toContain('delayMs: AUTO_SAVE_MS');
    expect(pageSource).toContain('AUTO_SAVE_MS = 1000');
    const actionsSource = readFileSync(join(here, 'newWorksSettingsActions.ts'), 'utf8');
    expect(actionsSource).toContain("type: 'new-works-scheduler-restart'");
    expect(actionsSource).toContain('updateGlobalConfig');
  });
});

describe('NewWorksSettingsPage 死码负锁', () => {
  it('new-works partial 无「新作品设置」按钮（fa-cog 齿轮已删）', () => {
    expect(newWorksPartialSource).not.toContain('newWorksGlobalConfigBtn');
    expect(newWorksPartialSource).not.toContain('fa-cog');
    expect(newWorksPartialSource).not.toContain('新作品设置');
  });

  it('旧弹窗与 workflow 文件已删除，页面无旧弹窗 DOM 残留', () => {
    expect(existsSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'components', 'newWorks', 'configModal.ts'))).toBe(false);
    expect(existsSync(join(here, '..', '..', '..', '..', '..', 'dashboard', 'tabs', 'newWorksGlobalConfigWorkflow.ts'))).toBe(false);
    expect(pageSource).not.toContain('new-works-config-modal');
    expect(pageSource).not.toContain('newWorksConfigForm');
  });
});

describe('NewWorksSettingsPage 容器间距（253 线间距修正锁）', () => {
  const panelClass = 'className="mt-1.5 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2,transparent)] px-3 py-3">';

  it('扫描区 3 列网格：gap-0.5(2px)→gap-2(8px)', () => {
    expect(pageSource).toContain('<div className="grid gap-2 sm:grid-cols-3">');
  });

  it('t 码基础过滤网格：行距 6px→8px（gap-y-2，列距 gap-x-4 不动）', () => {
    expect(pageSource).toContain('<div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">');
  });

  it('两处手风琴容器（白名单 mt-2 / 黑名单 mt-3）：gap-1(4px)→gap-2(8px)', () => {
    expect(pageSource).toContain('<div className="mt-2 flex flex-col gap-2">');
    expect(pageSource).toContain('<div className="mt-3 flex flex-col gap-2">');
  });

  it('字典网格（白名单+黑名单共 2 处）：行距 6px→8px', () => {
    const grid = '<div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-2 sm:grid-cols-3 md:grid-cols-4">';
    expect(pageSource.split(grid).length - 1).toBe(2);
  });

  it('白名单/黑名单面板各加 mt-1.5（body 2px + mt 6px = 8px，与上方内容及彼此分离）', () => {
    expect(pageSource.split(panelClass).length - 1).toBe(2);
  });

  it('根容器 gap-4 不动；旧紧贴类（gap-0.5/gap-y-1.5/flex-col gap-1）零残留', () => {
    expect(pageSource).toContain('<div className="flex flex-col gap-4" id="new-works-settings">');
    expect(pageSource).not.toContain('gap-0.5');
    expect(pageSource).not.toContain('gap-y-1.5');
    expect(pageSource).not.toContain('flex-col gap-1');
  });
});
