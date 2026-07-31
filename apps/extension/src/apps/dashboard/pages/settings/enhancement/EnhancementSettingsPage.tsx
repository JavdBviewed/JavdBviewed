/**
 * @file EnhancementSettingsPage.tsx
 * @description 功能增强设置 React 全页（列表/影片/演员/其他）
 * @module apps/dashboard/pages/settings/enhancement
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { Tabs } from '../../../../../ui/primitives/Tabs/Tabs';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { KeywordFilterRule } from '../../../../../types';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { SettingsHighlightNotice } from '../shared/SettingsHighlightNotice';
import { useDebouncedSettingsSave } from '../shared/settingsPersist';
import {
  exportOrchestrationDiagnostics,
  fetchAlarmDiagnosticsSummary,
  loadEnhancementSettingsForm,
  navigateToAISettings,
  persistEnhancementForm,
  readAiSelectedModelLabel,
  toast,
} from './enhancementSettingsActions';
import {
  ACTOR_DEFAULT_TAG_OPTIONS,
  ACTOR_REMARKS_MODE_OPTIONS,
  ANCHOR_POSITION_OPTIONS,
  AUTO_MARK_STARS_OPTIONS,
  createSimpleFilterRule,
  DEFAULT_ENHANCEMENT_SETTINGS_FORM,
  ENHANCEMENT_SUBTABS,
  getFilterActionLabel,
  LIST_SORTING_APPEND_OPTIONS,
  LIST_SORTING_POSITION_OPTIONS,
  MAGNET_SORT_OPTIONS,
  ONLINE_AVAILABILITY_SITE_OPTIONS,
  PASSWORD_SHOW_METHOD_OPTIONS,
  PREVIEW_SOURCE_OPTIONS,
  removeFilterRuleAt,
  setFilterRuleEnabled,
  toggleActorDefaultTag,
  toggleOnlineAvailabilitySite,
  TRANSLATION_DISPLAY_MODE_OPTIONS,
  TRANSLATION_PROVIDER_OPTIONS,
  WATERMARK_POSITION_OPTIONS,
  type EnhancementSettingsFormState,
  type EnhancementSubtab,
} from './enhancementSettingsModel';

const AUTO_SAVE_MS = 1000;

function parseNum(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntNum(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 功能增强完整页面
 */
export function EnhancementSettingsPage() {
  const [form, setForm] = useState<EnhancementSettingsFormState>(DEFAULT_ENHANCEMENT_SETTINGS_FORM);
  const [subtab, setSubtab] = useState<EnhancementSubtab>(() => {
    try {
      const last = localStorage.getItem('enhancementSubtab') as EnhancementSubtab | null;
      if (last === 'list' || last === 'video' || last === 'actor' || last === 'other') return last;
    } catch {
      /* ignore */
    }
    return 'list';
  });
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState('');
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagNote, setDiagNote] = useState<string | null>(null);
  const [newRuleKeyword, setNewRuleKeyword] = useState('');

  const persist = useCallback(async (nextForm: EnhancementSettingsFormState) => {
    const result = await persistEnhancementForm(nextForm);
    if (!result.ok) {
      setSaveError(result.error || '保存失败');
      return;
    }
    setSaveError(null);
  }, []);

  const { scheduleSave, flush } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadEnhancementSettingsForm();
        if (cancelled) return;
        setForm(next);
        const model = await readAiSelectedModelLabel();
        if (!cancelled) setAiModel(model);
      } catch (err) {
        console.error('[EnhancementSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchForm = useCallback(
    (patch: Partial<EnhancementSettingsFormState>) => {
      setForm((prev) => {
        const next = { ...prev, ...patch };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const setToggle = useCallback(
    <K extends keyof EnhancementSettingsFormState>(key: K, value: EnhancementSettingsFormState[K]) => {
      patchForm({ [key]: value } as Partial<EnhancementSettingsFormState>);
    },
    [patchForm],
  );

  const onSubtab = (id: string) => {
    const next = id as EnhancementSubtab;
    setSubtab(next);
    try {
      localStorage.setItem('enhancementSubtab', next);
    } catch {
      /* ignore */
    }
  };

  const onAddFilterRule = () => {
    const rule = createSimpleFilterRule(newRuleKeyword);
    if (!rule.keyword) {
      void toast('请输入关键词', 'warning');
      return;
    }
    const nextRules = [...form.filterRules, rule];
    patchForm({ filterRules: nextRules, enableContentFilter: true });
    setNewRuleKeyword('');
  };

  const onToggleRule = (index: number, enabled: boolean) => {
    patchForm({ filterRules: setFilterRuleEnabled(form.filterRules, index, enabled) });
  };

  const onDeleteRule = (index: number) => {
    patchForm({ filterRules: removeFilterRuleAt(form.filterRules, index) });
  };

  const onAlarmDiag = async () => {
    setDiagBusy(true);
    try {
      const summary = await fetchAlarmDiagnosticsSummary();
      setDiagNote(summary);
      await toast(summary, 'info');
    } finally {
      setDiagBusy(false);
    }
  };

  const onExportDiag = async () => {
    setDiagBusy(true);
    try {
      const result = await exportOrchestrationDiagnostics();
      if (result.ok) {
        setDiagNote('诊断包已导出');
        await toast('编排诊断包已导出', 'success');
      } else {
        setDiagNote(result.error || '导出失败');
        await toast(result.error || '导出失败', 'error');
      }
    } finally {
      setDiagBusy(false);
    }
  };

  if (loading) {
    return (
      <SettingsPageFrame
        title="功能增强设置"
        description="加载中…"
        rootDataAttrs={{ 'data-enhancement-settings-react': '1' }}
      >
        <p className="text-sm text-[var(--color-fg-muted)]">正在加载增强设置…</p>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame
      title="功能增强设置"
      description="解锁列表/影片/演员页增强与其它体验优化；变更自动保存。"
      rootDataAttrs={{ 'data-enhancement-settings-react': '1' }}
      className="enhancement-settings-react"
    >
      <div id="enhancement-settings" className="flex flex-col gap-4" data-settings-page="enhancement">
        <SettingsHighlightNotice title="功能增强仍在测试中">
          列表、影片、演员页增强覆盖的站点和页面结构较多，部分能力可能受源站改版影响。遇到异常可以到{' '}
          <a
            href="https://github.com/JavdBviewed/JavdBviewed/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Issues
          </a>{' '}
          反馈现象、截图和日志。
        </SettingsHighlightNotice>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            items={ENHANCEMENT_SUBTABS}
            value={subtab}
            onChange={onSubtab}
            size="sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              id="showAlarmDiagnosticsBtn"
              type="button"
              variant="secondary"
              size="sm"
              disabled={diagBusy}
              onClick={() => void onAlarmDiag()}
            >
              后台定时
            </Button>
            <Button
              id="showOrchestratorBtn"
              type="button"
              variant="secondary"
              size="sm"
              disabled={diagBusy}
              onClick={() => void onExportDiag()}
              title="导出编排/定时诊断包（完整可视化面板仍走遗留 DOM）"
            >
              导出诊断包
            </Button>
          </div>
        </div>

        {saveError ? (
          <p className="m-0 rounded-[var(--radius-2)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {saveError}
          </p>
        ) : null}
        {diagNote ? (
          <p className="m-0 text-xs text-[var(--color-fg-muted)]">{diagNote}</p>
        ) : null}

        {subtab === 'list' ? <ListTab form={form} setToggle={setToggle} patchForm={patchForm} newRuleKeyword={newRuleKeyword} setNewRuleKeyword={setNewRuleKeyword} onAddFilterRule={onAddFilterRule} onToggleRule={onToggleRule} onDeleteRule={onDeleteRule} /> : null}
        {subtab === 'video' ? <VideoTab form={form} setToggle={setToggle} patchForm={patchForm} aiModel={aiModel} /> : null}
        {subtab === 'actor' ? <ActorTab form={form} setToggle={setToggle} patchForm={patchForm} /> : null}
        {subtab === 'other' ? <OtherTab form={form} setToggle={setToggle} patchForm={patchForm} /> : null}

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void flush(form).then(() => toast('已保存', 'success'));
            }}
          >
            立即保存
          </Button>
        </div>
      </div>
    </SettingsPageFrame>
  );
}

type TabProps = {
  form: EnhancementSettingsFormState;
  setToggle: <K extends keyof EnhancementSettingsFormState>(
    key: K,
    value: EnhancementSettingsFormState[K],
  ) => void;
  patchForm: (patch: Partial<EnhancementSettingsFormState>) => void;
};

function ListTab({
  form,
  setToggle,
  patchForm,
  newRuleKeyword,
  setNewRuleKeyword,
  onAddFilterRule,
  onToggleRule,
  onDeleteRule,
}: TabProps & {
  newRuleKeyword: string;
  setNewRuleKeyword: (v: string) => void;
  onAddFilterRule: () => void;
  onToggleRule: (i: number, enabled: boolean) => void;
  onDeleteRule: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SettingSection title="内容过滤" description="按关键词隐藏/高亮列表中的影片卡片">
        <SettingToggleRow
          id="enableContentFilter"
          label="启用内容过滤"
          description="在列表页应用关键字过滤规则"
          checked={form.enableContentFilter}
          onChange={(v) => setToggle('enableContentFilter', v)}
        />
        {form.enableContentFilter ? (
          <div id="contentFilterConfig" className="mt-2 flex flex-col gap-2 px-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <SettingField id="newFilterKeyword" label="新增关键词规则">
                  <Input
                    id="newFilterKeyword"
                    value={newRuleKeyword}
                    onChange={(e) => setNewRuleKeyword(e.target.value)}
                    placeholder="输入关键词后添加"
                  />
                </SettingField>
              </div>
              <Button id="addFilterRule" type="button" variant="secondary" size="sm" onClick={onAddFilterRule}>
                添加规则
              </Button>
            </div>
            <div id="filterRulesList" className="flex flex-col gap-2">
              {form.filterRules.length === 0 ? (
                <p className="m-0 px-1 text-xs text-[var(--color-fg-muted)]">
                  暂无过滤规则。点击「添加规则」创建（完整编辑弹窗仍可在后续迭代）。
                </p>
              ) : (
                form.filterRules.map((rule: KeywordFilterRule, index: number) => (
                  <div
                    key={rule.id || index}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-2)] border border-[var(--color-border)] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{rule.name}</div>
                      <div className="text-xs text-[var(--color-fg-muted)]">
                        关键词：{rule.keyword || '—'} · 动作：{getFilterActionLabel(rule.action)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <SettingToggleRow
                        id={`filterRuleEnabled-${index}`}
                        label="启用"
                        checked={rule.enabled !== false}
                        onChange={(v) => onToggleRule(index, v)}
                        className="!py-1"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => onDeleteRule(index)}>
                        删除
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="点击增强" description="优化列表/详情卡片的点击打开行为">
        <SettingToggleRow
          id="enableClickEnhancement"
          label="启用点击增强"
          description="增强卡片点击：新标签打开、右键后台等"
          checked={form.enableClickEnhancement}
          onChange={(v) => setToggle('enableClickEnhancement', v)}
        />
        {form.enableClickEnhancement ? (
          <div id="clickEnhancementConfig" className="flex flex-col gap-1">
            <SettingToggleRow
              id="enableClickEnhancementList"
              label="列表页生效"
              checked={form.enableClickEnhancementList}
              onChange={(v) => setToggle('enableClickEnhancementList', v)}
            />
            <SettingToggleRow
              id="enableClickEnhancementDetail"
              label="详情相关列表生效"
              checked={form.enableClickEnhancementDetail}
              onChange={(v) => setToggle('enableClickEnhancementDetail', v)}
            />
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="视频预览" description="悬停列表封面播放预览">
        <SettingToggleRow
          id="enableVideoPreview"
          label="启用视频预览"
          description={`延迟：${form.previewDelay} ms`}
          checked={form.enableVideoPreview}
          onChange={(v) => setToggle('enableVideoPreview', v)}
        />
        {form.enableVideoPreview ? (
          <div id="listVideoPreviewConfig" className="flex flex-col gap-2">
            <SettingToggleRow
              id="enableVideoPreviewList"
              label="列表页预览"
              checked={form.enableVideoPreviewList}
              onChange={(v) => setToggle('enableVideoPreviewList', v)}
            />
            <SettingToggleRow
              id="enableVideoPreviewDetail"
              label="详情相关列表预览"
              checked={form.enableVideoPreviewDetail}
              onChange={(v) => setToggle('enableVideoPreviewDetail', v)}
            />
            <SettingField id="previewDelay" label="预览延迟时间 (ms)" description="悬停多久后开始加载预览">
              <Input
                id="previewDelay"
                type="number"
                min={100}
                max={5000}
                value={String(form.previewDelay)}
                onChange={(e) =>
                  patchForm({ previewDelay: parseIntNum(e.target.value, form.previewDelay) })
                }
              />
            </SettingField>
            <SettingField
              id="previewVolume"
              label={`预览音量（${Math.round(form.previewVolume * 100)}%）`}
            >
              <input
                id="previewVolume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={form.previewVolume}
                className="w-full accent-[var(--color-primary)]"
                onChange={(e) =>
                  patchForm({ previewVolume: parseNum(e.target.value, form.previewVolume) })
                }
              />
            </SettingField>
            <SettingField id="previewSourceGroup" label="预览源偏好">
              <SettingSelect
                id="preferredPreviewSource"
                value={form.preferredPreviewSource}
                options={PREVIEW_SOURCE_OPTIONS}
                onChange={(v) =>
                  patchForm({ preferredPreviewSource: v as EnhancementSettingsFormState['preferredPreviewSource'] })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="高清封面" description="始终启用（遗留 always-on）">
        <SettingToggleRow
          id="enableHighQualityCover"
          label="高清封面"
          description="列表封面使用高清资源"
          checked
          disabled
          onChange={() => undefined}
        />
      </SettingSection>

      <SettingSection title="演员水印" description="在列表封面叠加演员名水印">
        <SettingToggleRow
          id="enableActorWatermark"
          label="启用演员水印"
          checked={form.enableActorWatermark}
          onChange={(v) => setToggle('enableActorWatermark', v)}
        />
        {form.enableActorWatermark ? (
          <div id="actorWatermarkConfig" className="flex flex-col gap-2">
            <SettingField id="actorWatermarkPosition" label="水印位置">
              <SettingSelect
                id="actorWatermarkPosition"
                value={form.actorWatermarkPosition}
                options={WATERMARK_POSITION_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    actorWatermarkPosition: v as EnhancementSettingsFormState['actorWatermarkPosition'],
                  })
                }
              />
            </SettingField>
            <SettingField
              id="actorWatermarkOpacity"
              label={`不透明度（${Math.round(form.actorWatermarkOpacity * 100)}%）`}
            >
              <input
                id="actorWatermarkOpacity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={form.actorWatermarkOpacity}
                className="w-full accent-[var(--color-primary)]"
                onChange={(e) =>
                  patchForm({
                    actorWatermarkOpacity: parseNum(e.target.value, form.actorWatermarkOpacity),
                  })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="列表显示控制" description="列数与容器宽度（始终可用）">
        <SettingToggleRow
          id="enableListDisplayControl"
          label="列表显示控制"
          description="始终开启"
          checked
          disabled
          onChange={() => undefined}
        />
        <div id="listDisplayControlConfig" className="flex flex-col gap-2">
          <SettingField id="listColumnCount" label={`列数（${form.listColumnCount} 列）`}>
            <input
              id="listColumnCount"
              type="range"
              min={1}
              max={8}
              step={1}
              value={form.listColumnCount}
              className="w-full accent-[var(--color-primary)]"
              onChange={(e) =>
                patchForm({ listColumnCount: parseIntNum(e.target.value, form.listColumnCount) })
              }
            />
          </SettingField>
          <SettingField id="listContainerWidth" label={`容器宽度（${form.listContainerWidth}%）`}>
            <input
              id="listContainerWidth"
              type="range"
              min={50}
              max={150}
              step={5}
              value={form.listContainerWidth}
              className="w-full accent-[var(--color-primary)]"
              onChange={(e) =>
                patchForm({
                  listContainerWidth: parseIntNum(e.target.value, form.listContainerWidth),
                })
              }
            />
          </SettingField>
          <SettingToggleRow
            id="enableContainerExpansion"
            label="允许容器横向扩展"
            checked={form.enableContainerExpansion}
            onChange={(v) => setToggle('enableContainerExpansion', v)}
          />
        </div>
      </SettingSection>

      <SettingSection title="状态与快捷操作">
        <SettingToggleRow
          id="showStatusBadge"
          label="显示状态标签"
          description="在列表卡片显示已看/想看等状态"
          checked={form.showStatusBadge}
          onChange={(v) => setToggle('showStatusBadge', v)}
        />
        <SettingToggleRow
          id="enableStatusQuickAction"
          label="状态快捷操作"
          description="在列表上快速切换看过/想看"
          checked={form.enableStatusQuickAction}
          onChange={(v) => setToggle('enableStatusQuickAction', v)}
        />
        <SettingToggleRow
          id="enableListFavoriteQuickAction"
          label="收藏快捷操作"
          description="在列表上快速收藏/取消收藏"
          checked={form.enableListFavoriteQuickAction}
          onChange={(v) => setToggle('enableListFavoriteQuickAction', v)}
        />
      </SettingSection>
    </div>
  );
}

function VideoTab({
  form,
  setToggle,
  patchForm,
  aiModel,
}: TabProps & { aiModel: string }) {
  return (
    <div className="flex flex-col gap-4">
      <SettingSection title="演员名称标识">
        <SettingToggleRow
          id="veEnableActorNameMarks"
          label="演员名称标识"
          description="影片页演员名显示收藏/订阅/黑名单状态"
          checked={form.veEnableActorNameMarks}
          onChange={(v) => setToggle('veEnableActorNameMarks', v)}
        />
      </SettingSection>

      <SettingSection title="智能标题翻译" description="将日文标题译为中文">
        <SettingToggleRow
          id="enableTranslation"
          label="启用标题翻译"
          checked={form.enableTranslation}
          onChange={(v) => setToggle('enableTranslation', v)}
        />
        {form.enableTranslation ? (
          <div id="translationConfig" className="flex flex-col gap-2">
            <SettingField id="translationProvider" label="翻译服务类型">
              <SettingSelect
                id="translationProvider"
                value={form.translationProvider}
                options={TRANSLATION_PROVIDER_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    translationProvider: v as EnhancementSettingsFormState['translationProvider'],
                  })
                }
              />
            </SettingField>
            {form.translationProvider === 'ai' ? (
              <div id="aiTranslationConfig" className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs">
                <p className="m-0">
                  当前模型：
                  <strong id="aiCurrentModel" className="ml-1">
                    {aiModel || '未设置'}
                  </strong>
                </p>
                {!aiModel ? (
                  <p id="aiModelEmptyTip" className="mt-1 mb-0 text-[var(--color-danger)]">
                    未检测到当前模型，请前往 AI 设置配置
                  </p>
                ) : null}
                <Button
                  id="goAiSettingsBtn"
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => navigateToAISettings()}
                >
                  前往 AI 设置
                </Button>
              </div>
            ) : (
              <div id="traditionalTranslationConfig">
                <SettingField
                  id="traditionalApiKey"
                  label="API 密钥（可选）"
                  description="Google 翻译通常无需密钥"
                >
                  <Input
                    id="traditionalApiKey"
                    type="password"
                    value={form.traditionalApiKey}
                    onChange={(e) => patchForm({ traditionalApiKey: e.target.value })}
                    placeholder="输入 API 密钥"
                  />
                </SettingField>
              </div>
            )}
            <SettingToggleRow
              id="translateCurrentTitle"
              label="翻译影片页标题（current-title）"
              checked={form.translateCurrentTitle}
              onChange={(v) => setToggle('translateCurrentTitle', v)}
            />
            <SettingField id="translationDisplayMode" label="显示方式">
              <SettingSelect
                id="translationDisplayMode"
                value={form.translationDisplayMode}
                options={TRANSLATION_DISPLAY_MODE_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    translationDisplayMode: v as EnhancementSettingsFormState['translationDisplayMode'],
                  })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="状态标记增强" description="想看同步、115 推送后自动标记已看">
        <SettingToggleRow
          id="enableVideoEnhancement"
          label="启用状态标记增强"
          checked={form.enableVideoEnhancement}
          onChange={(v) => setToggle('enableVideoEnhancement', v)}
        />
        {form.enableVideoEnhancement ? (
          <div id="videoEnhancementConfig" className="flex flex-col gap-1">
            <SettingToggleRow
              id="veEnableWantSync"
              label="「想看」同步到本地番号库"
              checked={form.veEnableWantSync}
              onChange={(v) => setToggle('veEnableWantSync', v)}
            />
            <SettingToggleRow
              id="veAutoMarkWatchedAfter115"
              label="推送 115 后自动标记已看"
              checked={form.veAutoMarkWatchedAfter115}
              onChange={(v) => setToggle('veAutoMarkWatchedAfter115', v)}
            />
            {form.veAutoMarkWatchedAfter115 ? (
              <div id="autoMarkWatchedConfig">
                <SettingField id="veAutoMarkWatchedStars" label="自动标记星级">
                  <SettingSelect
                    id="veAutoMarkWatchedStars"
                    value={String(form.veAutoMarkWatchedStars)}
                    options={AUTO_MARK_STARS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) =>
                      patchForm({ veAutoMarkWatchedStars: parseIntNum(v, form.veAutoMarkWatchedStars) })
                    }
                  />
                </SettingField>
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="影片页收藏与评分">
        <SettingToggleRow
          id="enableVideoFavoriteRating"
          label="影片页收藏与评分"
          checked={form.enableVideoFavoriteRating}
          onChange={(v) => setToggle('enableVideoFavoriteRating', v)}
        />
      </SettingSection>

      <SettingSection title="外部入口面板" description="在线可用性、外搜、字幕搜索等入口">
        <SettingToggleRow
          id="veEnableExternalEntryPanel"
          label="启用外部入口面板"
          checked={form.veEnableExternalEntryPanel}
          onChange={(v) => setToggle('veEnableExternalEntryPanel', v)}
        />
        {form.veEnableExternalEntryPanel ? (
          <div id="externalEntryConfig" className="flex flex-col gap-2">
            <SettingToggleRow
              id="veEnableOnlineAvailability"
              label="在线可用性检测"
              checked={form.veEnableOnlineAvailability}
              onChange={(v) => setToggle('veEnableOnlineAvailability', v)}
            />
            {form.veEnableOnlineAvailability ? (
              <div id="onlineAvailabilityConfig" className="flex flex-col gap-2">
                <SettingToggleRow
                  id="veShowOnlineAvailabilityFailures"
                  label="显示检测失败站点"
                  checked={form.veShowOnlineAvailabilityFailures}
                  onChange={(v) => setToggle('veShowOnlineAvailabilityFailures', v)}
                />
                <div id="onlineAvailabilitySiteList" className="grid gap-1 sm:grid-cols-2">
                  {ONLINE_AVAILABILITY_SITE_OPTIONS.map((site) => (
                    <SettingToggleRow
                      key={site.key}
                      id={`online-availability-site-${site.key}`}
                      label={site.name}
                      checked={form.onlineAvailabilitySites[site.key] !== false}
                      onChange={(v) =>
                        patchForm({
                          onlineAvailabilitySites: toggleOnlineAvailabilitySite(
                            form.onlineAvailabilitySites,
                            site.key,
                            v,
                          ),
                        })
                      }
                      className="!py-1"
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <SettingToggleRow
              id="veEnableExternalSearch"
              label="外部搜索"
              checked={form.veEnableExternalSearch}
              onChange={(v) => setToggle('veEnableExternalSearch', v)}
            />
            <SettingToggleRow
              id="veEnableSubtitleSearch"
              label="字幕搜索"
              checked={form.veEnableSubtitleSearch}
              onChange={(v) => setToggle('veEnableSubtitleSearch', v)}
            />
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="相关列表与片源弹窗">
        <SettingToggleRow
          id="veEnableRelatedLists"
          label="相关列表增强"
          checked={form.veEnableRelatedLists}
          onChange={(v) => setToggle('veEnableRelatedLists', v)}
        />
        <SettingToggleRow
          id="veEnableLocalListInSourceModal"
          label="片源弹窗中显示本地列表"
          checked={form.veEnableLocalListInSourceModal}
          onChange={(v) => setToggle('veEnableLocalListInSourceModal', v)}
        />
        <SettingToggleRow
          id="enableActorQuickActions"
          label="演员标记增强"
          description="影片页演员旁快捷拉黑/订阅等"
          checked={form.enableActorQuickActions}
          onChange={(v) => setToggle('enableActorQuickActions', v)}
        />
      </SettingSection>

      <SettingSection title="演员备注">
        <SettingToggleRow
          id="veEnableActorRemarks"
          label="启用演员备注"
          checked={form.veEnableActorRemarks}
          onChange={(v) => setToggle('veEnableActorRemarks', v)}
        />
        {form.veEnableActorRemarks ? (
          <div id="actorRemarksConfig" className="flex flex-col gap-2">
            <SettingField id="veActorRemarksMode" label="展示模式">
              <SettingSelect
                id="veActorRemarksMode"
                value={form.veActorRemarksMode}
                options={ACTOR_REMARKS_MODE_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    veActorRemarksMode: v as EnhancementSettingsFormState['veActorRemarksMode'],
                  })
                }
              />
            </SettingField>
            <SettingField id="veActorRemarksTTL" label="缓存天数（0=不限）">
              <Input
                id="veActorRemarksTTL"
                type="number"
                min={0}
                max={30}
                value={String(form.veActorRemarksTTLDays)}
                onChange={(e) =>
                  patchForm({
                    veActorRemarksTTLDays: parseIntNum(e.target.value, form.veActorRemarksTTLDays),
                  })
                }
              />
            </SettingField>
            <SettingField id="veActorRemarksTaskTimeout" label="任务超时（秒）">
              <Input
                id="veActorRemarksTaskTimeout"
                type="number"
                min={10}
                max={1800}
                step={5}
                value={String(form.veActorRemarksTaskTimeoutSeconds)}
                onChange={(e) =>
                  patchForm({
                    veActorRemarksTaskTimeoutSeconds: parseIntNum(
                      e.target.value,
                      form.veActorRemarksTaskTimeoutSeconds,
                    ),
                  })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="评论区增强">
        <SettingToggleRow
          id="veEnableReviewEnhancement"
          label="启用评论区增强"
          checked={form.veEnableReviewEnhancement}
          onChange={(v) => setToggle('veEnableReviewEnhancement', v)}
        />
        {form.veEnableReviewEnhancement ? (
          <div id="reviewEnhancementConfig" className="flex flex-col gap-1">
            <SettingToggleRow
              id="veEnableReviewBreaker"
              label="评论区突破显示限制"
              checked={form.veEnableReviewBreaker}
              onChange={(v) => setToggle('veEnableReviewBreaker', v)}
            />
            <SettingToggleRow
              id="veEnableReviewMagnetLinkify"
              label="评论磁链可点击"
              checked={form.veEnableReviewMagnetLinkify}
              onChange={(v) => setToggle('veEnableReviewMagnetLinkify', v)}
            />
            <SettingToggleRow
              id="veEnableReviewPush115"
              label="评论磁链推送 115"
              checked={form.veEnableReviewPush115}
              onChange={(v) => setToggle('veEnableReviewPush115', v)}
            />
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="FC2 与锚点">
        <SettingToggleRow
          id="veEnableFC2Breaker"
          label="破解 FC2 拦截"
          description="整合 123av / fc2ppvdb 数据源"
          checked={form.veEnableFC2Breaker}
          onChange={(v) => setToggle('veEnableFC2Breaker', v)}
        />
        <SettingToggleRow
          id="enableAnchorOptimization"
          label="锚点优化"
          description="详情页右侧快捷跳转按钮"
          checked={form.enableAnchorOptimization}
          onChange={(v) => setToggle('enableAnchorOptimization', v)}
        />
        {form.enableAnchorOptimization ? (
          <div id="anchorOptimizationConfig" className="flex flex-col gap-2">
            <SettingField id="anchorButtonPosition" label="按钮位置">
              <SettingSelect
                id="anchorButtonPosition"
                value={form.anchorButtonPosition}
                options={ANCHOR_POSITION_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    anchorButtonPosition: v as EnhancementSettingsFormState['anchorButtonPosition'],
                  })
                }
              />
            </SettingField>
            <SettingToggleRow
              id="showPreviewButton"
              label="显示预览图按钮"
              checked={form.showPreviewButton}
              onChange={(v) => setToggle('showPreviewButton', v)}
            />
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="磁力资源搜索" description="多源并发搜索与排序">
        <SettingToggleRow
          id="enableMagnetSearch"
          label="启用磁力搜索"
          checked={form.enableMagnetSearch}
          onChange={(v) => setToggle('enableMagnetSearch', v)}
        />
        {form.enableMagnetSearch ? (
          <div id="magnetSourcesConfig" className="flex flex-col gap-2">
            <div className="grid gap-1 sm:grid-cols-2">
              <SettingToggleRow
                id="magnetSourceSukebei"
                label="Sukebei (SUK)"
                checked={form.magnetSourceSukebei}
                onChange={(v) => setToggle('magnetSourceSukebei', v)}
              />
              <SettingToggleRow
                id="magnetSourceBtdig"
                label="BTdig (BTD)"
                checked={form.magnetSourceBtdig}
                onChange={(v) => setToggle('magnetSourceBtdig', v)}
              />
              <SettingToggleRow
                id="magnetSourceBtsow"
                label="BTSOW (BTS)"
                checked={form.magnetSourceBtsow}
                onChange={(v) => setToggle('magnetSourceBtsow', v)}
              />
              <SettingToggleRow
                id="magnetSourceTorrentz2"
                label="Torrentz2 (TZ2)"
                checked={form.magnetSourceTorrentz2}
                onChange={(v) => setToggle('magnetSourceTorrentz2', v)}
              />
              <SettingToggleRow
                id="magnetSourceJavbus"
                label="JAVBUS (JVB)"
                checked={form.magnetSourceJavbus}
                onChange={(v) => setToggle('magnetSourceJavbus', v)}
              />
            </div>
            <SettingToggleRow
              id="magnetBlockMojContent"
              label="屏蔽磁力区域广告"
              checked={form.magnetBlockMojContent}
              onChange={(v) => setToggle('magnetBlockMojContent', v)}
            />
            <SettingToggleRow
              id="magnetAutoSearch"
              label="自动加载磁力资源"
              description="未看影片页自动搜索；已看仍需手动"
              checked={form.magnetAutoSearch}
              onChange={(v) => setToggle('magnetAutoSearch', v)}
            />
            <SettingField id="magnetSortMode" label="磁力结果排序">
              <SettingSelect
                id="magnetSortMode"
                value={form.magnetSortMode}
                options={MAGNET_SORT_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    magnetSortMode: v as EnhancementSettingsFormState['magnetSortMode'],
                  })
                }
              />
            </SettingField>
            <div className="grid gap-2 sm:grid-cols-2">
              <SettingField id="magnetPageMaxConcurrentRequests" label="页内并发请求">
                <Input
                  id="magnetPageMaxConcurrentRequests"
                  type="number"
                  min={1}
                  max={10}
                  value={String(form.magnetPageMaxConcurrentRequests)}
                  onChange={(e) =>
                    patchForm({
                      magnetPageMaxConcurrentRequests: parseIntNum(
                        e.target.value,
                        form.magnetPageMaxConcurrentRequests,
                      ),
                    })
                  }
                />
              </SettingField>
              <SettingField id="magnetBgGlobalMaxConcurrent" label="后台全局并发">
                <Input
                  id="magnetBgGlobalMaxConcurrent"
                  type="number"
                  min={1}
                  max={20}
                  value={String(form.magnetBgGlobalMaxConcurrent)}
                  onChange={(e) =>
                    patchForm({
                      magnetBgGlobalMaxConcurrent: parseIntNum(
                        e.target.value,
                        form.magnetBgGlobalMaxConcurrent,
                      ),
                    })
                  }
                />
              </SettingField>
              <SettingField id="magnetBgPerHostMaxConcurrent" label="每主机并发">
                <Input
                  id="magnetBgPerHostMaxConcurrent"
                  type="number"
                  min={1}
                  max={5}
                  value={String(form.magnetBgPerHostMaxConcurrent)}
                  onChange={(e) =>
                    patchForm({
                      magnetBgPerHostMaxConcurrent: parseIntNum(
                        e.target.value,
                        form.magnetBgPerHostMaxConcurrent,
                      ),
                    })
                  }
                />
              </SettingField>
              <SettingField id="magnetBgPerHostRateLimitPerMin" label="每主机每分钟限流">
                <Input
                  id="magnetBgPerHostRateLimitPerMin"
                  type="number"
                  min={1}
                  max={60}
                  value={String(form.magnetBgPerHostRateLimitPerMin)}
                  onChange={(e) =>
                    patchForm({
                      magnetBgPerHostRateLimitPerMin: parseIntNum(
                        e.target.value,
                        form.magnetBgPerHostRateLimitPerMin,
                      ),
                    })
                  }
                />
              </SettingField>
            </div>
          </div>
        ) : null}
      </SettingSection>
    </div>
  );
}

function ActorTab({ form, setToggle, patchForm }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <SettingSection title="演员操作按钮">
        <SettingToggleRow
          id="aeEnableActionButtons"
          label="演员操作按钮增强"
          description="拉黑、订阅、扫描新作品等快捷操作"
          checked={form.aeEnableActionButtons}
          onChange={(v) => setToggle('aeEnableActionButtons', v)}
        />
      </SettingSection>

      <SettingSection title="影片类别过滤" description="演员页标签过滤与跨页自动应用">
        <SettingToggleRow
          id="enableActorEnhancement"
          label="启用影片类别过滤"
          checked={form.enableActorEnhancement}
          onChange={(v) => setToggle('enableActorEnhancement', v)}
        />
        {form.enableActorEnhancement ? (
          <div id="actorEnhancementConfig" className="flex flex-col gap-2">
            <SettingToggleRow
              id="enableAutoApplyTags"
              label="自动应用过滤器"
              description="切换演员页时自动应用上次条件"
              checked={form.enableAutoApplyTags}
              onChange={(v) => setToggle('enableAutoApplyTags', v)}
            />
            <div id="actorDefaultTagsGroup" className="grid gap-1 sm:grid-cols-2">
              <p className="m-0 sm:col-span-2 text-xs font-semibold text-[var(--color-fg-muted)]">
                默认过滤条件
              </p>
              {ACTOR_DEFAULT_TAG_OPTIONS.map((tag) => (
                <SettingToggleRow
                  key={tag.value}
                  id={`actorDefaultTag-${tag.value}`}
                  label={tag.label}
                  checked={form.actorDefaultTags.includes(tag.value)}
                  onChange={(v) =>
                    patchForm({
                      actorDefaultTags: toggleActorDefaultTag(form.actorDefaultTags, tag.value, v),
                    })
                  }
                  className="!py-1"
                />
              ))}
            </div>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="影片分段显示">
        <SettingToggleRow
          id="aeEnableTimeSegmentationDivider"
          label="启用影片分段显示"
          description="按时间阈值在作品列表插入分隔线"
          checked={form.aeEnableTimeSegmentationDivider}
          onChange={(v) => setToggle('aeEnableTimeSegmentationDivider', v)}
        />
        {form.aeEnableTimeSegmentationDivider ? (
          <div id="actorTimeSegmentationConfig">
            <SettingField id="aeTimeSegmentationMonths" label="时间阈值（月）">
              <Input
                id="aeTimeSegmentationMonths"
                type="number"
                min={1}
                max={24}
                value={String(form.aeTimeSegmentationMonths)}
                onChange={(e) =>
                  patchForm({
                    aeTimeSegmentationMonths: parseIntNum(
                      e.target.value,
                      form.aeTimeSegmentationMonths,
                    ),
                  })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>
    </div>
  );
}

function OtherTab({ form, setToggle, patchForm }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <SettingSection title="列表排序与人气">
        <SettingToggleRow
          id="enableListSorting"
          label="启用列表排序控件"
          checked={form.enableListSorting}
          onChange={(v) => setToggle('enableListSorting', v)}
        />
        {form.enableListSorting ? (
          <div id="listSortingConfig" className="flex flex-col gap-2">
            <SettingField id="listSortingAppendStrategy" label="追加新结果时">
              <SettingSelect
                id="listSortingAppendStrategy"
                value={form.listSortingAppendStrategy}
                options={LIST_SORTING_APPEND_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    listSortingAppendStrategy:
                      v as EnhancementSettingsFormState['listSortingAppendStrategy'],
                  })
                }
              />
            </SettingField>
            <SettingField id="listSortingAutoResortPosition" label="自动重排后位置">
              <SettingSelect
                id="listSortingAutoResortPosition"
                value={form.listSortingAutoResortPosition}
                options={LIST_SORTING_POSITION_OPTIONS}
                onChange={(v) =>
                  patchForm({
                    listSortingAutoResortPosition:
                      v as EnhancementSettingsFormState['listSortingAutoResortPosition'],
                  })
                }
              />
            </SettingField>
          </div>
        ) : null}
        <SettingToggleRow
          id="enablePopularityEffects"
          label="人气高亮特效"
          description="对高评分/高评价数作品加强视觉强调"
          checked={form.enablePopularityEffects}
          onChange={(v) => setToggle('enablePopularityEffects', v)}
        />
        {form.enablePopularityEffects ? (
          <div id="popularityEffectsConfig" className="grid gap-2 sm:grid-cols-2">
            <SettingField id="popularityMinRating" label="最低评分">
              <Input
                id="popularityMinRating"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={String(form.popularityMinRating)}
                onChange={(e) =>
                  patchForm({
                    popularityMinRating: parseNum(e.target.value, form.popularityMinRating),
                  })
                }
              />
            </SettingField>
            <SettingField id="popularityMinRatingCount" label="最低评价数">
              <Input
                id="popularityMinRatingCount"
                type="number"
                min={0}
                max={9999}
                value={String(form.popularityMinRatingCount)}
                onChange={(e) =>
                  patchForm({
                    popularityMinRatingCount: parseIntNum(
                      e.target.value,
                      form.popularityMinRatingCount,
                    ),
                  })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="浏览与导航">
        <SettingToggleRow
          id="enableScrollPaging"
          label="启用滚动翻页"
          description="滚到底部自动加载下一页"
          checked={form.enableScrollPaging}
          onChange={(v) => setToggle('enableScrollPaging', v)}
        />
        <SettingToggleRow
          id="enableSuperRanking"
          label="超级排行榜"
          description="顶部排行榜改为免 VIP 增强页面"
          checked={form.enableSuperRanking}
          onChange={(v) => setToggle('enableSuperRanking', v)}
        />
        <SettingToggleRow
          id="veShowLoadingIndicator"
          label="显示加载指示器"
          description="增强任务执行时显示处理中状态"
          checked={form.veShowLoadingIndicator}
          onChange={(v) => setToggle('veShowLoadingIndicator', v)}
        />
      </SettingSection>

      <SettingSection title="密码显示助手" description="在密码框上按手势显示明文">
        <SettingToggleRow
          id="enablePasswordHelper"
          label="启用密码显示助手"
          checked={form.enablePasswordHelper}
          onChange={(v) => setToggle('enablePasswordHelper', v)}
        />
        {form.enablePasswordHelper ? (
          <div id="passwordHelperConfig" className="flex flex-col gap-2">
            <SettingField id="passwordShowMethod" label="显示密码方式">
              <SettingSelect
                id="passwordShowMethod"
                value={String(form.passwordShowMethod)}
                options={PASSWORD_SHOW_METHOD_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                onChange={(v) =>
                  patchForm({ passwordShowMethod: parseIntNum(v, form.passwordShowMethod) })
                }
              />
            </SettingField>
            <SettingField id="passwordWaitTime" label="等待时间 (毫秒)" description="仅悬浮模式有效">
              <Input
                id="passwordWaitTime"
                type="number"
                min={0}
                max={2000}
                step={50}
                value={String(form.passwordWaitTime)}
                onChange={(e) =>
                  patchForm({
                    passwordWaitTime: parseIntNum(e.target.value, form.passwordWaitTime),
                  })
                }
              />
            </SettingField>
          </div>
        ) : null}
      </SettingSection>
    </div>
  );
}
