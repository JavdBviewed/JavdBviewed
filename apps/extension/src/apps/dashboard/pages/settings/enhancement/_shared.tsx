/**
 * @file _shared.tsx
 * @description 功能增强各子页签共享的 section 组件、特性元数据与工具函数
 * @module apps/dashboard/pages/settings/enhancement
 */
import { type ReactNode } from 'react';
import { EnhancementFeatureCard, type EnhancementFeatureMeta } from './EnhancementFeatureCard';
import type { EnhancementSettingsFormState } from './enhancementSettingsModel';

const ENHANCEMENT_FEATURE_META: Record<string, EnhancementFeatureMeta> = {
  '内容过滤': { icon: '🎯', status: '可用', tone: 'available', effect: '在列表页过滤关键字，可隐藏、高亮或标记匹配内容。', usage: '配置规则后自动应用到列表页。' },
  '点击增强': { icon: '🖱️', status: '可用', tone: 'available', effect: '统一卡片和标题的点击行为，减少不必要的页面跳转。', usage: '适用于列表页和影片页相关作品区域。' },
  '视频预览': { icon: '🎬', status: '可用', tone: 'available', effect: '悬停列表封面时播放预览片段。', usage: '需要所选预览源支持。' },
  '高清封面': { icon: '🖼️', status: '已弃用', tone: 'neutral', effect: 'JavDB 已默认使用高质量封面，保留该项仅为兼容旧设置。' },
  '演员水印': { icon: '🖍️', status: '可用', tone: 'available', effect: '在影片封面角落显示演员订阅或黑名单状态。' },
  '演员穿透': { icon: '🎭', status: '可用', tone: 'available', effect: '在列表卡片标题下方显示最多 3 位女性演员。', usage: '为可见卡片发起详情页请求并缓存 7 天，会增加网络与 CPU 开销。' },
  '列表显示控制': { icon: '📐', status: '可用', tone: 'available', effect: '调整列表列数和容器宽度以优化浏览体验。' },
  '快捷操作': { icon: '⚡', status: '可用', tone: 'available', effect: '在列表卡片上显示状态标签、状态快捷标识和收藏快捷按钮，可分别开关。' },
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

export function EnhancementFeatureSection({
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

export const SettingSection = EnhancementFeatureSection;

export type TabProps = {
  form: EnhancementSettingsFormState;
  setToggle: <K extends keyof EnhancementSettingsFormState>(
    key: K,
    value: EnhancementSettingsFormState[K],
  ) => void;
  patchForm: (patch: Partial<EnhancementSettingsFormState>) => void;
};

export function parseNum(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function parseIntNum(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export {
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
} from './enhancementSettingsModel';
