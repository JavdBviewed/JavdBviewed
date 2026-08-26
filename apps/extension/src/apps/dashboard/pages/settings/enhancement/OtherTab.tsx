/**
 * @file OtherTab.tsx
 * @description 功能增强设置 - 其他增强
 * @module apps/dashboard/pages/settings/enhancement
 */
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { EnhancementSettingsFormState } from './enhancementSettingsModel';
import {
  SettingSection,
  parseIntNum,
  parseNum,
  LIST_SORTING_APPEND_OPTIONS,
  LIST_SORTING_POSITION_OPTIONS,
  MAGNET_SORT_OPTIONS,
  PASSWORD_SHOW_METHOD_OPTIONS,
  TabProps,
} from './_shared';
export function OtherTab({ form, setToggle, patchForm }: TabProps) {
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
