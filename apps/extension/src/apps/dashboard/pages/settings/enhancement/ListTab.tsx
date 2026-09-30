/**
 * @file ListTab.tsx
 * @description 功能增强设置 - 列表页增强
 * @module apps/dashboard/pages/settings/enhancement
 */
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingTabs } from '../../../../../ui/patterns/SettingTabs/SettingTabs';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { Checkbox } from '../../../../../ui/primitives/Checkbox/Checkbox';
import type { KeywordFilterRule } from '../../../../../types';
import { BUILTIN_CATEGORY_DICTIONARY, entryKey } from '@javdb/video-category-dict';
import type { DimKey } from '@javdb/video-category-dict';
import { toggleCategoryBlackKey, type EnhancementSettingsFormState } from './enhancementSettingsModel';
import {
  SettingSection,
  parseIntNum,
  parseNum,
  removeFilterRuleAt,
  setFilterRuleEnabled,
  ONLINE_AVAILABILITY_SITE_OPTIONS,
  toggleOnlineAvailabilitySite,
  PREVIEW_SOURCE_OPTIONS,
  WATERMARK_POSITION_OPTIONS,
  getFilterActionLabel,
  TabProps,
} from './_shared';
import {
  ACTOR_LIST_FILTER_FIELDS,
  DISPLAY_FILTER_FIELDS,
} from './listFilterFields';
/**
 * 影片类别过滤维度分组（09-29 三态：候选/减去选择区共用此数据源）：内置类别字典（311 项快照）。
 * 模块级计算一次；维度顺序与 JavDB /tags 页一致（c1 主題 … c9 時長）。
 */
const CATEGORY_FILTER_DIMENSIONS: {
  key: DimKey;
  label: string;
  entries: { id: string; label: string }[];
}[] = (() => {
  const source = BUILTIN_CATEGORY_DICTIONARY.sources[BUILTIN_CATEGORY_DICTIONARY.activeSite];
  return source.dimensionOrder
    .map((key) => ({
      key,
      label: source.dimensions[key]?.label ?? key,
      entries: (source.dimensions[key]?.entries ?? []).map((e) => ({ id: e.id, label: e.label })),
    }))
    .filter((d) => d.entries.length > 0);
})();


export function ListTab({
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
      <SettingSection
        title="内容过滤"
        description="按关键词、状态与演员过滤/隐藏列表中的影片卡片"
      >
        <SettingToggleRow
          id="enableContentFilter"
          label="启用内容过滤"
          description="在列表页应用关键字过滤规则"
          checked={form.enableContentFilter}
          onChange={(v) => setToggle('enableContentFilter', v)}
        />
        {/* 09-29-cftabs：卡内 4-tab 分段（番号过滤 / 演员过滤 / 影片类别过滤 / 内容过滤规则）；
            7 既有开关存储键/默认/行为零变化，仅按 tab 归组；tab 活动态为 UI 瞬态（不持久化）；
            全部 pane 渲染进 DOM（非活动 hidden），设置搜索可达任一 pane 控件并落对应 tab */}
        <SettingTabs
          idPrefix="cf-"
          panes={[
            {
              id: 'numeric',
              label: '番号过滤',
              render: () => (
                <>
                  {/* 组行不随 enableContentFilter 门控，命名空间语义与现状一致 */}
                  <div className="content-filter-group__label">番号 / 状态</div>
                  {DISPLAY_FILTER_FIELDS.map((field) => (
                    <SettingToggleRow
                      key={field.id}
                      id={field.id}
                      label={field.label}
                      description={field.description}
                      checked={form[field.key] as boolean}
                      onChange={(checked) => setToggle(field.key, checked)}
                    />
                  ))}
                </>
              ),
            },
            {
              id: 'actor',
              label: '演员过滤',
              render: () => (
                <>
                  <div className="content-filter-group__label">演员（列表）</div>
                  {ACTOR_LIST_FILTER_FIELDS.map((field) => (
                    <SettingToggleRow
                      key={field.id}
                      id={field.id}
                      label={field.label}
                      description={field.description}
                      checked={form[field.key] as boolean}
                      onChange={(checked) => setToggle(field.key, checked)}
                    />
                  ))}
                </>
              ),
            },
            {
              id: 'category',
              label: '影片类别过滤',
              render: () => (
                <>
                  {/* 影片类别过滤（09-29-cftabs：三态下线 → 总开关 + 每类别独立勾选；
                      勾选=隐藏该类别影片，未勾=无操作；类别数据依赖演员穿透详情请求解析） */}
                  <SettingToggleRow
                    id="enableCategoryFilter"
                    label="启用影片类别过滤"
                    description="勾选 = 从列表隐藏该类别的影片；类别由「演员穿透」解析影片详情获得，未开启穿透时本过滤不生效"
                    checked={form.categoryFilterEnabled}
                    onChange={(v) => {
                      if (v && !form.enableActorPenetration && !form.categoryFilterEnabled) {
                        // 门控：关→开 且穿透关=挂起待确认（pending 仅 UI 瞬态，不持久化；categoryFilterEnabled 值本身持久化）
                        patchForm({ categoryFilterEnabledPending: true });
                      } else {
                        patchForm({ categoryFilterEnabledPending: null, categoryFilterEnabled: v });
                      }
                    }}
                  />
                  {form.categoryFilterEnabledPending ? (
                    <div
                      id="categoryFilterEnabledConfirm"
                      className="mt-1 flex flex-col gap-2 rounded-[var(--radius-2)] border border-[var(--color-warning)] bg-[var(--color-surface)] px-3 py-2"
                    >
                      <p className="m-0 text-[12.5px] leading-relaxed text-[var(--color-fg)]">
                        「影片类别过滤」依赖「演员穿透」：启用后列表卡片会发起详情页请求解析类别
                        （类别数据来自穿透详情请求，不另起请求），勾选了类别的卡片将被隐藏。此功能会增加性能开销与源站的请求量。
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          id="categoryFilterEnabledConfirmApply"
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            patchForm({
                              enableActorPenetration: true,
                              categoryFilterEnabled: true,
                              categoryFilterEnabledPending: null,
                            })
                          }
                        >
                          启用演员穿透并开启
                        </Button>
                        <Button
                          id="categoryFilterEnabledConfirmCancel"
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => patchForm({ categoryFilterEnabledPending: null })}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {form.categoryFilterEnabled && !form.enableActorPenetration ? (
                    <p className="input-description" role="note">
                      ⚠️ 演员穿透未启用，当前影片类别过滤（已选 {form.categoryFilterBlack.length} 项）未生效；
                      开启「演员穿透」后自动生效（已选类别保留）。
                    </p>
                  ) : null}
                  {form.categoryFilterEnabled && form.enableActorPenetration ? (
                    <div id="categoryFilterConfig" className="mt-1 flex flex-col gap-2 px-2">
                      <p className="input-description" role="note">
                        勾选 = 从列表隐藏该类别的影片；取消勾选即时恢复。
                        选项为站点内置类别清单（311 项），按「主題/角色/服裝」等分组，便于挑选。
                      </p>
                      <p className="input-description" role="note">
                        ⚠️ 类别随「演员穿透」的详情页请求解析（同一请求，不另起），此功能会增加性能开销与源站的请求量。
                        结果缓存 7 天，失败 10 分钟后重试；解析失败时卡片保持原状。
                      </p>
                      {CATEGORY_FILTER_DIMENSIONS.map((dim) => {
                        const dimKeys = dim.entries.map((e) => entryKey(dim.key, e.id));
                        const checkedCount = dimKeys.filter((k) => form.categoryFilterBlack.includes(k)).length;
                        const allChecked = checkedCount === dim.entries.length && dim.entries.length > 0;
                        return (
                          <details key={dim.key} id={`categoryDim-${dim.key}`} className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)]">
                            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">
                              {dim.label}
                              <span className="ml-2 font-normal text-[var(--color-fg-muted)]">
                                已选 {checkedCount}/{dim.entries.length}
                              </span>
                              <span className="ml-3 inline-flex gap-2 text-xs font-normal">
                                <button
                                  type="button"
                                  className="text-[var(--color-primary)] hover:underline"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    const next = new Set(form.categoryFilterBlack);
                                    for (const k of dimKeys) {
                                      if (allChecked) next.delete(k);
                                      else next.add(k);
                                    }
                                    patchForm({ categoryFilterBlack: Array.from(next) });
                                  }}
                                >
                                  {allChecked ? '清空' : '全选'}
                                </button>
                              </span>
                            </summary>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 border-t border-[var(--color-border)] px-3 py-2 sm:grid-cols-3">
                              {dim.entries.map((e) => {
                                const k = entryKey(dim.key, e.id);
                                return (
                                  <Checkbox
                                    key={k}
                                    checked={form.categoryFilterBlack.includes(k)}
                                    onChange={(checked) => {
                                      // 勾选=加入隐藏集合 / 取消=移出（语义见 toggleCategoryBlackKey 回归锁）
                                      patchForm({ categoryFilterBlack: toggleCategoryBlackKey(form.categoryFilterBlack, k, checked) });
                                    }}
                                    variant="card"
                                    compact
                                    label={e.label}
                                    title={e.label}
                                  />
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              id: 'rules',
              label: '内容过滤',
              render: () =>
                form.enableContentFilter ? (
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
                ) : (
                  <p className="input-description" role="note">
                    开启「启用内容过滤」后，在此配置关键字过滤规则。
                  </p>
                ),
            },
          ]}
        />
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

      <SettingSection title="演员穿透" description="在列表卡片显示女性演员名">
        <SettingToggleRow
          id="enableActorPenetration"
          label="启用演员穿透"
          description="在卡片标题下方常显前 3 位女性演员，更多可点击展开"
          checked={form.enableActorPenetration}
          onChange={(v) => setToggle('enableActorPenetration', v)}
        />
        {form.enableActorPenetration ? (
          <div className="flex flex-col gap-1.5">
            <p className="input-description" role="note">
              ✓ 开启后列表卡片将展示详情页解析出的真实演员，「内容过滤」卡的「演员（列表）」行
              （隐藏未收藏 / 黑名单 / 未识别演员）与「影片类别过滤」据此判断，过滤准确性显著提升。
            </p>
            <p className="input-description" role="note">
              ⚠️ 该功能会为可见卡片发起详情页网络请求，并解析 HTML、读写本地缓存，
              会增加列表处理的网络与 CPU 开销。结果缓存 7 天，失败 10 分钟后重试；
              解析失败时卡片保持原状。
            </p>
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

      <SettingSection title="快捷操作" description="列表卡片上的状态与收藏快捷入口">
        <SettingToggleRow
          id="showStatusBadge"
          label="启用状态标签显示"
          description="在列表卡片显示已看/想看等状态"
          checked={form.showStatusBadge}
          onChange={(v) => setToggle('showStatusBadge', v)}
        />
        <SettingToggleRow
          id="enableStatusQuickAction"
          label="启用状态快捷标识"
          description="在列表上快速切换看过/想看"
          checked={form.enableStatusQuickAction}
          onChange={(v) => setToggle('enableStatusQuickAction', v)}
        />
        <SettingToggleRow
          id="enableListFavoriteQuickAction"
          label="启用收藏快捷按钮"
          description="在列表上快速收藏/取消收藏"
          checked={form.enableListFavoriteQuickAction}
          onChange={(v) => setToggle('enableListFavoriteQuickAction', v)}
        />
      </SettingSection>

      <SettingSection title="资源标签" description="列表卡片上的资源证据标注">
        <SettingToggleRow
          id="resourceTags"
          label="启用资源标签"
          description="在列表卡片标注中字/破解等资源证据"
          checked={form.resourceTags}
          onChange={(v) => setToggle('resourceTags', v)}
        />
      </SettingSection>

    </div>
  );
}

