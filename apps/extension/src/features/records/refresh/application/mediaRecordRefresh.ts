import { viewedGet } from '../../../../platform/storage/indexedDb';
import { patchMediaRecordMetadata } from '../../../../platform/storage/indexedDbMediaMetadata';
import { enqueueVideoChange, scheduleEnqueue } from '../../../cloudSync/enqueueLocalChange';
import { fetchHtml } from './cloudflareVerification';
import { findMediaMetadataMatch, parseMediaMetadata } from './mediaRecordMetadata';
import type { VideoRecord } from '../../../../types';

export async function refreshMediaRecordById(id: string): Promise<VideoRecord> {
  const before = await viewedGet(id);
  if (!before || before.deletedAt) throw new Error('影片不存在或已移入回收站');
  const code = before.videoCode?.trim().toUpperCase();
  if (!code) throw new Error('尚未识别番号，请先为这条影片补充准确番号');
  const search = await fetchHtml(`https://javdb.com/search?q=${encodeURIComponent(code)}&f=all`);
  const match = findMediaMetadataMatch(search, code);
  if (!match) throw new Error('源站未找到准确番号，已保留媒体资料');
  const metadata = parseMediaMetadata(await fetchHtml(match.href), code, match.href);
  const updated = await patchMediaRecordMetadata(before, metadata);
  scheduleEnqueue(() => enqueueVideoChange(updated));
  return updated;
}
