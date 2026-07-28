/**
 * @file index.ts
 * @description 字幕搜索统一导出
 * @module features/subtitles
 */
export type { SubtitleCatLanguageDownload, SubtitleCatSearchItem, SubtitleSearchLink, XunleiSubtitleItem, XunleiSubtitleResponse } from './domain/types';
export {
  formatXunleiSubtitleDuration,
  normalizeXunleiSubtitleHash,
  normalizeXunleiSubtitleItems,
  normalizeXunleiSubtitleLanguage,
  normalizeXunleiSubtitleRate,
  normalizeXunleiSubtitleSource,
} from './domain/normalizeXunleiSubtitle';
export { fetchXunleiSubtitleResponse, fetchXunleiSubtitleText } from './adapters/xunleiSubtitleApi';
export { fetchSubtitleCatDocument, fetchSubtitleCatText } from './adapters/subtitleCatApi';
export { normalizeSubtitleCatLanguageDownloads, normalizeSubtitleCatSearchItems } from './domain/normalizeSubtitleCat';
export { injectXunleiSubtitleStyles, isXunleiSubtitleLink, openXunleiSubtitleModal } from './ui/xunleiSubtitleModal';
export { injectSubtitleCatStyles, isSubtitleCatLink, openSubtitleCatModal } from './ui/subtitleCatSubtitleModal';

