/**
 * @file NewWorksSettingsPage.tsx
 * @description 新作品设置 React 全页（#tab-settings/new-works-settings）
 *
 * 用 SettingSection/SettingField/SettingToggleRow 体系重建原「新作品设置」弹窗 4 区块
 * （扫描/入口/过滤/清理）；文案经 10-06 线用户批复精简（未列文案仍继承旧 configModal 口径）。
 * 白名单合并列表 = 属性组 3 项（可播放 p / 含磁鏈 d / 含字幕 c）+ 311 字典项，AND 交集语义（10-08 线）；
 * 白/黑类别面板各加搜索框（本地态不入 form）与清空按钮；计数口径=白名单勾选总数（含属性组）/黑名单字典项数。
 * 纯自动保存（1s 防抖 + 卸载 flush）；落盘后重启调度器；存储键与逻辑层零改动。
 * @module apps/dashboard/pages/settings/newWorks
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { useDebouncedSettingsSave } from '../shared/settingsPersist';
import { loadNewWorksSettingsForm, persistNewWorksForm, toast } from './newWorksSettingsActions';
import {
  filterCategoryDimGroups,
  getNewWorksCategoryDimGroups,
  DEFAULT_NEW_WORKS_SETTINGS_FORM,
  NEW_WORKS_ATTR_ITEMS,
  type NewWorksSettingsFormState,
} from './newWorksSettingsModel';
import { entryKey } from '@javdb/video-category-dict';

const AUTO_SAVE_MS = 1000;

const CHECKBOX_CLASS = 'h-4 w-4 shrink-0 accent-[var(--color-primary)]';

export function NewWorksSettingsPage() {
  const [form, setForm] = useState<NewWorksSettingsFormState>(DEFAULT_NEW_WORKS_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 类别面板搜索词（10-06 线）：本地 React 态，不入 form、不持久化、切页重置 */
  const [whitelistQuery, setWhitelistQuery] = useState('');
  const [blacklistQuery, setBlacklistQuery] = useState('');
  const formRef = useRef(form);
  formRef.current = form;

  const persist = useCallback(async (nextForm: NewWorksSettingsFormState) => {
    const result = await persistNewWorksForm(nextForm);
    if (!result.ok) {
      setSaveError(result.error || '保存失败');
      await toast(result.error || '保存失败', 'error');
      return result;
    }
    setSaveError(null);
    await toast('设置已保存', 'success');
    return result;
  }, []);

  const { scheduleSave } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadNewWorksSettingsForm();
        if (cancelled) return;
        formRef.current = next;
        setForm(next);
      } catch (err) {
        console.error('[NewWorksSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateForm = useCallback(
    (patch: Partial<NewWorksSettingsFormState>) => {
      const next = { ...formRef.current, ...patch };
      formRef.current = next;
      setForm(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  /** 数字输入：空值/非数字不回写（保留旧值）；越界值允许输入，保存时按旧口径校验拦截 */
  const updateNumber = useCallback(
    (field: 'checkInterval' | 'requestInterval' | 'concurrency' | 'dateRange' | 'cleanupDays') =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const n = parseInt(e.currentTarget.value, 10);
        if (e.currentTarget.value === '' || !Number.isFinite(n)) return;
        updateForm({ [field]: n });
      },
    [updateForm],
  );

  const toggleWhitelistValue = useCallback(
    (value: string) => {
      const current = formRef.current.whitelistValues;
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      updateForm({ whitelistValues: next });
    },
    [updateForm],
  );

  const toggleBlacklistValue = useCallback(
    (value: string) => {
      const current = formRef.current.blacklistValues;
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      updateForm({ blacklistValues: next });
    },
    [updateForm],
  );

  const dimGroups = getNewWorksCategoryDimGroups();
  const whitelistSet = new Set(form.whitelistValues);
  const blacklistSet = new Set(form.blacklistValues);
  /** 白名单计数口径（10-08 线）：勾选总数（含属性组 3 项）；计数与搜索无关 */
  const whitelistCount = form.whitelistValues.length;
  const wlQuery = whitelistQuery.trim();
  const blQuery = blacklistQuery.trim();
  const wlVisibleGroups = filterCategoryDimGroups(dimGroups, whitelistQuery);
  const blVisibleGroups = filterCategoryDimGroups(dimGroups, blacklistQuery);
  const wlAttrVisible =
    wlQuery === ''
      ? NEW_WORKS_ATTR_ITEMS
      : NEW_WORKS_ATTR_ITEMS.filter((a) => a.label.toLowerCase().includes(wlQuery.toLowerCase()));
  const wlAttrChecked = NEW_WORKS_ATTR_ITEMS.filter((a) => whitelistSet.has(a.value)).length;

  return (
    <SettingsPageFrame
      title="新作品设置"
      description="设置自动追新的范围与节奏，修改自动保存。"
      rootDataAttrs={{ 'data-new-works-settings-react': '1' }}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="new-works-settings">
          <SettingSection
            id="new-works-scan"
            title="扫描"
            icon={<i className="fas fa-sliders-h" aria-hidden="true" />}
          >
            <SettingToggleRow
              id="nwAutoCheckEnabled"
              label="启用自动检查"
              description="在后台按设定周期扫描所有已启用订阅的演员。"
              checked={form.autoCheckEnabled}
              onChange={(v) => updateForm({ autoCheckEnabled: v })}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <SettingField
                id="nwCheckInterval"
                label="检查间隔（小时）"
                description="按天扫描即可（建议 ≥24 小时）"
              >
                <Input
                  id="nwCheckInterval"
                  type="number"
                  min={1}
                  max={168}
                  disabled={!form.autoCheckEnabled}
                  value={String(form.checkInterval)}
                  onChange={updateNumber('checkInterval')}
                />
              </SettingField>
              <SettingField
                id="nwRequestInterval"
                label="请求间隔（秒）"
                description="请求之间的停顿，建议 ≥3 秒，太频繁容易被站点限制"
              >
                <Input
                  id="nwRequestInterval"
                  type="number"
                  min={1}
                  max={60}
                  disabled={!form.autoCheckEnabled}
                  value={String(form.requestInterval)}
                  onChange={updateNumber('requestInterval')}
                />
              </SettingField>
              <SettingField
                id="nwConcurrency"
                label="并发数量"
                description="同时查几个演员，建议从 1 开始，稳定后再加大"
              >
                <Input
                  id="nwConcurrency"
                  type="number"
                  min={1}
                  max={5}
                  value={String(form.concurrency)}
                  onChange={updateNumber('concurrency')}
                />
              </SettingField>
            </div>
          </SettingSection>

          <SettingSection
            id="new-works-entry"
            title="入口"
            icon={<i className="fas fa-bolt" aria-hidden="true" />}
          >
            <SettingToggleRow
              id="nwShowActorPageScanButton"
              label="在演员页显示“扫描新作品”按钮"
              description="这是快捷入口。点击后仍会使用这里配置的类别过滤、状态过滤和去重规则。"
              checked={form.showActorPageScanButton}
              onChange={(v) => updateForm({ showActorPageScanButton: v })}
            />
          </SettingSection>

          <SettingSection
            id="new-works-filter"
            title="过滤"
            icon={<i className="fas fa-filter" aria-hidden="true" />}
          >
            <SettingToggleRow
              id="nwExcludeViewed"
              label="跳过“已看过”"
              checked={form.excludeViewed}
              onChange={(v) => updateForm({ excludeViewed: v })}
            />
            <SettingToggleRow
              id="nwExcludeBrowsed"
              label="跳过“已浏览详情”"
              checked={form.excludeBrowsed}
              onChange={(v) => updateForm({ excludeBrowsed: v })}
            />
            <SettingToggleRow
              id="nwExcludeWant"
              label="跳过“想看”清单"
              checked={form.excludeWant}
              onChange={(v) => updateForm({ excludeWant: v })}
            />
            <SettingToggleRow
              id="nwExcludeAR"
              label="不追踪 AR"
              checked={form.excludeAR}
              onChange={(v) => updateForm({ excludeAR: v })}
            />
            <SettingField
              id="nwDateRange"
              label="时间范围（月）"
              description="只看最近几个月的新作，0 = 不限"
            >
              <Input
                id="nwDateRange"
                type="number"
                min={0}
                max={24}
                value={String(form.dateRange)}
                onChange={updateNumber('dateRange')}
              />
            </SettingField>
            <SettingToggleRow
              id="nwApplyContentFilter"
              label="应用智能内容过滤"
              description="联动“功能增强 → 内容过滤”中的隐藏规则，一起过滤不想追踪的作品。"
              checked={form.applyContentFilter}
              onChange={(v) => updateForm({ applyContentFilter: v })}
            />
            <div className="px-2 pb-1">
              <a
                href="#tab-settings/enhancement-settings/list"
                className="text-[13px] text-[var(--color-primary)] hover:underline"
              >
                前往内容过滤设置
              </a>
            </div>

            <div id="nwWhitelistPanel" className="mt-1.5 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2,transparent)] px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h4 className="m-0 text-[13.5px] font-bold text-[var(--color-fg)]">只抓这些类别</h4>
                  <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                    勾选后，只抓同时满足全部已勾选项的作品（AND 交集）；全不勾 = 不限制。不确定的类别宁可少勾，勾得越多范围越窄；要排除某类作品用下面的黑名单。
                  </p>
                </div>
                <div className="shrink-0 text-[12.5px] text-[var(--color-fg-muted)]">
                  已选{' '}
                  <strong id="nwCategoryWhitelistCount" className="text-[var(--color-fg)]">
                    {whitelistCount}
                  </strong>{' '}
                  项
                  {form.whitelistValues.length > 0 ? (
                    <button
                      type="button"
                      id="nwWhitelistClearBtn"
                      aria-label="清空白名单勾选"
                      className="ml-2 rounded-[var(--radius-2)] text-[12.5px] text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)]"
                      onClick={() => updateForm({ whitelistValues: [] })}
                    >
                      清空
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-2">
                <Input
                  id="nwWhitelistSearch"
                  type="text"
                  placeholder="搜索类别"
                  value={whitelistQuery}
                  onChange={(e) => setWhitelistQuery(e.currentTarget.value)}
                />
              </div>

              {wlQuery !== '' && wlAttrVisible.length === 0 && wlVisibleGroups.length === 0 ? (
                <p className="m-0 mt-2 text-[12px] text-[var(--color-fg-muted)]">没有匹配的类别</p>
              ) : null}
              <div className="mt-2 flex flex-col gap-2">
                <details
                  id="nwCatDimWhitelist-attr"
                  open={wlQuery !== ''}
                  className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                >
                  <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] font-semibold text-[var(--color-fg)]">
                    属性
                    <span className="ml-2 font-normal text-[var(--color-fg-muted)]">
                      已选 {wlAttrChecked}/{NEW_WORKS_ATTR_ITEMS.length}
                    </span>
                  </summary>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-2 sm:grid-cols-3 md:grid-cols-4">
                    {wlAttrVisible.map((a) => (
                      <label
                        key={a.value}
                        className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-fg)]"
                      >
                        <input
                          type="checkbox"
                          className={`nw-whitelist-checkbox ${CHECKBOX_CLASS}`}
                          value={a.value}
                          checked={whitelistSet.has(a.value)}
                          onChange={() => toggleWhitelistValue(a.value)}
                        />
                        {a.label}
                      </label>
                    ))}
                  </div>
                </details>
                {wlVisibleGroups.map((dim) => (
                  <details
                    key={dim.key}
                    id={`nwCatDimWhitelist-${dim.key}`}
                    open={wlQuery !== ''}
                    className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] font-semibold text-[var(--color-fg)]">
                      {dim.label}
                      <span className="ml-2 font-normal text-[var(--color-fg-muted)]">
                        已选{' '}
                        {dim.entries.filter((e) => whitelistSet.has(entryKey(dim.key, e.id))).length}/
                        {dim.entries.length}
                      </span>
                    </summary>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-2 sm:grid-cols-3 md:grid-cols-4">
                      {dim.entries.map((e) => {
                        const k = entryKey(dim.key, e.id);
                        return (
                          <label
                            key={k}
                            className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-fg)]"
                          >
                            <input
                              type="checkbox"
                              className={`nw-whitelist-checkbox ${CHECKBOX_CLASS}`}
                              value={k}
                              checked={whitelistSet.has(k)}
                              onChange={() => toggleWhitelistValue(k)}
                            />
                            {e.label}
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </div>

            <div id="nwBlacklistPanel" className="mt-1.5 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2,transparent)] px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h4 className="m-0 text-[13.5px] font-bold text-[var(--color-fg)]">这些类别不要</h4>
                  <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                    扫到属于这些类别的作品直接跳过、不入库；解析不到类别时保留、不丢片。
                  </p>
                </div>
                <div className="shrink-0 text-[12.5px] text-[var(--color-fg-muted)]">
                  已选{' '}
                  <strong id="nwCategoryBlacklistCount" className="text-[var(--color-fg)]">
                    {form.blacklistValues.length}
                  </strong>{' '}
                  个类别
                  {form.blacklistValues.length > 0 ? (
                    <button
                      type="button"
                      id="nwBlacklistClearBtn"
                      aria-label="清空黑名单勾选"
                      className="ml-2 rounded-[var(--radius-2)] text-[12.5px] text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)]"
                      onClick={() => updateForm({ blacklistValues: [] })}
                    >
                      清空
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-2">
                <Input
                  id="nwBlacklistSearch"
                  type="text"
                  placeholder="搜索类别"
                  value={blacklistQuery}
                  onChange={(e) => setBlacklistQuery(e.currentTarget.value)}
                />
              </div>

              {blQuery !== '' && blVisibleGroups.length === 0 ? (
                <p className="m-0 mt-3 text-[12px] text-[var(--color-fg-muted)]">没有匹配的类别</p>
              ) : null}
              <div className="mt-3 flex flex-col gap-2">
                {blVisibleGroups.map((dim) => (
                  <details
                    key={dim.key}
                    id={`nwCatDimBlacklist-${dim.key}`}
                    open={blQuery !== ''}
                    className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] font-semibold text-[var(--color-fg)]">
                      {dim.label}
                      <span className="ml-2 font-normal text-[var(--color-fg-muted)]">
                        已选{' '}
                        {dim.entries.filter((e) => blacklistSet.has(entryKey(dim.key, e.id))).length}/
                        {dim.entries.length}
                      </span>
                    </summary>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-2 sm:grid-cols-3 md:grid-cols-4">
                      {dim.entries.map((e) => {
                        const k = entryKey(dim.key, e.id);
                        return (
                          <label
                            key={k}
                            className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-fg)]"
                          >
                            <input
                              type="checkbox"
                              className={`nw-blacklist-checkbox ${CHECKBOX_CLASS}`}
                              value={k}
                              checked={blacklistSet.has(k)}
                              onChange={() => toggleBlacklistValue(k)}
                            />
                            {e.label}
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </SettingSection>

          <SettingSection
            id="new-works-cleanup"
            title="清理"
            icon={<i className="fas fa-broom" aria-hidden="true" />}
          >
            <SettingToggleRow
              id="nwAutoCleanup"
              label="启用自动清理"
              description="自动移除已经处理且超过保留时间的新作品记录。"
              checked={form.autoCleanup}
              onChange={(v) => updateForm({ autoCleanup: v })}
            />
            <SettingField
              id="nwCleanupDays"
              label="清理天数"
              description="超过这个天数且已处理的记录自动清掉，建议 30～90 天"
            >
              <Input
                id="nwCleanupDays"
                type="number"
                min={7}
                max={365}
                disabled={!form.autoCleanup}
                value={String(form.cleanupDays)}
                onChange={updateNumber('cleanupDays')}
              />
            </SettingField>
          </SettingSection>

          {saveError ? (
            <p className="m-0 px-2 text-[13px] text-[var(--color-danger,#c0392b)]" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      )}
    </SettingsPageFrame>
  );
}
