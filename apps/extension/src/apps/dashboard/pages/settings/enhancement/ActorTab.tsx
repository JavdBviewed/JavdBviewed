/**
 * @file ActorTab.tsx
 * @description 功能增强设置 - 演员页增强
 * @module apps/dashboard/pages/settings/enhancement
 */
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { EnhancementSettingsFormState } from './enhancementSettingsModel';
import { clearLastAppliedActorTags, toast } from './enhancementSettingsActions';
import {
  SettingSection,
  parseIntNum,
  parseNum,
  ACTOR_DEFAULT_TAG_OPTIONS,
  toggleActorDefaultTag,
  LIST_SORTING_POSITION_OPTIONS,
  TabProps,
} from './_shared';
export function ActorTab({
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

