/**
 * @file EnhancementSettingsPage.tsx
 * @description 功能增强设置 React 全页（列表/影片/演员/其他）
 * @module apps/dashboard/pages/settings/enhancement
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { Tabs } from '../../../../../ui/primitives/Tabs/Tabs';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { KeywordFilterRule } from '../../../../../types';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { SettingsHighlightNotice } from '../shared/SettingsHighlightNotice';
import { useDebouncedSettingsSave } from '../shared/settingsPersist';
import './enhancementSettingsPage.css';
import {
  loadEnhancementSettingsForm,
  loadLastAppliedActorTags,
  openEnhancementOrchestrator,
  persistEnhancementForm,
  readAiSelectedModelLabel,
  clearLastAppliedActorTags,
  toast,
} from './enhancementSettingsActions';
import {
  DEFAULT_ENHANCEMENT_SETTINGS_FORM,
  ENHANCEMENT_SUBTABS,
  removeFilterRuleAt,
  setFilterRuleEnabled,
  setFilterRuleHideEnabled,
  type EnhancementSettingsFormState,
  type EnhancementSubtab,
} from './enhancementSettingsModel';
const AUTO_SAVE_MS = 1000;

import { ListTab } from './ListTab';
import { VideoTab } from './VideoTab';
import { ActorTab } from './ActorTab';
import { OtherTab } from './OtherTab';

const ENHANCEMENT_SUBTAB_IDS = ['list', 'video', 'actor', 'other'] as const;

/**
 * 从当前 hash 解析 enhancement 子页签（如 #tab-settings/enhancement-settings/list）。
 * 供跨页跳转精准定位子页签；无效或缺失时返回 null。
 */
function readSubtabFromHash(): EnhancementSubtab | null {
  try {
    const parts = window.location.hash.replace(/^#\/?tab-settings\//, '').split('/');
    if (parts[0] !== 'enhancement-settings') return null;
    const candidate = parts[1];
    if (candidate && (ENHANCEMENT_SUBTAB_IDS as readonly string[]).includes(candidate)) {
      return candidate as EnhancementSubtab;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function EnhancementSettingsPage() {
  const [form, setForm] = useState<EnhancementSettingsFormState>(DEFAULT_ENHANCEMENT_SETTINGS_FORM);
  const [subtab, setSubtab] = useState<EnhancementSubtab>(() => {
    // hash 携带的子页签优先于 localStorage 记忆（跨页跳转场景）
    const fromHash = readSubtabFromHash();
    if (fromHash) return fromHash;
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
  const formRef = useRef(form);
  formRef.current = form;
  const [aiModel, setAiModel] = useState('');
  const [lastAppliedActorTags, setLastAppliedActorTags] = useState<string[]>([]);
  const [filterRuleEditor, setFilterRuleEditor] = useState<FilterRuleEditorState | null>(null);

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
        formRef.current = next;
        setForm(next);
        const [model, lastTags] = await Promise.all([
          readAiSelectedModelLabel(),
          loadLastAppliedActorTags(),
        ]);
        if (!cancelled) setAiModel(model);
        if (!cancelled) setLastAppliedActorTags(lastTags);
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

  useEffect(() => {
    const activateSubtab = (event: Event) => {
      const detail = (event as CustomEvent<{ subtab?: string }>).detail;
      const next = detail?.subtab;
      if (next !== 'list' && next !== 'video' && next !== 'actor' && next !== 'other') return;
      setSubtab(next);
      try {
        localStorage.setItem('enhancementSubtab', next);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('jdb:enhancement:activate-subtab', activateSubtab);
    return () => window.removeEventListener('jdb:enhancement:activate-subtab', activateSubtab);
  }, []);

  const patchForm = useCallback(
    (patch: Partial<EnhancementSettingsFormState>) => {
      const next = { ...formRef.current, ...patch };
      formRef.current = next;
      setForm(next);
      scheduleSave(next);
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
    // 同步 hash 第三段，保证刷新/分享链接后仍落在该子页签
    try {
      const base = window.location.hash.replace(/^#\/?/,'').split('/');
      const tabPart = base[0] === 'tab-settings' ? '#tab-settings/enhancement-settings' : '#tab-settings';
      window.history.replaceState(null, '', `${tabPart}/${next}`);
    } catch {
      /* ignore */
    }
  };

  const onClearLastAppliedActorTags = useCallback(async () => {
    try {
      await clearLastAppliedActorTags();
      setLastAppliedActorTags([]);
      await toast('已清除上次应用的过滤条件', 'success');
    } catch (error) {
      await toast(error instanceof Error ? error.message : '清除记录失败', 'error');
    }
  }, []);

  const onOpenFilterRuleEditor = (index?: number) => {
    const source = typeof index === 'number' ? form.filterRules[index] : undefined;
    setFilterRuleEditor({
      index,
      draft: source
        ? { ...source, fields: [...source.fields], releaseDateRange: source.releaseDateRange ? { ...source.releaseDateRange } : undefined }
        : createFilterRuleDraft(),
    });
  };

  const onSaveFilterRule = (rule: KeywordFilterRule, index?: number) => {
    const nextRules = typeof index === 'number'
      ? form.filterRules.map((current, currentIndex) => currentIndex === index ? rule : current)
      : [...form.filterRules, rule];
    patchForm({ filterRules: nextRules, enableContentFilter: true });
    setFilterRuleEditor(null);
  };

  const onToggleRule = (index: number, enabled: boolean) => {
    patchForm({ filterRules: setFilterRuleEnabled(form.filterRules, index, enabled) });
  };

  const onToggleRuleHide = (index: number, hideEnabled: boolean) => {
    patchForm({ filterRules: setFilterRuleHideEnabled(form.filterRules, index, hideEnabled) });
  };

  const onDeleteRule = (index: number) => {
    patchForm({ filterRules: removeFilterRuleAt(form.filterRules, index) });
  };

  if (loading) {
    return (
      <SettingsPageFrame
        title="功能增强设置"
        description="加载中…"
        rootDataAttrs={{ 'data-enhancement-settings-react': '1' }}
        pageId="enhancement-settings"
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
      pageId="enhancement-settings"
      className="enhancement-settings-react"
    >
      <div id="enhancement-settings" className="flex flex-col gap-4" data-settings-page="enhancement">
        <div className="enhancement-notice" role="note">
          <i className="fas fa-info-circle" aria-hidden="true" />
          <span>
          列表、影片、演员页增强覆盖的站点和页面结构较多，部分能力可能受源站改版影响。遇到异常可以到{' '}
          <a
            href="https://github.com/JavdBviewed/JavdBviewed/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Issues
          </a>{' '}
          反馈现象、截图和日志。
          </span>
        </div>
        <SettingsHighlightNotice title="功能增强仍在测试中" badge="Beta" tone="warning">
          个别能力会随源站页面结构调整；开启前请阅读卡片内的效果说明和调用限制提示。
        </SettingsHighlightNotice>

        <div id="enhancementSubTabs" className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            items={ENHANCEMENT_SUBTABS}
            value={subtab}
            onChange={onSubtab}
            size="sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="relative inline-grid h-8 grid-cols-2 overflow-hidden rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5 text-xs font-medium"
              data-scheduling-mode-control
              role="radiogroup"
              aria-label="影片页增强调度方式"
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[calc(var(--radius-2)-2px)] bg-[var(--color-primary)] shadow-[var(--shadow-1)] transition-transform duration-200 ${form.videoEnhancementSchedulingMode === 'immediate' ? 'translate-x-full' : 'translate-x-0'}`}
              />
              <button
                id="videoEnhancementSchedulingModeSmart"
                type="button"
                role="radio"
                aria-checked={form.videoEnhancementSchedulingMode === 'smart'}
                className={`relative z-10 min-w-24 px-2.5 transition-colors ${form.videoEnhancementSchedulingMode === 'smart' ? 'text-[var(--color-primary-fg,#fff)]' : 'text-[var(--color-fg-muted)]'}`}
                onClick={() => patchForm({ videoEnhancementSchedulingMode: 'smart' })}
              >
                智能调度
              </button>
              <button
                id="videoEnhancementSchedulingModeImmediate"
                type="button"
                role="radio"
                aria-checked={form.videoEnhancementSchedulingMode === 'immediate'}
                className={`relative z-10 min-w-24 px-2.5 transition-colors ${form.videoEnhancementSchedulingMode === 'immediate' ? 'text-[var(--color-primary-fg,#fff)]' : 'text-[var(--color-fg-muted)]'}`}
                onClick={() => patchForm({ videoEnhancementSchedulingMode: 'immediate' })}
              >
                立即增强
              </button>
            </div>
            <Button
              id="showOrchestratorBtn"
              type="button"
              variant="secondary"
              size="sm"
              title="查看当前页面功能编排"
              onClick={() => {
                void openEnhancementOrchestrator().catch((error) => {
                  void toast(error instanceof Error ? error.message : '打开调度中心失败', 'error');
                });
              }}
            >
              <i className="fas fa-project-diagram" aria-hidden="true" />{' '}
              调度中心
            </Button>
          </div>
        </div>

        {saveError ? (
          <p className="m-0 rounded-[var(--radius-2)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {saveError}
          </p>
        ) : null}
        <div data-enhancement-subtab="list" hidden={subtab !== 'list'}>
          <ListTab form={form} setToggle={setToggle} patchForm={patchForm} onOpenFilterRuleEditor={onOpenFilterRuleEditor} onToggleRule={onToggleRule} onToggleRuleHide={onToggleRuleHide} onDeleteRule={onDeleteRule} />
        </div>
        <div data-enhancement-subtab="video" hidden={subtab !== 'video'}>
          <VideoTab form={form} setToggle={setToggle} patchForm={patchForm} aiModel={aiModel} />
        </div>
        <div data-enhancement-subtab="actor" hidden={subtab !== 'actor'}>
          <ActorTab
            form={form}
            setToggle={setToggle}
            patchForm={patchForm}
            lastAppliedActorTags={lastAppliedActorTags}
            onClearLastAppliedActorTags={onClearLastAppliedActorTags}
          />
        </div>
        <div data-enhancement-subtab="other" hidden={subtab !== 'other'}>
          <OtherTab form={form} setToggle={setToggle} patchForm={patchForm} />
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void flush(form).then(() => toast('已保存', 'success'));
            }}
          >
            <i className="fas fa-save" aria-hidden="true" />{' '}
            立即保存
          </Button>
        </div>
      </div>
      {filterRuleEditor ? (
        <FilterRuleEditor
          editor={filterRuleEditor}
          onCancel={() => setFilterRuleEditor(null)}
          onSave={onSaveFilterRule}
        />
      ) : null}
    </SettingsPageFrame>
  );
}

type FilterRuleEditorState = {
  index?: number;
  draft: KeywordFilterRule;
};

const FILTER_RULE_FIELDS: { value: KeywordFilterRule['fields'][number]; label: string }[] = [
  { value: 'title', label: '标题' },
  { value: 'actor', label: '演员' },
  { value: 'studio', label: '厂牌/片商' },
  { value: 'genre', label: '类型' },
  { value: 'tag', label: '标签' },
  { value: 'video-id', label: '番号' },
  { value: 'release-date', label: '发行日期' },
];

function createFilterRuleDraft(): KeywordFilterRule {
  return {
    id: String(Date.now()),
    name: '',
    keyword: '',
    isRegex: false,
    caseSensitive: false,
    action: 'hide',
    enabled: true,
    fields: ['title'],
  };
}

function FilterRuleEditor({
  editor,
  onCancel,
  onSave,
}: {
  editor: FilterRuleEditorState;
  onCancel: () => void;
  onSave: (rule: KeywordFilterRule, index?: number) => void;
}) {
  const [draft, setDraft] = useState(editor.draft);
  const hasReleaseDate = draft.fields.includes('release-date');
  const hasKeywordField = draft.fields.some((field) => field !== 'release-date');
  const comparison = draft.releaseDateRange?.comparison ?? 'between';

  const update = (patch: Partial<KeywordFilterRule>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const updateReleaseDate = (patch: NonNullable<KeywordFilterRule['releaseDateRange']>) => {
    update({ releaseDateRange: patch });
  };

  const save = () => {
    if (!draft.name.trim()) {
      void toast('请输入规则名称', 'warning');
      return;
    }
    if (draft.fields.length === 0) {
      void toast('请至少选择一个过滤字段', 'warning');
      return;
    }
    if (hasKeywordField && !draft.keyword.trim()) {
      void toast('请输入关键词', 'warning');
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), keyword: draft.keyword.trim() }, editor.index);
  };

  return (
    <div className="enhancement-filter-rule-modal" data-enhancement-filter-rule-modal="1" role="dialog" aria-modal="true" aria-labelledby="filterRuleModalTitle">
      <div className="enhancement-filter-rule-modal__dialog">
        <div className="enhancement-filter-rule-modal__header">
          <h3 id="filterRuleModalTitle">{typeof editor.index === 'number' ? '编辑过滤规则' : '添加过滤规则'}</h3>
          <div className="enhancement-filter-rule-modal__header-actions">
            <SettingToggleRow
              id="modalInlineRuleEnabled"
              label="启用"
              checked={draft.enabled}
              onChange={(enabled) => update({ enabled })}
              className="!p-0"
            />
            <button id="filterRuleModalClose" type="button" className="enhancement-filter-rule-modal__close" aria-label="关闭" onClick={onCancel}><i className="fas fa-times" aria-hidden="true" /></button>
          </div>
        </div>
        <div className="enhancement-filter-rule-modal__body">
          <section className="enhancement-filter-rule-modal__section">
            <label htmlFor="modalInlineRuleName">规则名称</label>
            <input id="modalInlineRuleName" value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="给规则起个名字，便于识别" autoFocus />
            <p>例如：隐藏含广告词条</p>
          </section>

          <section className="enhancement-filter-rule-modal__section enhancement-filter-rule-modal__grid">
            <div>
              <label htmlFor="modalInlineRuleAction">动作</label>
              <select id="modalInlineRuleAction" value={draft.action} onChange={(event) => update({ action: event.target.value as KeywordFilterRule['action'] })}>
                <option value="hide">隐藏</option>
                <option value="highlight">高亮</option>
                <option value="blur">模糊</option>
                <option value="mark">标记</option>
              </select>
              {draft.action === 'hide' ? (
                <label className="enhancement-filter-rule-modal__hide-enabled" title="关闭后该规则匹配时不再隐藏卡片">
                  <input id="modalInlineRuleHideEnabled" type="checkbox" checked={draft.hideEnabled !== false} onChange={(event) => update({ hideEnabled: event.target.checked })} />隐藏
                </label>
              ) : null}
            </div>
            <div>
              <label htmlFor="modalInlineRuleFields">作用字段</label>
              <select
                id="modalInlineRuleFields"
                multiple
                value={draft.fields}
                onChange={(event) => update({ fields: Array.from(event.currentTarget.selectedOptions, (option) => option.value as KeywordFilterRule['fields'][number]) })}
              >
                {FILTER_RULE_FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
              </select>
              <p>按住 Ctrl/Shift 可多选</p>
            </div>
            <div className="enhancement-filter-rule-modal__field-box">
              {hasKeywordField ? (
                <>
                  <label htmlFor="modalInlineRuleKeyword">关键词 / 正则</label>
                  <input id="modalInlineRuleKeyword" value={draft.keyword} onChange={(event) => update({ keyword: event.target.value })} placeholder="支持普通文本或正则表达式" />
                  <div className="enhancement-filter-rule-modal__checks">
                    <label><input id="modalInlineRuleIsRegex" type="checkbox" checked={draft.isRegex} onChange={(event) => update({ isRegex: event.target.checked })} />正则表达式</label>
                    <label><input id="modalInlineRuleCaseSensitive" type="checkbox" checked={draft.caseSensitive} onChange={(event) => update({ caseSensitive: event.target.checked })} />区分大小写</label>
                  </div>
                </>
              ) : null}
              {hasReleaseDate ? (
                <div className={hasKeywordField ? 'enhancement-filter-rule-modal__date-settings' : undefined}>
                  <label htmlFor="modalInlineRuleDateComparison">发行日期对比方式</label>
                  <select
                    id="modalInlineRuleDateComparison"
                    value={comparison}
                    onChange={(event) => updateReleaseDate({ ...(draft.releaseDateRange ?? { enabled: true }), enabled: true, comparison: event.target.value as NonNullable<KeywordFilterRule['releaseDateRange']>['comparison'] })}
                  >
                    <option value="between">在范围内</option><option value="before">早于</option><option value="after">晚于</option><option value="exact">精确匹配</option>
                  </select>
                  {comparison === 'between' ? (
                    <div className="enhancement-filter-rule-modal__date-inputs">
                      <label>开始日期<input id="modalInlineRuleStartDate" type="date" value={draft.releaseDateRange?.startDate ?? ''} onChange={(event) => updateReleaseDate({ ...(draft.releaseDateRange ?? { enabled: true }), enabled: true, comparison, startDate: event.target.value })} /></label>
                      <label>结束日期<input id="modalInlineRuleEndDate" type="date" value={draft.releaseDateRange?.endDate ?? ''} onChange={(event) => updateReleaseDate({ ...(draft.releaseDateRange ?? { enabled: true }), enabled: true, comparison, endDate: event.target.value })} /></label>
                    </div>
                  ) : (
                    <label>指定日期<input id="modalInlineRuleSingleDate" type="date" value={draft.releaseDateRange?.exactDate ?? ''} onChange={(event) => updateReleaseDate({ ...(draft.releaseDateRange ?? { enabled: true }), enabled: true, comparison, exactDate: event.target.value })} /></label>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="enhancement-filter-rule-modal__section">
            <label htmlFor="modalInlineRuleMessage">提示信息（可选）</label>
            <textarea id="modalInlineRuleMessage" rows={3} value={draft.message ?? ''} onChange={(event) => update({ message: event.target.value })} placeholder="为匹配项添加备注或提示文本" />
          </section>
        </div>
        <div className="enhancement-filter-rule-modal__footer">
          <Button id="cancelFilterRuleBtn" type="button" variant="secondary" onClick={onCancel}><i className="fas fa-times" aria-hidden="true" /> 取消</Button>
          <Button id="saveFilterRuleBtn" type="button" onClick={save}><i className="fas fa-save" aria-hidden="true" /> 保存</Button>
        </div>
      </div>
    </div>
  );
}

