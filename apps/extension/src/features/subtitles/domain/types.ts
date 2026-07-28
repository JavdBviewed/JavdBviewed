/** @description 字幕搜索类型定义 */

/** 字幕搜索链接 */
export interface SubtitleSearchLink {
  name: string;                                       // 显示名称
  url: string;                                        // 搜索 URL 模板
}

/** 迅雷字幕 API 返回的单条字幕 */
export interface XunleiSubtitleItem {
  name: string;                                       // 字幕文件名
  ext?: string;                                       // 文件扩展名
  url?: string;                                       // 下载地址
  language?: string;                                  // 字幕语言
  rate?: number | string;                             // 评分
  duration?: number | string;                         // 时长
  sourceLabel?: string;                               // 来源标签
  hash?: string;                                      // 文件哈希
}

/** 迅雷字幕 API 响应 */
export interface XunleiSubtitleResponse {
  data?: unknown;
  subtitles?: unknown;
}
/** SubTitleCat 搜索结果条目 */
export interface SubtitleCatSearchItem {
  name: string;
  pageUrl: string;
  translatedFrom?: string;
  rating?: string;
  size?: string;
  downloads?: string;
  languageCount?: string;
}

/** SubTitleCat 详情页可直接下载的语言字幕 */
export interface SubtitleCatLanguageDownload {
  code: string;
  language: string;
  downloadUrl: string;
  ext: string;
}

