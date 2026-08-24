/**
 * @file DisplaySettingsPage.tsx
 * @description 显示设置 React 全页：番号过滤 + 演员列表过滤（自研 patterns）
 * @module apps/dashboard/pages/settings/display
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import {
  getSettings,
  notifyJavdbTabsSettingsUpdated,
  saveSettings,
  syncDashboardState,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  ACTOR_LIST_FILTER_FIELDS,
  applyDisplayFormToSettings,
  DEFAULT_DISPLAY_SETTINGS_FORM,
  DISPLAY_FILTER_FIELDS,
  mapSettingsToDisplayForm,
  type DisplaySettingsFormState,
} from './displaySettingsModel';
import './displaySettingsPage.css';
const AUTO_SAVE_MS = 500;

/**
 * 显示设置完整页面（自包含 PageHeader + 表单）
 */
export function DisplaySettingsPage() {
  const [form, setForm] = useState<DisplaySettingsFormState>(DEFAULT_DISPLAY_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const persist = useCallback(async (nextForm: DisplaySettingsFormState) => {
    try {
      const current = await getSettings();
      const next = applyDisplayFormToSettings(current, nextForm);
      await saveSettings(next);
      await syncDashboardState(next);
      notifyJavdbTabsSettingsUpdated();
      setSaveError(null);
    } catch (err) {
      console.error('[DisplaySettingsPage] save failed', err);
      setSaveError(err instanceof Error ? err.message : '保存失败');
    }
  }, []);

  const { scheduleSave } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        const next = mapSettingsToDisplayForm(settings);
        formRef.current = next;
        setForm(next);
      } catch (err) {
        console.error('[DisplaySettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = useCallback(
    <K extends keyof DisplaySettingsFormState>(key: K, value: DisplaySettingsFormState[K]) => {
      const next = { ...formRef.current, [key]: value };
      formRef.current = next;
      setForm(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  return (
    <SettingsPageFrame
      className="dsp-page"
      title="列表显示设置"
      description="控制在JavDB网站上访问时，是否自动隐藏符合条件的影片。"
      rootDataAttrs={{ 'data-display-settings-react': '1' }}
      pageId="display-settings"
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="display-settings">
          <div className="grid gap-4 md:grid-cols-2">
            <SettingSection title="番号过滤">
              {DISPLAY_FILTER_FIELDS.map((field) => (
                <SettingToggleRow
                  key={field.id}
                  id={field.id}
                  label={field.label}
                  checked={form[field.key]}
                  onChange={(checked) => updateField(field.key, checked)}
                />
              ))}
            </SettingSection>

            <SettingSection title="演员过滤（列表）">
              {ACTOR_LIST_FILTER_FIELDS.map((field) => (
                <SettingToggleRow
                  key={field.id}
                  id={field.id}
                  label={field.label}
                  checked={form[field.key]}
                  onChange={(checked) => updateField(field.key, checked)}
                />
              ))}
            </SettingSection>
          </div>

          <div className="rounded-[var(--radius-3)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
            <p className="m-0 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
              基于本地演员库与订阅信息，近似识别标题中的演员并进行过滤。(通过标题识别，故存在一定误差)
            </p>
            <p className="mt-1.5 mb-0 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
              说明：演员过滤相关选项属于
              <b className="text-[var(--color-fg)]">功能增强（列表增强）</b>
              相关开关，JSON配置也不归入&quot;列表显示设置&quot;内。
            </p>
          </div>

          {saveError ? (
            <p className="m-0 text-[12.5px] text-[var(--color-danger,#c0392b)]" role="alert">
              保存失败：{saveError}
            </p>
          ) : null}
        </div>
      )}
    </SettingsPageFrame>
  );
}
