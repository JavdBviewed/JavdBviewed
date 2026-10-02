/**
 * @file newWorksSettingsPage.layout.test.ts
 * @description 新作品设置页布局回归（源码锁）：四区块在位、字段 id/控件在位、
 * 白名单合并列表（属性组 3 项 + 311 字典项）数据面、计数行、跳转锚点、
 * 旧弹窗死码负锁、10-08 线并集/硬性条件块删除负锁
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

  it('文案锁：未列文案逐字继承旧 configModal（铁口径第 11 条），10-06/10-08 线新文案逐字（每处 ≥1 条）', () => {
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
    // 10-06/10-08 线新文案（用户已批，逐字；10-08 白名单描述 = AND 交集口径）
    const fresh = [
      '设置自动追新的范围与节奏，修改自动保存。',
      '只抓这些类别',
      '勾选后，只抓同时满足全部已勾选项的作品（AND 交集）；全不勾 = 不限制。不确定的类别宁可少勾，勾得越多范围越窄；要排除某类作品用下面的黑名单。',
      '属性',
      '可播放',
      '含磁鏈',
      '含字幕',
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

  it('计数口径（10-08 线）：白名单 = 勾选总数（含属性组字母）；黑名单 = 字典项数不变', () => {
    expect(pageSource).toContain('const whitelistCount = form.whitelistValues.length;');
    expect(pageSource).toContain('{form.blacklistValues.length}');
  });

  it('计数行渲染（10-08 线）：白名单「已选 N 项」/ 黑名单「已选 N 个类别」', () => {
    expect(pageSource).toMatch(/\{whitelistCount\}\s*<\/strong>\{' '\}\s*项/);
    expect(pageSource).toMatch(/\{form\.blacklistValues\.length\}\s*<\/strong>\{' '\}\s*个类别/);
  });

  it('负锁：面板无外层 details（311 项区域保持展开；恰 3 处 details = 白名单属性组 + 白/黑维度组手风琴）', () => {
    const detailsCount = (pageSource.match(/<details/g) ?? []).length;
    expect(detailsCount).toBe(3);
    expect(pageSource).toContain('id="nwCatDimWhitelist-attr"');
    expect(pageSource).toContain('id={`nwCatDimWhitelist-${dim.key}`}');
    expect(pageSource).toContain('id={`nwCatDimBlacklist-${dim.key}`}');
  });

  it('白名单/黑名单面板：计数行与复选框 class 在位（10-08 线：动态警示与 t 码网格已删）', () => {
    expect(pageSource).toContain('id="nwWhitelistPanel"');
    expect(pageSource).toContain('id="nwBlacklistPanel"');
    expect(pageSource).toContain('id="nwCategoryWhitelistCount"');
    expect(pageSource).toContain('id="nwCategoryBlacklistCount"');
    expect(pageSource).toContain('nw-whitelist-checkbox');
    expect(pageSource).toContain('nw-blacklist-checkbox');
  });

  it('「前往内容过滤设置」= 文档内锚点深链（无跨 tab messaging）', () => {
    expect(pageSource).toContain('href="#tab-settings/enhancement-settings/list"');
  });

  it('属性组在位（10-08 线）：白名单搜索框与维度手风琴之间、复选框同款 nw-whitelist-checkbox', () => {
    // 属性组 = details 手风琴（默认收起，搜索时强制展开），位于白名单 mt-2 手风琴容器内、dimGroups.map 之前
    expect(pageSource).toContain('id="nwCatDimWhitelist-attr"');
    expect(pageSource).toContain('open={wlQuery !== \'\'}');
    expect(pageSource).toContain('{a.value}');
    expect(pageSource).toContain('checked={whitelistSet.has(a.value)}');
    expect(pageSource).toContain('onChange={() => toggleWhitelistValue(a.value)}');
    // 属性组在 dimGroups.map 之前（同一手风琴容器内）
    const attrPos = pageSource.indexOf('id="nwCatDimWhitelist-attr"');
    const wlMapPos = pageSource.indexOf('{wlVisibleGroups.map((dim) => (')
    expect(attrPos).toBeGreaterThan(-1);
    expect(wlMapPos).toBeGreaterThan(attrPos);
  });

  it('10-08 线负锁：硬性条件 6 项网格 / 256 说明块 / 超 5 警示 / 并集降级符号全部离页', () => {
    for (const gone of [
      '硬性条件',
      '例：这里勾“4K”',
      '提示：单体作品',
      '类别勾太多',
      'getNewWorksWhitelistTags',
      'deriveWhitelistDegradation',
      'nwCategoryWhitelistWarn',
      'nw-whitelist-t-checkbox',
      'uncensored',
    ]) {
      expect(pageSource, `页面源码不应再包含: ${gone}`).not.toContain(gone);
    }
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

  it('10-08 线负锁：硬性条件 6 项网格已删（mt-1 两列网格不再存在）', () => {
    expect(pageSource).not.toContain('mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3');
  });

  it('两处手风琴容器（白名单 mt-2 / 黑名单 mt-3）：gap-1(4px)→gap-2(8px)', () => {
    expect(pageSource).toContain('<div className="mt-2 flex flex-col gap-2">');
    expect(pageSource).toContain('<div className="mt-3 flex flex-col gap-2">');
  });

  it('字典网格（白名单属性组 + 白名单 + 黑名单共 3 处）：行距 6px→8px', () => {
    const grid = '<div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-2 sm:grid-cols-3 md:grid-cols-4">';
    expect(pageSource.split(grid).length - 1).toBe(3);
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
