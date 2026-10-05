/**
 * @file taskLabelCatalog.ts
 * @description 任务 label 展示名单一真相源（设计视图 / 明细 / 搜索 / 导出）
 * @module dashboard/tabs/settings/enhancement
 */

/** 短中文名（设计视图、搜索、描述） */
export const TASK_LABEL_SHORT: Record<string, string> = {
  'system:init': '系统全局初始化',
  'list:observe:init': '列表页观察器初始化',
  'list:reprocess:after-listEnhancement': '列表增强-二次处理',
  'list:preview:init': '列表页预览初始化',
  'list:optimization:init': '列表页优化初始化',
  'listEnhancement:init': '列表增强初始化',
  'listEnhancement:reprocess': '列表增强-二次处理',
  'actorEnhancement:init': '演员页增强初始化',
  'actorEnhancement:actionButtons': '演员页操作按钮增强',
  'actorQuickActions:init': '演员快捷操作初始化',
  'categoryQuickActions:init': '类别快捷操作初始化',
  'collectionQuickActions:init': '影片实体快捷收藏初始化',
  'enhancementUI:showLoadingIndicator': '增强加载提示显示',
  'performanceOptimizer:init': '性能优化器初始化',
  'ux:shortcuts:init': '快捷键系统初始化',
  'keyboardShortcuts:init': '快捷键系统初始化',
  'superRankingNav:init': '超级排行榜导航初始化',
  'ui:remove-unwanted': '移除官方按钮',
  'drive115:init:video': '115网盘功能初始化（影片页）',
  'drive115:init:list': '115网盘功能初始化（列表页）',
  'drive115:push': '115推送任务',
  'videoStatus:initialSync': '番号库状态同步与页面标记',
  'videoStatus:finalizeStatus': '番号库状态发布与图标更新',
  'videoStatus:fullRefresh': '番号库详情全量刷新',
  'videoStatus:update': '页面影片状态更新',
  'videoStatus:observer': '页面影片状态监听',
  // P1 已移除预注册；保留 legacy 映射避免历史明细空白
  'videoEnhancement:clickEnhancement': '详情页点击增强（legacy，已并入 initCore）',
  'videoEnhancement:initCore': '影片页核心初始化',
  'videoEnhancement:loadData': '视频增强-加载聚合数据',
  'videoEnhancement:translateCurrentTitle': '视频增强-标题定点翻译',
  'videoEnhancement:titleTranslateBtn': '视频增强-标题翻译按钮',
  'videoEnhancement:runCover': '影片页封面增强',
  'videoEnhancement:runTitle': '影片页标题处理',
  'videoEnhancement:runReviewBreaker': '评论区破解',
  'videoEnhancement:runRelatedLists': '相关清单解锁',
  'videoEnhancement:runFC2Breaker': 'FC2拦截破解',
  'videoEnhancement:finish': '影片页增强完成',
  'insights:collector': '观影标签采集器',
  'actorRemarks:actorPage': '演员页备注显示',
  'actorRemarks:run': '演员备注快速运行',
  'actorMarks:page': '演员标识-页面标记',
  'anchorOptimization:init': '锚点优化初始化',
  'ux:anchorOptimization:init': '锚点优化初始化',
  'contentFilter:init': '内容过滤初始化',
  'contentFilter:initialize': '内容过滤初始化',
  'ux:contentFilter': '内容过滤初始化',
  'emby:init': 'Emby/Jellyfin 增强初始化',
  'emby:badge': 'Emby/Jellyfin 徽标增强',
  'passwordHelper:init': '密码助手初始化',
  'defaultHide:init': '默认隐藏初始化',
  'magnetSearch:init': '磁力搜索初始化',
  'videoFavoriteRating:init': '影片收藏评分初始化',
  'onlineAvailability:check': '在线可看性检测',
  'ux:magnet:autoSearch': '磁力搜索自动检索',
};

/**
 * 短展示名；未知 label 返回空串（调用方可回退到 label 本身）。
 */
export function getTaskLabelShort(label: string): string {
  if (!label) return '';
  if (TASK_LABEL_SHORT[label]) return TASK_LABEL_SHORT[label];
  // 子步骤：videoEnhancement:translateCurrentTitle:request → 父级短名 + 后缀
  const parent = label.replace(/:[^:]+$/, '');
  if (parent !== label && TASK_LABEL_SHORT[parent]) {
    const suffix = label.slice(parent.length + 1);
    return `${TASK_LABEL_SHORT[parent]} · ${suffix}`;
  }
  return '';
}

/**
 * 导出/明细用：`中文 (label)`；未知则仅 label。
 */
export function getTaskLabelDisplay(label: string): string {
  const short = getTaskLabelShort(label);
  if (!short) return label || '';
  return `${short} (${label})`;
}

/**
 * 设计视图描述：与 getTaskLabelShort 同义，兼容旧 API 名。
 */
export function getTaskDescription(label: string): string {
  return getTaskLabelShort(label);
}
