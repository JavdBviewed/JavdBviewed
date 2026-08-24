/**
 * @file InsightsSettingsPage.tsx
 * @description 报告设置 React 全页
 * @module apps/dashboard/pages/settings/insights
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  applyInsightsFormToSettings,
  buildInsightsAutoTip,
  DEFAULT_INSIGHTS_SETTINGS_FORM,
  INSIGHTS_SOURCE_OPTIONS,
  INSIGHTS_STATUS_SCOPE_OPTIONS,
  mapSettingsToInsightsForm,
  validateInsightsForm,
  type InsightsSettingsFormState,
  type InsightsSource,
  type InsightsStatusScope,
} from './insightsSettingsModel';

const AUTO_SAVE_MS = 600;

function parseNum(raw: string, fallback: number, asFloat = false): number {
  const n = asFloat ? parseFloat(raw) : parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 报告设置完整页面
 */
export function InsightsSettingsPage() {
  const [form, setForm] = useState<InsightsSettingsFormState>(DEFAULT_INSIGHTS_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const persist = useCallback(async (nextForm: InsightsSettingsFormState) => {
    const v = validateInsightsForm(nextForm);
    if (!v.isValid) {
      setSaveError(v.errors[0] || '校验失败');
      return;
    }
    try {
      const current = await getSettings();
      const next = applyInsightsFormToSettings(current, nextForm);
      await saveSettings(next);
      await syncDashboardState(next);
      setSaveError(null);
    } catch (err) {
      console.error('[InsightsSettingsPage] save failed', err);
      setSaveError(err instanceof Error ? err.message : '保存失败');
    }
  }, []);

  const { scheduleSave, mountedRef } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        const next = mapSettingsToInsightsForm(settings);
        formRef.current = next;
        setForm(next);
      } catch (err) {
        console.error('[InsightsSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    <K extends keyof InsightsSettingsFormState>(key: K, value: InsightsSettingsFormState[K]) => {
      const next = { ...formRef.current, [key]: value };
      formRef.current = next;
      setForm(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const autoTip = buildInsightsAutoTip(form);

  return (
    <SettingsPageFrame
      title="报告设置"
      description="配置报告生成所用的聚合参数，仅影响本地统计与 AI 提示词输入。"
      rootDataAttrs={{ 'data-insights-settings-react': '1' }}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="insights-settings">
          <SettingSection title="数据源与范围" description="配置报告统计的数据来源和状态范围。">
            <SettingField
              id="insightsSource"
              label="数据源模式"
              description="选择报告使用的数据来源。"
            >
              <SettingSelect
                id="insightsSource"
                value={form.source}
                onChange={(v) => update('source', v as InsightsSource)}
                options={[...INSIGHTS_SOURCE_OPTIONS]}
              />
            </SettingField>
            <SettingField
              id="insightsStatusScope"
              label="统计状态范围"
              description="选择统计时包含的状态类型。"
            >
              <SettingSelect
                id="insightsStatusScope"
                value={form.statusScope}
                onChange={(v) => update('statusScope', v as InsightsStatusScope)}
                options={[...INSIGHTS_STATUS_SCOPE_OPTIONS]}
              />
            </SettingField>
          </SettingSection>

          <SettingSection title="聚合参数" description="配置报告数据的聚合方式和统计维度。">
            <div className="grid gap-1 sm:grid-cols-2">
              <SettingField
                id="insightsTopN"
                label={<InsightsLabel text="Top N 排行数量" help="排行榜显示的条目数量（1-50）" />}
                description="1-50"
              >
                <Input
                  id="insightsTopN"
                  type="number"
                  min={1}
                  max={50}
                  value={String(form.topN)}
                  onChange={(e) => update('topN', parseNum(e.currentTarget.value, form.topN))}
                />
              </SettingField>
              <SettingField
                id="insightsMinTagCount"
                label={<InsightsLabel text="最小标签计数" help="标签至少出现的次数才会被统计（0-999）" />}
                description="0-999"
              >
                <Input
                  id="insightsMinTagCount"
                  type="number"
                  min={0}
                  max={999}
                  value={String(form.minTagCount)}
                  onChange={(e) =>
                    update('minTagCount', parseNum(e.currentTarget.value, form.minTagCount))
                  }
                />
              </SettingField>
              <SettingField
                id="insightsChangeThresholdRatio"
                label={<InsightsLabel text="显著变化阈值" help="判断趋势显著变化的阈值比例（0-1）" />}
                description="0-1"
              >
                <Input
                  id="insightsChangeThresholdRatio"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={String(form.changeThresholdRatio)}
                  onChange={(e) =>
                    update(
                      'changeThresholdRatio',
                      parseNum(e.currentTarget.value, form.changeThresholdRatio, true),
                    )
                  }
                />
              </SettingField>
              <SettingField
                id="insightsRisingLimit"
                label={<InsightsLabel text="上升标签展示数" help="显示上升趋势标签的数量（0-50）" />}
                description="0-50"
              >
                <Input
                  id="insightsRisingLimit"
                  type="number"
                  min={0}
                  max={50}
                  value={String(form.risingLimit)}
                  onChange={(e) =>
                    update('risingLimit', parseNum(e.currentTarget.value, form.risingLimit))
                  }
                />
              </SettingField>
              <SettingField
                id="insightsFallingLimit"
                label={<InsightsLabel text="下降标签展示数" help="显示下降趋势标签的数量（0-50）" />}
                description="0-50"
              >
                <Input
                  id="insightsFallingLimit"
                  type="number"
                  min={0}
                  max={50}
                  value={String(form.fallingLimit)}
                  onChange={(e) =>
                    update('fallingLimit', parseNum(e.currentTarget.value, form.fallingLimit))
                  }
                />
              </SettingField>
              <SettingField
                id="insightsMinMonthlySamples"
                label={<InsightsLabel text="最小月度样本量" help="月报生成所需的最小样本数量（0-999）" />}
                description="0-999"
              >
                <Input
                  id="insightsMinMonthlySamples"
                  type="number"
                  min={0}
                  max={999}
                  value={String(form.minMonthlySamples)}
                  onChange={(e) =>
                    update(
                      'minMonthlySamples',
                      parseNum(e.currentTarget.value, form.minMonthlySamples),
                    )
                  }
                />
              </SettingField>
            </div>
          </SettingSection>

          <SettingSection title="自动生成设置" description="配置报告的自动生成选项。">
            <SettingToggleRow
              id="insightsAutoMonthlyEnabled"
              label="启用自动月报"
              description="每月自动生成上月的观影报告。"
              checked={form.autoMonthlyEnabled}
              onChange={(c) => update('autoMonthlyEnabled', c)}
            />
            <SettingField
              id="insightsAutoMinuteOfDay"
              label="触发时间（分钟）"
              description="每月 1 日触发的时间，以当天的第几分钟表示（0-1439，例如 10 表示 00:10）。"
            >
              <Input
                id="insightsAutoMinuteOfDay"
                type="number"
                min={0}
                max={1439}
                value={String(form.autoMonthlyMinuteOfDay)}
                onChange={(e) =>
                  update(
                    'autoMonthlyMinuteOfDay',
                    parseNum(e.currentTarget.value, form.autoMonthlyMinuteOfDay),
                  )
                }
              />
            </SettingField>
            <SettingToggleRow
              id="insightsAutoCompensateEnabled"
              label="启用启动补偿"
              description="如果错过定时生成，在浏览器启动时自动补生成。"
              checked={form.autoCompensateOnStartupEnabled}
              onChange={(c) => update('autoCompensateOnStartupEnabled', c)}
            />
            {autoTip ? (
              <div
                id="insights-auto-tip"
                className="mx-2 mt-2 rounded-[var(--radius-2)] border-l-4 border-[var(--color-primary)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[13px] text-[var(--color-fg)]"
                role="status"
              >
                {autoTip}
              </div>
            ) : (
              <div id="insights-auto-tip" hidden />
            )}
          </SettingSection>

          {saveError && mountedRef.current ? (
            <p className="m-0 text-[12.5px] text-[var(--color-danger,#c0392b)]" role="alert">
              保存失败：{saveError}
            </p>
          ) : null}
        </div>
      )}
    </SettingsPageFrame>
  );
}

function InsightsLabel({ text, help }: { text: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{text}</span>
      <button
        type="button"
        className="help-btn inline-flex h-4 w-4 items-center justify-center rounded-full"
        title={help}
        aria-label={help}
      >
        <i className="fas fa-question-circle" aria-hidden="true" />
      </button>
    </span>
  );
}
