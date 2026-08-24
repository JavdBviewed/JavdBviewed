/**
 * @file EnhancementSettingsPage.tsx
 * @description 功能增强设置 React 全页（列表/影片/演员/其他）
 * @module apps/dashboard/pages/settings/enhancement
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
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
import {
  EnhancementFeatureCard,
  type EnhancementFeatureMeta,
} from './EnhancementFeatureCard';
import './enhancementSettingsPage.css';
import {
  loadEnhancementSettingsForm,
  loadLastAppliedActorTags,
  navigateToAISettings,
  openEnhancementOrchestrator,
  persistEnhancementForm,
  readAiSelectedModelLabel,
  clearLastAppliedActorTags,
  toast,
} from './enhancementSettingsActions';
import {
  ACTOR_DEFAULT_TAG_OPTIONS,
  ACTOR_REMARKS_MODE_OPTIONS,
  ANCHOR_POSITION_OPTIONS,
  AUTO_MARK_STARS_OPTIONS,
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

const ENHANCEMENT_FEATURE_META: Record<string, EnhancementFeatureMeta> = {
  '内容过滤': { icon: '🎯', status: '可用', tone: 'available', effect: '在列表页过滤关键字，可隐藏、高亮或标记匹配内容。', usage: '配置规则后自动应用到列表页。' },
  '点击增强': { icon: '🖱️', status: '可用', tone: 'available', effect: '统一卡片和标题的点击行为，减少不必要的页面跳转。', usage: '适用于列表页和影片页相关作品区域。' },
  '视频预览': { icon: '🎬', status: '可用', tone: 'available', effect: '悬停列表封面时播放预览片段。', usage: '需要所选预览源支持。' },
  '高清封面': { icon: '🖼️', status: '已弃用', tone: 'neutral', effect: 'JavDB 已默认使用高质量封面，保留该项仅为兼容旧设置。' },
  '演员水印': { icon: '🖍️', status: '可用', tone: 'available', effect: '在影片封面角落显示演员订阅或黑名单状态。' },
  '列表显示控制': { icon: '📐', status: '可用', tone: 'available', effect: '调整列表列数和容器宽度以优化浏览体验。' },
  '状态标签显示': { icon: '🏷️', status: '可用', tone: 'available', effect: '在列表页卡片上显示已看、想看和已浏览状态，方便快速识别。' },
  '状态快捷标识': { icon: '⚡', status: '可用', tone: 'available', effect: '在列表卡片右下角显示状态快捷标识，可直接更新本地状态。' },
  '收藏快捷按钮': { icon: '⭐', status: '可用', tone: 'available', effect: '在列表卡片右上角显示收藏按钮，可直接添加或取消本地收藏。' },
  '本地媒体库匹配': {
    icon: '🗂️',
    status: '可选',
    tone: 'available',
    effect: '统一展示 115、Emby/Jellyfin 等本地媒体库来源的精确匹配结果，并保留来源名称。',
    usageHelp: [
      '先在 115 设置中配置媒体库根目录并完成一次索引。',
      '列表卡片只在本地索引精确匹配番号时显示“115 已有”。',
      '目录名或模糊文件名不作为存在依据；未命中不会显示“不存在”。',
      '当前版本不在列表页实时搜索 115，避免连续浏览触发调用限流。',
    ],
    riskNotice: '115 接口和目录结构可能导致匹配不完整；当前只读取本地索引，连续实时查询可能触发调用限流。',
  },
  '相关清单解锁': { icon: '🔓', status: '可用', tone: 'available', effect: '解锁影片页的相关清单并展示本地信息。' },
  '源站存入清单集成 Jav助手清单': { icon: '📋', status: '可用', tone: 'available', effect: '在源站片源弹窗中显示并操作 Jav助手本地清单。' },
  '演员名称标识': { icon: '🎭', status: '可用', tone: 'available', effect: '在影片页演员名称旁显示收藏、订阅和黑名单状态。' },
  '演员标记增强': { icon: '🎭', status: '可用', tone: 'available', effect: '在影片页为演员名称提供收藏、订阅和黑名单状态标识。' },
  '智能标题翻译': { icon: '🈳', status: '可用', tone: 'available', effect: '自动将日文标题翻译为中文。' },
  '状态标记增强': { icon: '✅', status: '可用', tone: 'available', effect: '同步想看状态，并在推送 115 后自动标记已看。' },
  '影片页收藏与评分': { icon: '⭐', status: '可用', tone: 'available', effect: '在影片页提供本地收藏与评分能力。' },
  '外部入口面板': { icon: '🔗', status: '可用', tone: 'available', effect: '统一管理影片详情页的在线可看、外部搜索和字幕搜索入口。', usage: '外部搜索和字幕搜索入口来源于搜索引擎设置中的分类。' },
  '相关列表与片源弹窗': { icon: '📚', status: '可用', tone: 'available', effect: '增强相关作品列表和片源弹窗的本地信息展示。' },
  '演员备注': { icon: '📝', status: '可用', tone: 'available', effect: '显示演员基础备注（年龄、身高、罩杯、引退）与 Wiki 外链。', usage: '数据源为 Wikipedia 和 xslist；开启后会增加页面增强阶段的请求与处理耗时。' },
  '评论区增强': { icon: '💬', status: '可用', tone: 'available', effect: '为评论区补充链接识别、破解和推送操作。', usage: '可分别开启评论突破、磁链点击和评论磁链推送 115。' },
  '破解FC2拦截': { icon: '🔓', status: '可用', tone: 'available', effect: '辅助打开被 FC2 拦截的影片信息。' },
  '锚点优化': { icon: '⚓', status: '可用', tone: 'available', effect: '在详情页提供稳定的预览和内容定位入口。', usage: '按钮顺序为：预览图、磁链下载、TOP。' },
  '磁力资源搜索': { icon: '🧲', status: '可用', tone: 'available', effect: '聚合多个磁力来源并支持排序和并发控制。', usage: '支持 Sukebei、BTdig、BTSOW、Torrentz2 和 JAVBUS；并发与限流参数会影响请求压力。' },
  '演员操作按钮': { icon: '👤', status: '可用', tone: 'available', effect: '为演员名称提供收藏、拉黑和订阅等快捷操作。' },
  '影片类别过滤': { icon: '🏷️', status: '可用', tone: 'available', effect: '按演员页标签过滤作品，并可自动复用条件。' },
  '影片分段显示': { icon: '🗓️', status: '可用', tone: 'available', effect: '按时间阈值在演员作品列表中插入分隔线。' },
  'JavDB 页面外观包': { icon: '🎨', status: '测试中', tone: 'beta', effect: '仅增强页面阅读层次，不改变原有业务交互。' },
  '排序增强': { icon: '↕️', status: '可用', tone: 'available', effect: '提供列表排序控制和追加结果时的排序策略。' },
  '影片热度特效': { icon: '📈', status: '可用', tone: 'available', effect: '按评分和评价数突出列表中的热门影片。' },
  '启用滚动翻页': { icon: '📜', status: '可用', tone: 'available', effect: '滚动到页面底部时自动加载下一页列表。', riskNotice: '连续加载会增加站点请求次数，遇到限速时请暂停或关闭。' },
  '超级排行榜': { icon: '🏆', status: '可用', tone: 'available', effect: '将 JavDB 排行榜入口替换为增强排行榜。' },
  '显示加载指示器': { icon: '⌛', status: '可用', tone: 'available', effect: '在增强任务执行期间显示加载和处理中状态。' },
  '密码显示助手': { icon: '🔐', status: '可用', tone: 'available', effect: '按设置的手势或悬停方式显示密码明文。' },
};

function EnhancementFeatureSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const meta = ENHANCEMENT_FEATURE_META[title] ?? {
    icon: '✨',
    status: '可用',
    tone: 'available' as const,
  };
  return <EnhancementFeatureCard title={title} description={description} meta={meta}>{children}</EnhancementFeatureCard>;
}

const SettingSection = EnhancementFeatureSection;

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

  const onDeleteRule = (index: number) => {
    patchForm({ filterRules: removeFilterRuleAt(form.filterRules, index) });
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
          <ListTab form={form} setToggle={setToggle} patchForm={patchForm} onOpenFilterRuleEditor={onOpenFilterRuleEditor} onToggleRule={onToggleRule} onDeleteRule={onDeleteRule} />
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
  onOpenFilterRuleEditor,
  onToggleRule,
  onDeleteRule,
}: TabProps & {
  onOpenFilterRuleEditor: (index?: number) => void;
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
            <div className="filter-rules-header">
              <span>过滤规则列表</span>
              <Button id="addFilterRule" type="button" variant="secondary" size="sm" onClick={() => onOpenFilterRuleEditor()}>
                <i className="fas fa-plus" aria-hidden="true" /> 添加规则
              </Button>
            </div>
            <div id="filterRulesList" className="flex flex-col gap-2">
              {form.filterRules.length === 0 ? (
                <p className="m-0 px-1 text-xs text-[var(--color-fg-muted)]">
                  暂无过滤规则，点击「添加规则」开始配置。
                </p>
              ) : (
                form.filterRules.map((rule: KeywordFilterRule, index: number) => (
                  <div
                    key={rule.id || index}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-2)] hover:shadow-[var(--shadow-1)]"
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
                      <Button type="button" variant="ghost" size="sm" onClick={() => onOpenFilterRuleEditor(index)}>
                        <i className="fas fa-edit" aria-hidden="true" /> 编辑
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => onDeleteRule(index)}>
                        <i className="fas fa-trash" aria-hidden="true" /> 删除
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
            <div className="form-group volume-control-group">
              <div className="volume-header">
                <label htmlFor="previewVolume">🔊 预览音量</label>
                <span className="volume-percentage">{Math.round(form.previewVolume * 100)}%</span>
              </div>
              <div className="volume-slider-wrapper">
                <input
                  id="previewVolume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={form.previewVolume}
                  className="modern-range"
                  onChange={(e) =>
                    patchForm({ previewVolume: parseNum(e.target.value, form.previewVolume) })
                  }
                />
                <div
                  className="range-track-fill"
                  style={{ width: `${Math.round(form.previewVolume * 100)}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="input-description">预览视频的音量大小，建议保持较低音量。</p>
            </div>
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
            <div className="form-group volume-control-group">
              <div className="volume-header">
                <label htmlFor="actorWatermarkOpacity">透明度</label>
                <span className="volume-percentage">{Math.round(form.actorWatermarkOpacity * 100)}%</span>
              </div>
              <div className="volume-slider-wrapper">
                <input
                  id="actorWatermarkOpacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.actorWatermarkOpacity}
                  className="modern-range"
                  onChange={(e) =>
                    patchForm({
                      actorWatermarkOpacity: parseNum(e.target.value, form.actorWatermarkOpacity),
                    })
                  }
                />
                <div
                  className="range-track-fill"
                  style={{ width: `${Math.round(form.actorWatermarkOpacity * 100)}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="input-description">自定义水印透明度，以减少视觉干扰。</p>
            </div>
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
          <SettingField
            id="listColumnCount"
            label={`列数（${form.listColumnCount} 列）`}
            description="设置列表页每行显示的影片数量（1-8列）。"
          >
            <input
              id="listColumnCount"
              type="range"
              min={1}
              max={8}
              step={1}
              value={form.listColumnCount}
              className="modern-range"
              onChange={(e) =>
                patchForm({ listColumnCount: parseIntNum(e.target.value, form.listColumnCount) })
              }
            />
          </SettingField>
          <SettingField
            id="listContainerWidth"
            label={`容器宽度（${form.listContainerWidth}%）`}
            description="设置列表容器的宽度百分比（50%-150%），超过100%时会居中显示。"
          >
            <input
              id="listContainerWidth"
              type="range"
              min={50}
              max={150}
              step={5}
              value={form.listContainerWidth}
              className="modern-range"
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

      <SettingSection title="状态标签显示">
        <SettingToggleRow
          id="showStatusBadge"
          label="启用状态标签显示"
          description="在列表卡片显示已看/想看等状态"
          checked={form.showStatusBadge}
          onChange={(v) => setToggle('showStatusBadge', v)}
        />
      </SettingSection>

      <SettingSection title="状态快捷标识">
        <SettingToggleRow
          id="enableStatusQuickAction"
          label="启用状态快捷标识"
          description="在列表上快速切换看过/想看"
          checked={form.enableStatusQuickAction}
          onChange={(v) => setToggle('enableStatusQuickAction', v)}
        />
      </SettingSection>

      <SettingSection title="收藏快捷按钮">
        <SettingToggleRow
          id="enableListFavoriteQuickAction"
          label="启用收藏快捷按钮"
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
            <p className="enhancement-current-service">
              当前使用：
              <strong id="currentTranslationService">
                {form.translationProvider === 'ai' ? 'AI 翻译' : 'Google 翻译'}
              </strong>
            </p>
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
                  <i className="fas fa-robot" aria-hidden="true" /> 前往 AI 设置
                </Button>
              </div>
            ) : null}
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
              description="检测 FANZA、Jable、MISSAV、Supjav、JavBus、123AV、NETFLAV 等站点是否有在线资源。"
              checked={form.veEnableOnlineAvailability}
              onChange={(v) => setToggle('veEnableOnlineAvailability', v)}
            />
            {form.veEnableOnlineAvailability ? (
              <div id="onlineAvailabilityConfig" className="flex flex-col gap-2">
                <SettingToggleRow
                  id="veShowOnlineAvailabilityFailures"
                  label="显示检测失败站点"
                  description="检测失败或未命中的站点会以红色标签显示；默认只显示命中的可看站点。"
                  checked={form.veShowOnlineAvailabilityFailures}
                  onChange={(v) => setToggle('veShowOnlineAvailabilityFailures', v)}
                />
                <div id="onlineAvailabilitySiteList" className="grid gap-1 sm:grid-cols-2">
                  {ONLINE_AVAILABILITY_SITE_OPTIONS.map((site) => (
                    <div
                      key={site.key}
                      data-settings-search-target={`online-availability-site:${site.key}`}
                    >
                      <SettingToggleRow
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
                    </div>
                  ))}
                </div>
                <p className="m-0 text-xs text-[var(--color-fg-muted)]">站点列表：选择在线可看检测使用的站点。</p>
              </div>
            ) : null}
            <SettingToggleRow
              id="veEnableExternalSearch"
              label="外部搜索"
              description="在影片详情页显示搜索引擎设置中分类为资源/搜索的入口。"
              checked={form.veEnableExternalSearch}
              onChange={(v) => setToggle('veEnableExternalSearch', v)}
            />
            <SettingToggleRow
              id="veEnableSubtitleSearch"
              label="字幕搜索"
              description="在影片详情页显示 SubTitleCat、迅雷字幕等字幕入口。"
              checked={form.veEnableSubtitleSearch}
              onChange={(v) => setToggle('veEnableSubtitleSearch', v)}
            />
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="相关清单解锁">
        <SettingToggleRow
          id="veEnableRelatedLists"
          label="启用相关清单解锁"
          checked={form.veEnableRelatedLists}
          onChange={(v) => setToggle('veEnableRelatedLists', v)}
        />
      </SettingSection>

      <SettingSection title="源站存入清单集成 Jav助手清单">
        <SettingToggleRow
          id="veEnableLocalListInSourceModal"
          label="在片源弹窗中显示本地清单"
          checked={form.veEnableLocalListInSourceModal}
          onChange={(v) => setToggle('veEnableLocalListInSourceModal', v)}
        />
      </SettingSection>

      <SettingSection title="演员标记增强">
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
              description="使用 JAV-JHS API 解锁影片评论区，显示完整评论内容并支持分页浏览。"
              checked={form.veEnableReviewBreaker}
              onChange={(v) => setToggle('veEnableReviewBreaker', v)}
            />
            <SettingToggleRow
              id="veEnableReviewMagnetLinkify"
              label="评论磁链可点击"
              description="自动把评论中的番号转成搜索链接，把纯文本磁链转成可点击磁链。"
              checked={form.veEnableReviewMagnetLinkify}
              onChange={(v) => setToggle('veEnableReviewMagnetLinkify', v)}
            />
            <SettingToggleRow
              id="veEnableReviewPush115"
              label="评论磁链推送 115"
              description="在评论区磁链后显示推送 115 按钮，支持翻页后重新注入。"
              checked={form.veEnableReviewPush115}
              onChange={(v) => setToggle('veEnableReviewPush115', v)}
            />
          </div>
        ) : null}
      </SettingSection>

      <SettingSection title="破解FC2拦截">
        <SettingToggleRow
          id="veEnableFC2Breaker"
          label="破解 FC2 拦截"
          description="整合 123av / fc2ppvdb 数据源"
          checked={form.veEnableFC2Breaker}
          onChange={(v) => setToggle('veEnableFC2Breaker', v)}
        />
      </SettingSection>

      <SettingSection title="锚点优化">
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
              description="在快捷按钮中显示“预览图”按钮，点击可快速跳转到预览图区域。"
              checked={form.showPreviewButton}
              onChange={(v) => setToggle('showPreviewButton', v)}
            />
            <div className="info-box">
              <p><strong>按钮顺序（从上到下）：</strong></p>
              <ol>
                <li>🖼️ 预览图：跳转到预览图区域</li>
                <li>🧲 磁链下载：跳转到磁链下载区域</li>
                <li>⬆️ TOP：返回页面顶部</li>
              </ol>
            </div>
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
            <div className="info-box">
              <p><strong>搜索源说明：</strong></p>
              <ul>
                <li><strong>Sukebei</strong>：专业的成人内容磁力搜索引擎</li>
                <li><strong>BTdig</strong>：通用磁力搜索引擎</li>
                <li><strong>BTSOW</strong>：高质量磁力资源搜索</li>
                <li><strong>Torrentz2</strong>：综合磁力搜索聚合器</li>
              </ul>
            </div>
            <div id="magnetConcurrencyConfig" className="magnet-concurrency-config">
              <div className="sub-settings-header">
                <h5>⚙️ 并发与限流</h5>
                <p className="sub-description">控制磁力搜索的并发与后台限流策略，避免同时打开多个页面时产生突发流量。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
              <SettingField id="magnetPageMaxConcurrentRequests" label="页面内并发">
                <Input
                  id="magnetPageMaxConcurrentRequests"
                  type="number"
                  min={1}
                  max={8}
                  data-settings-search-target="magnet-concurrency:magnetPageMaxConcurrentRequests"
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
                  max={16}
                  data-settings-search-target="magnet-concurrency:magnetBgGlobalMaxConcurrent"
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
                  max={4}
                  data-settings-search-target="magnet-concurrency:magnetBgPerHostMaxConcurrent"
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
                  max={120}
                  data-settings-search-target="magnet-concurrency:magnetBgPerHostRateLimitPerMin"
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
          </div>
        ) : null}
      </SettingSection>
    </div>
  );
}

function ActorTab({
  form,
  setToggle,
  patchForm,
  lastAppliedActorTags,
  onClearLastAppliedActorTags,
}: TabProps & {
  lastAppliedActorTags: string[];
  onClearLastAppliedActorTags: () => void;
}) {
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
            <div id="lastAppliedTagsDisplay" className="enhancement-last-applied-tags">
              <div className="enhancement-last-applied-tags__header">
                <span>上次应用的过滤条件</span>
                <Button
                  id="clearLastAppliedTags"
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="清除记录"
                  onClick={onClearLastAppliedActorTags}
                  disabled={lastAppliedActorTags.length === 0}
                >
                  <i className="fas fa-eraser" aria-hidden="true" /> 清除
                </Button>
              </div>
              <div id="appliedTagsContainer" className="enhancement-applied-tags-container">
                {lastAppliedActorTags.length === 0 ? (
                  <span className="enhancement-no-tags-message">暂无记录</span>
                ) : (
                  lastAppliedActorTags.map((tag) => (
                    <span key={tag} className="enhancement-applied-tag">
                      {ACTOR_DEFAULT_TAG_OPTIONS.find((option) => option.value === tag)?.label ?? tag}
                    </span>
                  ))
                )}
              </div>
            </div>
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
            <div className="info-box">
              <p><strong>功能说明：</strong></p>
              <ul>
                <li>🔄 <strong>自动同步：</strong>选择类别/标签后自动保存，切换演员时智能应用。</li>
                <li>🧠 <strong>智能兼容：</strong>只应用当前演员页支持的过滤条件，避免无效过滤。</li>
                <li>📝 <strong>默认回退：</strong>无保存记录或兼容性检查失败时使用默认过滤条件。</li>
                <li>💾 <strong>存储限制：</strong>最多保存 10 个演员的过滤器记录，自动清理旧记录。</li>
              </ul>
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
      <SettingSection title="本地媒体库匹配">
        <SettingToggleRow
          id="enableLibraryMatchStatus"
          label="启用本地媒体库匹配"
          description="只读取本地索引，不为列表卡片新增详情、115 或外部搜索请求"
          checked={form.enableLibraryMatchStatus}
          onChange={(v) => setToggle('enableLibraryMatchStatus', v)}
        />
      </SettingSection>

      <SettingSection
        title="JavDB 页面外观包"
        description="仅调整页面阅读层次，不改变列表列数、卡片尺寸或现有交互。"
      >
        <SettingToggleRow
          id="enableSiteAppearance"
          label="启用页面外观包"
          description="默认关闭；启用后可按页面区域单独关闭样式。"
          checked={form.enableSiteAppearance}
          onChange={(v) => setToggle('enableSiteAppearance', v)}
        />
        {form.enableSiteAppearance ? (
          <div id="siteAppearanceSections" className="grid gap-1 sm:grid-cols-2">
            <SettingToggleRow
              id="siteAppearanceListCards"
              label="列表卡片"
              checked={form.siteAppearanceListCards}
              onChange={(v) => setToggle('siteAppearanceListCards', v)}
            />
            <SettingToggleRow
              id="siteAppearanceDetailAndRelated"
              label="详情与相关作品"
              checked={form.siteAppearanceDetailAndRelated}
              onChange={(v) => setToggle('siteAppearanceDetailAndRelated', v)}
            />
            <SettingToggleRow
              id="siteAppearanceMagnetList"
              label="磁力列表"
              checked={form.siteAppearanceMagnetList}
              onChange={(v) => setToggle('siteAppearanceMagnetList', v)}
            />
            <SettingToggleRow
              id="siteAppearancePreviewImages"
              label="预览图"
              checked={form.siteAppearancePreviewImages}
              onChange={(v) => setToggle('siteAppearancePreviewImages', v)}
            />
          </div>
        ) : null}
        <SettingToggleRow
          id="siteAppearanceAutoExpandReplaceTip"
          label="自动展开替换提示"
          description="独立生效；仅处理页面新增的替换提示，不改写正文。"
          checked={form.siteAppearanceAutoExpandReplaceTip}
          onChange={(v) => setToggle('siteAppearanceAutoExpandReplaceTip', v)}
        />
      </SettingSection>

      <SettingSection title="排序增强">
        <SettingToggleRow
          id="enableListSorting"
          label="启用列表排序控件"
          checked={form.enableListSorting}
          onChange={(v) => setToggle('enableListSorting', v)}
        />
        {form.enableListSorting ? (
          <div id="listSortingConfig" className="flex flex-col gap-2">
            <p className="list-sorting-warning">
              <i className="fas fa-info-circle" aria-hidden="true" />
              这项能力只包含当前页面已显示的影片，不会抓取全部分页。
            </p>
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
      </SettingSection>

      <SettingSection title="影片热度特效">
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

      <SettingSection title="启用滚动翻页">
        <SettingToggleRow
          id="enableScrollPaging"
          label="启用滚动翻页"
          description="滚到底部自动加载下一页"
          checked={form.enableScrollPaging}
          onChange={(v) => setToggle('enableScrollPaging', v)}
        />
      </SettingSection>

      <SettingSection title="超级排行榜">
        <SettingToggleRow
          id="enableSuperRanking"
          label="超级排行榜"
          description="顶部排行榜改为免 VIP 增强页面"
          checked={form.enableSuperRanking}
          onChange={(v) => setToggle('enableSuperRanking', v)}
        />
      </SettingSection>

      <SettingSection title="显示加载指示器">
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
