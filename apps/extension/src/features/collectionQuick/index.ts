/**
 * @file index.ts
 * @description features/collectionQuick 统一导出（影片页实体快捷收藏，10-05-collection-makers-directors）
 * @module features/collectionQuick
 */
export { parseEntityLink, buildCollectUrl, extractCSRFToken } from './entityCollect';
export type { CollectibleEntity, ParsedEntityLink } from './entityCollect';
export {
    COLLECTION_QUICK_ACTIONS_BOUND_ATTR,
    COLLECTION_QUICK_ACTIONS_TOOLTIP_SELECTOR,
    collectionQuickActionsManager,
} from './collectionQuickActionsManager';
