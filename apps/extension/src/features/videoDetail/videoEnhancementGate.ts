/**
 * 详情页增强（videoEnhancement）统一开关解析器 —— 单一事实来源。
 *
 * 背景（09-06 F2 审计，见 .trellis/tasks/09-05-post-perf-full-regression-audit/research/p0-content.md）：
 * - 主开关 `videoEnhancement.enabled` 原默认 false 且只控制 3 处
 *   （runRelatedLists idle 预热 / localListInSourceModal / 遥测），
 *   详情页大部分执行路径（initCore / 封面 / 标题 / FC2 / 评论区 / 演员标记 /
 *   外部入口面板等）不读主开关，"主开关"名不副实；
 * - 子开关读语义混用 `=== true` 与 `!== false`；
 *   blueprint 声明、实际执行、遥测、设置页显示各写各的判定。
 *
 * 规范化约定：
 * 1. 主开关 = 「详情页 UI 增强」总闸：off → 不注入 UI、不装拦截器、不跑增强任务；
 *    数据行为（状态同步 / 想看同步 / 115 推送自动已看）不受主开关约束，
 *    由各路径直读自身字段（不进入本 resolver）。
 * 2. 主开关默认开（`enabled !== false`，config 默认值 true）——
 *    与历史实际体验一致（此前执行路径大多未受主开关约束，功能默认生效）。
 * 3. 子开关两分法：成熟功能 `onByDefault`（`!== false`），实验功能 `offByDefault`（`=== true`）；
 *    子开关一律要求主开关开启，外部入口面板的三个子开关另要求面板主开关开启。
 * 4. blueprint 声明、实际执行、遥测（featureCatalog）、设置页"已启用"显示
 *    必须经由本 resolver，禁止直接读取 videoEnhancement 字段判定开关。
 */

export type VideoEnhancementSubKey =
    | 'enableRelatedLists'
    | 'enableLocalListInSourceModal'
    | 'enableCoverImage'
    | 'enableFC2Breaker'
    | 'enableReviewBreaker'
    | 'enableVideoFavoriteRating'
    | 'enableActorNameMarks'
    | 'enableActorQuickActions'
    | 'enableCategoryQuickActions'
    | 'showLoadingIndicator'
    | 'enableExternalEntryPanel'
    | 'enableExternalSearch'
    | 'enableOnlineAvailability'
    | 'enableSubtitleSearch'
    | 'enableActorRemarks';

interface VideoEnhancementSubDef {
    /** 读语义：onByDefault = `!== false`（默认开）；offByDefault = `=== true`（默认关） */
    style: 'onByDefault' | 'offByDefault';
    /** 是否要求主开关开启（详情页 UI 增强子开关均为 true） */
    requiresMain: boolean;
    /** 嵌套面板：另需该子开关开启（外部入口面板三个子开关依赖面板主开关） */
    requiresPanel?: VideoEnhancementSubKey;
}

/** 子开关登记表（单一事实来源；新增子开关必须先在此登记） */
export const VIDEO_ENHANCEMENT_SUB_SWITCHES: Record<VideoEnhancementSubKey, VideoEnhancementSubDef> = {
    // —— 核心体验 ——
    enableRelatedLists: { style: 'onByDefault', requiresMain: true },
    enableLocalListInSourceModal: { style: 'onByDefault', requiresMain: true },
    enableCoverImage: { style: 'onByDefault', requiresMain: true },
    enableFC2Breaker: { style: 'onByDefault', requiresMain: true },
    enableReviewBreaker: { style: 'onByDefault', requiresMain: true },
    enableVideoFavoriteRating: { style: 'onByDefault', requiresMain: true },
    enableActorNameMarks: { style: 'onByDefault', requiresMain: true },
    enableActorQuickActions: { style: 'onByDefault', requiresMain: true },
    // 09-30-video-category-quick-actions：影片页「類別」栏快捷操作（不登记遥测 featureCatalog）
    enableCategoryQuickActions: { style: 'onByDefault', requiresMain: true },
    showLoadingIndicator: { style: 'onByDefault', requiresMain: true },
    // —— 外部入口面板（面板主 + 3 子） ——
    enableExternalEntryPanel: { style: 'onByDefault', requiresMain: true },
    enableExternalSearch: { style: 'onByDefault', requiresMain: true, requiresPanel: 'enableExternalEntryPanel' },
    enableOnlineAvailability: { style: 'onByDefault', requiresMain: true, requiresPanel: 'enableExternalEntryPanel' },
    enableSubtitleSearch: { style: 'onByDefault', requiresMain: true, requiresPanel: 'enableExternalEntryPanel' },
    // —— 实验功能（默认关） ——
    enableActorRemarks: { style: 'offByDefault', requiresMain: true },
};

export interface VideoEnhancementGateSettings {
    videoEnhancement?: Record<string, unknown> | null;
}

/** 主开关是否开启（默认开）。 */
export function isVideoEnhancementMainOn(settings: VideoEnhancementGateSettings | null | undefined): boolean {
    return settings?.videoEnhancement?.enabled !== false;
}

/** 子开关是否开启（主开关 + 面板主开关 + 子开关自身读语义）。 */
export function isVideoEnhancementSubOn(
    settings: VideoEnhancementGateSettings | null | undefined,
    key: VideoEnhancementSubKey,
): boolean {
    const def = VIDEO_ENHANCEMENT_SUB_SWITCHES[key];
    if (def.requiresMain && !isVideoEnhancementMainOn(settings)) return false;
    if (def.requiresPanel && !isVideoEnhancementSubOn(settings, def.requiresPanel)) return false;
    const raw = settings?.videoEnhancement?.[key];
    return def.style === 'onByDefault' ? raw !== false : raw === true;
}
