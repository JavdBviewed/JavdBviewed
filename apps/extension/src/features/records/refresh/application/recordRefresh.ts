/**
 * @file recordRefresh.ts
 * @description recordRefresh
 * @module features/records
 */
import { refreshMediaRecordById } from './mediaRecordRefresh';
import { viewedPut as idbViewedPut } from '../../../../platform/storage/indexedDb';
import type { VideoRecord } from '../../../../types';
import { STORAGE_KEYS } from '../../../../utils/config';
import { getValue, setValue } from '../../../../utils/storage';
import { fetchHtml } from './cloudflareVerification';
import { isFC2Video, refreshFC2RecordById } from './fc2Refresh';
import { parseDetailPage, parseSearchResults } from './javdbParsers';

const log = (...args: any[]) => console.log('[Sync]', ...args);
const error = (...args: any[]) => console.error('[Sync]', ...args);

async function persistRecordToIndexedDb(record: VideoRecord): Promise<void> {
  try {
    await idbViewedPut(record);
  } catch (e: any) {
    log('[refreshRecordById] WARN IndexedDB write failed:', { videoId: record.id, error: e?.message });
  }
}

export async function refreshRecordById(videoId: string): Promise<VideoRecord> {
  if (videoId.startsWith('media:')) return refreshMediaRecordById(videoId);
  log(`[refreshRecordById] Function called with videoId: ${videoId}`);
  log(`[refreshRecordById] Starting refresh for: ${videoId}`);

  if (isFC2Video(videoId)) {
    log('[refreshRecordById] Detected FC2 video, using FC2 API');
    return refreshFC2RecordById(videoId);
  }

  const allRecords = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});
  const existingRecord = allRecords[videoId];

  let detailPageUrl: string;
  let dataTitle: string | undefined;

  if (existingRecord?.javdbUrl && existingRecord.javdbUrl !== '#') {
    detailPageUrl = existingRecord.javdbUrl;
    log(`[refreshRecordById] Using existing javdbUrl: ${detailPageUrl}`);
  } else {
    const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(videoId)}&f=all`;
    log(`[refreshRecordById] Step 1: Searching at: ${searchUrl}`);
    const searchHtml = await fetchHtml(searchUrl);
    const searchResult = parseSearchResults(searchHtml, videoId);

    if (!searchResult) {
      error(`[refreshRecordById] Could not find a search result for ${videoId} at ${searchUrl}. No matching data-code found.`);
      throw new Error(`Could not find a search result for ${videoId}`);
    }

    detailPageUrl = searchResult.href;
    dataTitle = searchResult.title;
    log(`[refreshRecordById] Found detail page URL: ${detailPageUrl}`);
    log(`[refreshRecordById] Found data-title: ${dataTitle}`);
  }

  log(`[refreshRecordById] Step 2: Scraping detail page: ${detailPageUrl}`);
  const detailHtml = await fetchHtml(detailPageUrl);
  const { releaseDate, tags, javdbImage } = parseDetailPage(detailHtml);

  log(`[refreshRecordById] Scraped data - Release Date: ${releaseDate || 'Not Found'}, Tags count: ${tags.length}, Cover Image: ${javdbImage || 'Not Found'}`);
  log(`[refreshRecordById] Found tags: ${tags.join(', ')}`);

  if (!dataTitle) {
    const titleMatch = detailHtml.match(/<title>([^|<]+)/);
    if (titleMatch) {
      const rawTitle = titleMatch[1].trim();
      dataTitle = rawTitle.replace(/^[A-Z0-9\-]+\s+/, '') || rawTitle;
    }
  }

  const finalTitle = dataTitle || existingRecord?.title || '未知标题';
  log(`[refreshRecordById] Using title: ${finalTitle}`);
  log('[refreshRecordById] Step 3: Updating record in storage.');

  const now = Date.now();
  if (!existingRecord) {
    const newRecord: VideoRecord = {
      id: videoId,
      title: finalTitle,
      status: 'browsed' as any,
      tags,
      createdAt: now,
      updatedAt: now,
      releaseDate,
      javdbUrl: detailPageUrl,
      javdbImage,
    };

    allRecords[videoId] = newRecord;
    await setValue(STORAGE_KEYS.VIEWED_RECORDS, allRecords);
    await persistRecordToIndexedDb(newRecord);
    log(`[refreshRecordById] Inserted new record for ${videoId} and saved to storage.`);
    return newRecord;
  }

  log('[refreshRecordById] Found existing record:', existingRecord);

  const updatedRecord: VideoRecord = {
    ...existingRecord,
    id: videoId,
    title: finalTitle,
    tags: tags.length > 0 ? tags : existingRecord.tags,
    releaseDate: releaseDate || existingRecord.releaseDate,
    javdbUrl: detailPageUrl,
    javdbImage: javdbImage || existingRecord.javdbImage,
    updatedAt: now,
  };
  log('[refreshRecordById] Constructed updated record:', updatedRecord);

  allRecords[videoId] = updatedRecord;
  await setValue(STORAGE_KEYS.VIEWED_RECORDS, allRecords);
  await persistRecordToIndexedDb(updatedRecord);
  log('[refreshRecordById] Successfully saved updated records object to storage.');
  log(`[refreshRecordById] Finished refresh for ${videoId}. Returning updated record.`);
  return updatedRecord;
}
