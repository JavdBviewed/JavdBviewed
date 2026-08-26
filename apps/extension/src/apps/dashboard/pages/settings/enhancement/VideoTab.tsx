/**
 * @file VideoTab.tsx
 * @description 功能增强设置 - 影片页增强
 * @module apps/dashboard/pages/settings/enhancement
 */
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { EnhancementSettingsFormState } from './enhancementSettingsModel';
import { navigateToAISettings } from './enhancementSettingsActions';
import {
  SettingSection,
  parseIntNum,
  parseNum,
  ANCHOR_POSITION_OPTIONS,
  AUTO_MARK_STARS_OPTIONS,
  MAGNET_SORT_OPTIONS,
  ONLINE_AVAILABILITY_SITE_OPTIONS,
  toggleOnlineAvailabilitySite,
  TRANSLATION_DISPLAY_MODE_OPTIONS,
  TRANSLATION_PROVIDER_OPTIONS,
  ACTOR_REMARKS_MODE_OPTIONS,
  TabProps,
} from './_shared';
export function VideoTab({
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

