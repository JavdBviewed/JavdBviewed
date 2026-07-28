/**
 * @file xunleiSubtitleApi.ts
 * @description xunleiSubtitleApi
 * @module features/subtitles
 */
import { defaultHttpClient } from '../../../platform/network/httpClient';
import type { XunleiSubtitleResponse } from '../domain/types';

export async function fetchXunleiSubtitleResponse(apiUrl: string): Promise<XunleiSubtitleResponse> {
  return defaultHttpClient.getJson<XunleiSubtitleResponse>(apiUrl, {
    timeout: 10000,
    retries: 0,
    responseType: 'json',
  });
}

export async function fetchXunleiSubtitleText(subtitleUrl: string): Promise<string> {
  return defaultHttpClient.get<string>(subtitleUrl, {
    timeout: 20000,
    retries: 0,
    responseType: 'text',
  });
}
