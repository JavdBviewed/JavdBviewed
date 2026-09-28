/**
 * @file index.ts
 * @description 磁力搜索（多源并发搜索、结果合并、推送到115）统一导出
 * @module features/magnets
 */
export type {
  MagnetExternalSearchResult,
  MagnetResult,
  MagnetSearchConfig,
  MagnetSortMode,
  MagnetSourceKey,
  MagnetSourceRunState,
  MagnetSourceSearchState,
} from './domain/types';
export {
  appendMagnetResults,
  extractMagnetHash,
  getResultSources,
} from './application/resultMerge';
export {
  buildMagnetPaginationState,
  MAGNET_PAGINATION_PAGE_SIZE,
  MAGNET_PAGINATION_THRESHOLD,
  type MagnetPaginationState,
} from './application/pagination';
export {
  buildMagnetSourceTagView,
  countUniqueResultsBySource,
  getMagnetSourceLabel,
  type MagnetSourceTagView,
} from './application/sourceTagState';
export {
  MAGNET_SOURCE_BACKOFF_MS,
  clearMagnetSourceBackoff,
  describeMagnetSourceBackoff,
  getMagnetSourceBackoff,
  recordMagnetSourceFailure,
  recordMagnetSourceSuccess,
  shouldSkipMagnetSource,
  type MagnetSourceBackoffEntry,
  type MagnetSourceBackoffState,
} from './application/sourceBackoff';
export {
  deduplicateMagnetResults,
  detectMagnetQuality,
  detectMagnetSubtitle,
  extractHashFromMagnet,
  getVideoIdMatchCandidates,
  isCrackedVersion,
  isValidMagnetResultName,
  normalizeMagnetDate,
  parseRelativeMagnetDate,
  parseSizeToBytes,
  sortMagnetResults,
} from './application/resultMetadata';
export {
  calculateMagnetQualityScore,
  type MagnetQualityLevel,
  type MagnetQualityScore,
} from './application/qualityScore';
export {
  normalizeMagnetSortMode,
  sortMagnetResultsByMode,
} from './application/resultSort';
export {
  buildJavbusAjaxUrl,
  extractJavbusAjaxParams,
  getJavbusResponseDiagnostics,
  parseJavbusFallbackMagnets,
  parseJavbusMagnetRows,
  type JavbusAjaxParams,
  type JavbusResponseDiagnostics,
} from './adapters/javbus/source';
export {
  MagnetSearchManager,
  magnetSearchManager,
} from './ui/magnetSearchManager';
export {
  COMMENT_QUICK_SEARCH_MAX_LENGTH,
  COMMENT_QUICK_SEARCH_MIN_LENGTH,
  COMMENT_QUICK_SEARCH_SCOPE_SELECTOR,
  COMMENT_QUICK_SEARCH_SCOPE_SELECTORS,
  buildCommentQuickSearchUrl,
  computeCommentQuickSearchPosition,
  decideCommentQuickSearch,
  isCommentQuickSearchLengthAllowed,
  normalizeCommentQuickSearchQuery,
  type CommentQuickSearchDecision,
  type CommentQuickSearchRejectReason,
} from './application/commentQuickSearch';
export {
  MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID,
  MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID,
  MagnetCommentQuickSearchManager,
  magnetCommentQuickSearchManager,
} from './ui/magnetCommentQuickSearch';
