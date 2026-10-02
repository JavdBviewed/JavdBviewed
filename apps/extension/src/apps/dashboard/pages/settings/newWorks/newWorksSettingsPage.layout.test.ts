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

  it('文案锁：未列文案逐字继承旧 configModal（铁口径第 11 条），10-06 线精简新文案逐字（每处 ≥1 条）', () => {
    // 未列文案一律不动（入口区块/智能内容过滤/跳转链接/自动清理/保存 toast 等）
    const inherited = [
      '启用自动检查',
      '在后台按设定周期扫描所有已启用订阅的演员。',
      '检查间隔（小时）',
      '请求间隔（秒）',
      '并发数量',
      '在演员页显示“扫描新作品”按钮',
      '这是快捷入口。点击后仍会使用这里配置的类别过滤、状态过滤和去重规则。',
      '时间范围（月）',
      '应用智能内容过滤',
      '联动“功能增强 → 内容过滤”中的隐藏规则，一起过滤不想追踪的作品。',
      '前往内容过滤设置',
      '启用自动清理',
      '自动移除已经处理且超过保留时间的新作品记录。',
      '清理天数',
      '设置已保存',
    ];
    // 10-06 线新文案（用户已批，逐字；警示新模板在 model 侧逐字锁）
    const fresh = [
      '设置自动追新的范围与节奏，修改自动保存。',
      '只抓这些类别',
      '勾选后，只抓属于任一已选类别的作品（沾一个就算）；一类都不勾 = 不按类别限制。下面的硬性条件叠加生效：勾选的每项，最终抓到的作品都必须满足。',
      '硬性条件（叠加在类别之上，勾选的每项都要满足）',
      '这些类别不要',
      '扫到属于这些类别的作品直接跳过、不入库；解析不到类别时保留、不丢片。',
      '跳过“已看过”',
      '跳过“已浏览详情”',
      '跳过“想看”清单',
      '不追踪 AR',
      '按天扫描即可（建议 ≥24 小时）',
      '请求之间的停顿，建议 ≥3 秒，太频繁容易被站点限制',
      '同时查几个演员，建议从 1 开始，稳定后再加大',
      '只看最近几个月的新作，0 = 不限',
      '超过这个天数且已处理的记录自动清掉，建议 30～90 天',
      '个类别',
      '搜索类别',
      '没有匹配的类别',
      '清空',
    ];
    // 10-07 线新增说明块（两行 muted 小字，位于硬性条件 6 项网格之下）
    const explain = [
      '例：这里勾“4K”＋下面勾“淫亂真實”= 只抓 4K 的淫亂真實。',
      '提示：单体作品 / 4K / 无码流出 在下方“類別”里也有同名项，只勾一头：要“必须是”就勾这里，要“这类全抓（不限类别）”就勾下面的。',
    ];
    for (const text of explain) {
      expect(pageSource).toContain(text);
    }
    for (const text of [...inherited, ...fresh]) {
      expect(pageSource).toContain(text);
    }
  });

  it('两搜索框 + 两清空按钮：新 id / 占位 / aria-label 在位（10-06 线）', () => {
    expect(pageSource).toContain('id="nwWhitelistSearch"');
    expect(pageSource).toContain('id="nwBlacklistSearch"');
    expect(pageSource.split('placeholder="搜索类别"').length - 1).toBe(2);
    expect(pageSource).toContain('id="nwWhitelistClearBtn"');
    expect(pageSource).toContain('id="nwBlacklistClearBtn"');
    expect(pageSource).toContain('aria-label="清空白名单勾选"');
    expect(pageSource).toContain('aria-label="清空黑名单勾选"');
  });

  it('计数口径：白名单只计 311 字典类别（不含 6 t 码）、黑名单口径不变（10-06 线）', () => {
    expect(pageSource).toContain(
      'const whitelistCount = splitNewWorksFilterValues(form.whitelistValues).categoryKeys.length;',
    );
    expect(pageSource).toContain('{form.blacklistValues.length}');
  });

  it('负锁：白/黑面板无外层 details（311 项区域保持展开，不做整体折叠）', () => {
    // 全页 <details 恰 2 处：白/黑面板各自 dimGroups.map 内的维度组手风琴；无外层整体折叠 details
    const detailsCount = (pageSource.match(/<details/g) ?? []).length;
    expect(detailsCount).toBe(2);
    expect(pageSource).toContain('id={`nwCatDimWhitelist-${dim.key}`}');
    expect(pageSource).toContain('id={`nwCatDimBlacklist-${dim.key}`}');
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
