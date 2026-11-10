// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaMetadataTaskService } from '../../../features/media/mediaMetadataTasks';
import type { MediaMetadataBatch } from '../../../features/media/mediaMetadataTasks';
const message = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/browser/runtimeMessages', () => ({ sendRuntimeMessage: message }));
vi.mock('../../../features/privacy', () => ({ requireAuthIfRestricted: async (_: string, fn: () => unknown) => fn() }));
import { MediaMetadataBatches } from './MediaMetadataBatches';
let root: Root; let host: HTMLDivElement; let service: MediaMetadataTaskService; let refresh: ReturnType<typeof vi.fn>;
beforeEach(() => {
 (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
 vi.stubGlobal('chrome', { storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
 let stored: MediaMetadataBatch[] = []; let id = 0; refresh = vi.fn(async () => {});
 service = new MediaMetadataTaskService({ load: async () => structuredClone(stored), save: async b => { stored = structuredClone(b); }, records: async () => [
   { id: 'media:a', title: '媒体影片', videoCode: 'ABC-123', status: 'viewed', createdAt: 1, updatedAt: 1 },
   { id: 'media:b', title: '无番号影片', status: 'viewed', createdAt: 1, updatedAt: 1 },
 ], refresh, id: () => `id${++id}`, now: () => 1 });
 message.mockImplementation(async (m: {type: string; batchId: string; runId: string}) => {
   if (m.type === 'MEDIA_METADATA:LIST') return { success: true, batches: await service.discover() };
   const batch = m.type === 'MEDIA_METADATA:CONFIRM' ? await service.confirm(m.batchId) : m.type === 'MEDIA_METADATA:STEP' ? await service.step(m.batchId,m.runId) : m.type === 'MEDIA_METADATA:PAUSE' ? await service.pause(m.batchId) : await service.dismiss(m.batchId);
   return { success: true, batch };
 });
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;
it('shows one pending parent batch and requires a click before fetching metadata', async () => {
 await act(async () => root.render(createElement(MediaMetadataBatches)));
 expect(host.textContent).toContain('待确认'); expect(host.textContent).toContain('未识别番号 1'); expect(refresh).not.toHaveBeenCalled();
 await act(async () => button('确认同步').click());
 expect(refresh).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('已补全 1'); expect(host.textContent).toContain('无番号影片');
 expect(message.mock.calls.some(([m]) => m.type === 'MEDIA_METADATA:CONFIRM')).toBe(true);
});
it('dismisses a pending batch without a site request and does not recreate it on remount', async () => {
 await act(async () => root.render(createElement(MediaMetadataBatches)));
 await act(async () => button('不需要').click());
 expect(refresh).not.toHaveBeenCalled(); expect(host.textContent).toContain('已取消');
 await act(async () => { root.unmount(); root = createRoot(host); root.render(createElement(MediaMetadataBatches)); });
 expect(host.textContent).toContain('已取消'); expect(button('确认同步')).toBeUndefined();
});
it('shows failure and an explicit retry action, without counting it as completed metadata', async () => {
 refresh.mockRejectedValueOnce(new Error('未找到准确番号'));
 await act(async () => root.render(createElement(MediaMetadataBatches)));
 await act(async () => button('确认同步').click());
 expect(host.textContent).toContain('失败 1'); expect(host.textContent).toContain('未找到准确番号');
 await act(async () => button('重试失败项').click());
 expect(refresh).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('已补全 1');
});
