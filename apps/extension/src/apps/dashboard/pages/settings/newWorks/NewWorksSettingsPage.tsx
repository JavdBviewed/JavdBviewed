/**
 * @file NewWorksSettingsPage.tsx
 * @description 新作品设置 React 全页（#tab-settings/new-works-settings）
 *
 * 用 SettingSection/SettingField/SettingToggleRow 体系重建原「新作品设置」弹窗 4 区块
 * （扫描/入口/过滤/清理）；文案逐字继承旧 configModal（含 247 线白名单 h5/desc/警示口径）。
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
  deriveWhitelistDegradation,
  getNewWorksCategoryDimGroups,
  getNewWorksWhitelistTags,
  DEFAULT_NEW_WORKS_SETTINGS_FORM,
  type NewWorksSettingsFormState,
} from './newWorksSettingsModel';
import { ACTOR_SCAN_UNION_MAX_CATEGORIES } from '../../../../../features/newWorks/categoryFilter';
import { entryKey } from '@javdb/video-category-dict';

const AUTO_SAVE_MS = 1000;

const CHECKBOX_CLASS = 'h-4 w-4 shrink-0 accent-[var(--color-primary)]';

export function NewWorksSettingsPage() {
  const [form, setForm] = useState<NewWorksSettingsFormState>(DEFAULT_NEW_WORKS_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  const whitelistTags = getNewWorksWhitelistTags();
  const dimGroups = getNewWorksCategoryDimGroups();
  const whitelistSet = new Set(form.whitelistValues);
  const blacklistSet = new Set(form.blacklistValues);
  const degradation = deriveWhitelistDegradation(form.whitelistValues);

  return (
    <SettingsPageFrame
      title="新作品设置"
      description="新作品扫描、入口与过滤。变更自动保存，保存后自动检查调度立即重启。"
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
                description="建议设置为24小时或更长。建议按天级别扫描，减少无效请求。"
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
                description="避免频繁请求，建议至少3秒。请求越平稳，越不容易触发站点限制。"
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
                description="同时检查多少个演员的新作品，建议1-3个，过高可能导致请求失败。建议从 1 开始，确认稳定后再逐步提升。"
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
              label="排除已标记“看过”"
              description="避免重复收集已经确认看过的作品。"
              checked={form.excludeViewed}
              onChange={(v) => updateForm({ excludeViewed: v })}
            />
            <SettingToggleRow
              id="nwExcludeBrowsed"
              label="排除已浏览详情页"
              description="减少对已经点进去看过详情作品的重复提醒。"
              checked={form.excludeBrowsed}
              onChange={(v) => updateForm({ excludeBrowsed: v })}
            />
            <SettingToggleRow
              id="nwExcludeWant"
              label="排除已标记“想看”"
              description="把已加入待看清单的作品从新作品结果中剔除。"
              checked={form.excludeWant}
              onChange={(v) => updateForm({ excludeWant: v })}
            />
            <SettingToggleRow
              id="nwExcludeAR"
              label="排除 AR 影片"
              description="过滤掉你不想纳入追踪范围的 AR 类型作品。"
              checked={form.excludeAR}
              onChange={(v) => updateForm({ excludeAR: v })}
            />
            <SettingField
              id="nwDateRange"
              label="时间范围（月）"
              description="仅检查最近几个月内发行的作品，0 表示不限制。0 表示不限时间范围，适合第一次全量整理时使用。"
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
                  <h4 className="m-0 text-[13.5px] font-bold text-[var(--color-fg)]">白名单（只扫这些）</h4>
                  <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                    勾选后只抓取属于任一已勾选类别的作品（并集）；基础过滤是每部作品都必须同时满足的条件。数字类别勾选超过{' '}
                    {ACTOR_SCAN_UNION_MAX_CATEGORIES} 项时降级为「同时满足全部（交集）」，抓取范围会明显收窄。全部不勾 = 不限制。
                  </p>
                </div>
                <div className="shrink-0 text-[12.5px] text-[var(--color-fg-muted)]">
                  已选{' '}
                  <strong id="nwCategoryWhitelistCount" className="text-[var(--color-fg)]">
                    {form.whitelistValues.length}
                  </strong>{' '}
                  项
                  <span
                    id="nwCategoryWhitelistWarn"
                    className="ml-2 text-[var(--color-danger,#c0392b)]"
                    hidden={!degradation.degraded}
                  >
                    {degradation.warnText}
                  </span>
                </div>
              </div>

              <div className="mt-3 text-[12.5px] font-semibold text-[var(--color-fg)]">基础过滤（作品须同时满足这些）</div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {whitelistTags.map((tag) => (
                  <label key={tag.value} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--color-fg)]">
                    <input
                      type="checkbox"
                      className={`nw-whitelist-t-checkbox ${CHECKBOX_CLASS}`}
                      value={tag.value}
                      checked={whitelistSet.has(tag.value)}
                      onChange={() => toggleWhitelistValue(tag.value)}
                    />
                    {tag.label}
                  </label>
                ))}
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {dimGroups.map((dim) => (
                  <details
                    key={dim.key}
                    id={`nwCatDimWhitelist-${dim.key}`}
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
                  <h4 className="m-0 text-[13.5px] font-bold text-[var(--color-fg)]">类别黑名单（入库前剔除）</h4>
                  <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                    命中勾选类别的影片不会保存（类别取自影片详情解析；解析失败时保留不丢片）。
                  </p>
                </div>
                <div className="shrink-0 text-[12.5px] text-[var(--color-fg-muted)]">
                  已选{' '}
                  <strong id="nwCategoryBlacklistCount" className="text-[var(--color-fg)]">
                    {form.blacklistValues.length}
                  </strong>{' '}
                  项
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {dimGroups.map((dim) => (
                  <details
                    key={dim.key}
                    id={`nwCatDimBlacklist-${dim.key}`}
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
              description="自动清理已读且超过指定天数的作品。建议按你的追新节奏设置，例如 30～90 天。"
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
