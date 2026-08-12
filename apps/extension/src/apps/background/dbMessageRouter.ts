/**
 * @file dbMessageRouter.ts
 * @description dbMessageRouter
 * @module apps/background
 */
// src/apps/background/dbMessageRouter.ts
// 抽离 DB 相关消息路由

import { initDB, viewedPut as idbViewedPut, viewedBulkPut as idbViewedBulkPut, viewedGet as idbViewedGet, viewedStatusGetMany as idbViewedStatusGetMany, viewedCount as idbViewedCount, viewedPage as idbViewedPage, viewedCountByStatus as idbViewedCountByStatus, viewedGetAll as idbViewedGetAll, viewedStats as idbViewedStats, viewedDelete as idbViewedDelete, viewedBulkDelete as idbViewedBulkDelete, viewedQuery as idbViewedQuery, viewedExportJSON as idbViewedExportJSON, viewedCleanInjectedSourceTags as idbViewedCleanInjectedSourceTags, viewedRestore as idbViewedRestore, viewedBulkRestore as idbViewedBulkRestore, viewedPurge as idbViewedPurge, viewedBulkPurge as idbViewedBulkPurge, viewedQueryRecycleBin as idbViewedQueryRecycleBin, viewedPurgeExpired as idbViewedPurgeExpired, magnetsUpsertMany as idbMagnetsUpsertMany, magnetsQuery as idbMagnetsQuery, magnetsClearAll as idbMagnetsClearAll, magnetsClearExpired as idbMagnetsClearExpired, actorsPut as idbActorsPut, actorsBulkPut as idbActorsBulkPut, actorsGet as idbActorsGet, actorsDelete as idbActorsDelete, actorsQuery as idbActorsQuery, actorsStats as idbActorsStats, actorsExportJSON as idbActorsExportJSON, actorsRestore as idbActorsRestore, actorsBulkRestore as idbActorsBulkRestore, actorsPurge as idbActorsPurge, actorsBulkPurge as idbActorsBulkPurge, actorsQueryRecycleBin as idbActorsQueryRecycleBin, actorsPurgeExpired as idbActorsPurgeExpired, newWorksPut as idbNewWorksPut, newWorksBulkPut as idbNewWorksBulkPut, newWorksDelete as idbNewWorksDelete, newWorksGet as idbNewWorksGet, newWorksGetAll as idbNewWorksGetAll, newWorksQuery as idbNewWorksQuery, newWorksStats as idbNewWorksStats, newWorksExportJSON as idbNewWorksExportJSON, listsBulkPut as idbListsBulkPut, listsPut as idbListsPut, listsDelete as idbListsDelete, listsGetAll as idbListsGetAll, listsGetAllNormalized as idbListsGetAllNormalized, listsClear as idbListsClear, viewedPatchListIds as idbViewedPatchListIds, viewedBulkPatchListIds as idbViewedBulkPatchListIds, newWorksDailyStatRefreshToday as idbNewWorksDailyStatRefreshToday } from '../../platform/storage/indexedDb';
import { handleInsightsMessage } from './dbInsightsMessageHandlers';
import { handleLogMessage } from './dbLogMessageHandlers';
import { handleMagnetPushLogMessage } from './dbMagnetPushLogMessageHandlers';
import { handleGetAllTags } from './dbTagsMessageHandlers';

export function registerDbMessageRouter(): void {
  try { initDB().catch(() => {}); } catch {}
  try {
    chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse): boolean | void => {
      if (!message || typeof message !== 'object') return false;
      // DB message routing
      if (message.type === 'DB:VIEWED_PUT') {
        const record = message?.payload?.record;
        idbViewedPut(record).then((result) => sendResponse(result))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb put failed' }));
        return true; // async
      }
      if (message.type === 'DB:VIEWED_BULK_PUT') {
        const records = message?.payload?.records || [];
        idbViewedBulkPut(records).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb bulkPut failed' }));
        return true; // async
      }
      if (message.type === 'DB:VIEWED_GET_ALL') {
        idbViewedGetAll().then((records) => sendResponse({ success: true, records }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb getAll failed' }));
        return true; // async
      }
      if (message.type === 'DB:VIEWED_GET') {
        const id = message?.payload?.id;
        idbViewedGet(id).then((record) => sendResponse({ success: true, record }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb get failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_STATUS_GET_MANY') {
        const ids = Array.isArray(message?.payload?.ids) ? message.payload.ids : [];
        idbViewedStatusGetMany(ids).then((records) => sendResponse({ success: true, records }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed status batch get failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_COUNT') {
        const status = message?.payload?.status as any;
        const p = status ? idbViewedCountByStatus(status) : idbViewedCount();
        p.then((total) => sendResponse({ success: true, total }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb count failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_PAGE') {
        const payload = message?.payload || {};
        idbViewedPage(payload).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb page failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_QUERY') {
        const payload = message?.payload || {};
        idbViewedQuery(payload).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb query failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_EXPORT') {
        idbViewedExportJSON().then((json) => sendResponse({ success: true, json }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed export failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_CLEAN_INJECTED_SOURCE_TAGS') {
        const payload = message?.payload || {};
        idbViewedCleanInjectedSourceTags(payload).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed tag cleanup failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_STATS') {
        idbViewedStats().then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed stats failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_DELETE') {
        const id = message?.payload?.id;
        idbViewedDelete(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed delete failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_BULK_DELETE') {
        const ids = message?.payload?.ids || [];
        idbViewedBulkDelete(ids).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed bulk delete failed' }));
        return true;
      }
      // 番号库回收站
      if (message.type === 'DB:VIEWED_RESTORE') {
        const id = message?.payload?.id;
        idbViewedRestore(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed restore failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_BULK_RESTORE') {
        const ids = message?.payload?.ids || [];
        idbViewedBulkRestore(ids).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed bulk restore failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_PURGE') {
        const id = message?.payload?.id;
        idbViewedPurge(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed purge failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_BULK_PURGE') {
        const ids = message?.payload?.ids || [];
        idbViewedBulkPurge(ids).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed bulk purge failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_QUERY_RECYCLE_BIN') {
        const params = message?.payload || {};
        idbViewedQueryRecycleBin(params).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'idb viewed query recycle bin failed' }));
        return true;
      }
      if (handleLogMessage(message, sendResponse)) {
        return true;
      }
      if (handleMagnetPushLogMessage(message, sendResponse)) {
        return true;
      }
      // actors
      if (message.type === 'DB:ACTORS_PUT') {
        const record = message?.payload?.record;
        idbActorsPut(record).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors put failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_BULK_PUT') {
        const records = message?.payload?.records || [];
        idbActorsBulkPut(records).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors bulkPut failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_GET') {
        const id = message?.payload?.id;
        idbActorsGet(id).then((record) => sendResponse({ success: true, record }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors get failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_DELETE') {
        const id = message?.payload?.id;
        idbActorsDelete(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors delete failed' }));
        return true;
      }
      // 演员库回收站
      if (message.type === 'DB:ACTORS_RESTORE') {
        const id = message?.payload?.id;
        idbActorsRestore(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors restore failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_BULK_RESTORE') {
        const ids = message?.payload?.ids || [];
        idbActorsBulkRestore(ids).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors bulk restore failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_PURGE') {
        const id = message?.payload?.id;
        idbActorsPurge(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors purge failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_BULK_PURGE') {
        const ids = message?.payload?.ids || [];
        idbActorsBulkPurge(ids).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors bulk purge failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_QUERY_RECYCLE_BIN') {
        const params = message?.payload || {};
        idbActorsQueryRecycleBin(params).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors query recycle bin failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_QUERY') {
        const params = message?.payload || {};
        idbActorsQuery(params).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors query failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_STATS') {
        idbActorsStats().then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors stats failed' }));
        return true;
      }
      if (message.type === 'DB:ACTORS_EXPORT') {
        idbActorsExportJSON().then((json) => sendResponse({ success: true, json }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'actors export failed' }));
        return true;
      }
      // newWorks
      if (message.type === 'DB:NEWWORKS_PUT') {
        const record = message?.payload?.record;
        idbNewWorksPut(record).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'newWorks put failed' }));
        return true;
      }
      if (message.type === 'DB:NEWWORKS_BULK_PUT') {
        const records = message?.payload?.records || [];
        console.log(`[Background] 收到 NEWWORKS_BULK_PUT 请求，records 数量: ${records.length}`);
        idbNewWorksBulkPut(records).then(() => {
          console.log(`[Background] NEWWORKS_BULK_PUT 成功`);
          sendResponse({ success: true });
        }).catch((e) => {
          console.error(`[Background] NEWWORKS_BULK_PUT 失败:`, e);
          sendResponse({ success: false, error: e?.message || 'newWorks bulkPut failed' });
        });
        return true;
      }
      if (message.type === 'DB:NEWWORKS_DELETE') {
        const id = message?.payload?.id;
        idbNewWorksDelete(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'newWorks delete failed' }));
        return true;
      }
      if (message.type === 'DB:NEWWORKS_GET') {
        const id = message?.payload?.id;
        idbNewWorksGet(id).then((record) => sendResponse({ success: true, record }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'newWorks get failed' }));
        return true;
      }
      if (message.type === 'DB:NEWWORKS_GET_ALL') {
        idbNewWorksGetAll().then((records) => sendResponse({ success: true, records }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'newWorks getAll failed' }));
        return true;
      }
      if (message.type === 'DB:NEWWORKS_QUERY') {
        const params = message?.payload || {};
        idbNewWorksQuery(params).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'newWorks query failed' }));
        return true;
      }
      if (message.type === 'DB:NEWWORKS_STATS') {
        idbNewWorksStats().then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'newWorks stats failed' }));
        return true;
      }
      if (message.type === 'DB:NEWWORKS_EXPORT') {
        idbNewWorksExportJSON().then((json) => sendResponse({ success: true, json }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'newWorks export failed' }));
        return true;
      }
      // magnets
      if (message.type === 'DB:MAGNETS_UPSERT') {
        const records = message?.payload?.records || [];
        idbMagnetsUpsertMany(records).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'magnets upsert failed' }));
        return true;
      }
      if (message.type === 'DB:MAGNETS_QUERY') {
        const payload = message?.payload || {};
        idbMagnetsQuery(payload).then((data) => sendResponse({ success: true, ...data }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'magnets query failed' }));
        return true;
      }
      if (message.type === 'DB:MAGNETS_CLEAR') {
        idbMagnetsClearAll().then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'magnets clear failed' }));
        return true;
      }
      if (message.type === 'DB:MAGNETS_CLEAR_EXPIRED') {
        const beforeMs = message?.payload?.beforeMs;
        idbMagnetsClearExpired(beforeMs).then((removed) => sendResponse({ success: true, removed }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'magnets clear expired failed' }));
        return true;
      }
      // lists
      if (message.type === 'DB:LISTS_PUT') {
        const record = message?.payload?.record;
        idbListsPut(record).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'lists put failed' }));
        return true;
      }
      if (message.type === 'DB:LISTS_DELETE') {
        const id = message?.payload?.id;
        idbListsDelete(id).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'lists delete failed' }));
        return true;
      }
      if (message.type === 'DB:LISTS_GET_ALL_NORMALIZED') {
        idbListsGetAllNormalized().then((records) => sendResponse({ success: true, records }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'lists getAll normalized failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_PATCH_LIST') {
        const { videoId, listId, action } = message?.payload || {};
        idbViewedPatchListIds(videoId, listId, action).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'viewed patch list failed' }));
        return true;
      }
      if (message.type === 'DB:VIEWED_BULK_PATCH_LIST') {
        const { videoIds, listId, action } = message?.payload || {};
        idbViewedBulkPatchListIds(videoIds, listId, action).then((result) => sendResponse({ success: true, ...result }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'viewed bulk patch list failed' }));
        return true;
      }
      if (message.type === 'DB:LISTS_BULK_PUT') {
        const records = message?.payload?.records || [];
        idbListsBulkPut(records).then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'lists bulkPut failed' }));
        return true;
      }
      if (message.type === 'DB:LISTS_GET_ALL') {
        idbListsGetAll().then((records) => sendResponse({ success: true, records }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'lists getAll failed' }));
        return true;
      }
      if (message.type === 'DB:LISTS_CLEAR') {
        idbListsClear().then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'lists clear failed' }));
        return true;
      }
      if (handleInsightsMessage(message, sendResponse)) {
        return true;
      }
      if (message.type === 'DB:NEWWORKS_DAILY_STAT_REFRESH') {
        idbNewWorksDailyStatRefreshToday().then(() => sendResponse({ success: true }))
          .catch((e) => sendResponse({ success: false, error: e?.message || 'daily stat refresh failed' }));
        return true;
      }
      if (message.type === 'DB:GET_ALL_TAGS') {
        handleGetAllTags(message, sendResponse, { tagIndexIsCanonical: true });
        return true;
      }
      return false;
    });
  } catch {}
}
