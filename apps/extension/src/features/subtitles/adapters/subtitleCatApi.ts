/**
 * @file subtitleCatApi.ts
 * @description SubTitleCat 字幕页面抓取接口
 * @module features/subtitles
 */
import { defaultHttpClient } from '../../../platform/network/httpClient';

export async function fetchSubtitleCatDocument(url: string): Promise<Document> {
  return defaultHttpClient.getDocument(url, {
    timeout: 12000,
    retries: 0,
    responseType: 'document',
  });
}

export async function fetchSubtitleCatText(url: string): Promise<string> {
  return defaultHttpClient.get<string>(url, {
    timeout: 20000,
    retries: 0,
    responseType: 'text',
  });
}
