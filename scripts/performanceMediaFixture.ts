/**
 * @file performanceMediaFixture.ts
 * @description 生成不含凭证和远程资源的媒体库性能测试数据。
 */

export interface PerformanceMediaFixture {
  settings: Record<string, never>;
  emby_library_state: {
    updatedAt: number;
    entries: Record<string, Array<{
      serverType: 'emby';
      serverName: string;
      serverUrl: '';
      itemId: string;
      itemName: string;
      path: string;
      coverImageUrl?: string;
      imageUrls?: Partial<Record<'Primary' | 'Thumb' | 'Backdrop', string>>;
      updatedAt: number;
    }>>;
  };
  drive115_library_state: {
    updatedAt: number;
    entries: Array<{
      code: string;
      title: string;
      videoFileId: string;
      pickCode: string;
      fileName: string;
      folderName: string;
      updatedAt: number;
    }>;
  };
}

export function buildPerformanceMediaFixture(
  itemCount: number,
  now = Date.now(),
  coverBaseUrl?: string,
): PerformanceMediaFixture {
  const count = Math.max(0, Math.trunc(itemCount));
  const embyEntries: PerformanceMediaFixture['emby_library_state']['entries'] = {};
  const driveEntries: PerformanceMediaFixture['drive115_library_state']['entries'] = [];
  const normalizedCoverBaseUrl = coverBaseUrl?.replace(/\/+$/, '');

  for (let index = 0; index < count; index += 1) {
    const number = index + 1;
    const code = `PERF-${String(number).padStart(4, '0')}`;
    const fileName = `${code}.mp4`;
    const coverUrl = normalizedCoverBaseUrl ? `${normalizedCoverBaseUrl}/${code}.jpg` : undefined;
    embyEntries[code] = [{
      serverType: 'emby',
      serverName: '性能测试 Emby',
      serverUrl: '',
      itemId: `perf-emby-item-${number}`,
      itemName: `${code} 测试影片`,
      path: fileName,
      ...(coverUrl ? { imageUrls: { Thumb: coverUrl } } : {}),
      updatedAt: now,
    }];
    driveEntries.push({
      code,
      title: `${code} 测试影片`,
      videoFileId: `perf-file-${number}`,
      pickCode: `perf-pick-${number}`,
      fileName,
      folderName: code,
      updatedAt: now,
    });
  }

  return {
    settings: {},
    emby_library_state: { updatedAt: now, entries: embyEntries },
    drive115_library_state: { updatedAt: now, entries: driveEntries },
  };
}
