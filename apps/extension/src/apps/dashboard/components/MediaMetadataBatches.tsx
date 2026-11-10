import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/primitives/Button/Button';
import { sendRuntimeMessage } from '../../../platform/browser/runtimeMessages';
import { requireAuthIfRestricted } from '../../../features/privacy';
import { MEDIA_METADATA_TASKS_KEY, type MediaMetadataBatch, type MediaMetadataItemStatus } from '../../../features/media/mediaMetadataTasks';

type Reply = { success: boolean; batches?: MediaMetadataBatch[]; batch?: MediaMetadataBatch; error?: string };
const statuses: Record<MediaMetadataBatch['status'], string> = { pending: '待确认', running: '同步中 / 可继续', paused: '已暂停', completed: '本批处理结束', cancelled: '已跳过' };
const itemStatuses: Record<MediaMetadataItemStatus, string> = { pending: '等待同步', running: '读取源站', done: '已补全', failed: '失败', unidentified: '未识别番号' };
async function command(action: string, batchId?: string, runId?: string): Promise<Reply> {
  const result = await sendRuntimeMessage<Reply>({ type: `MEDIA_METADATA:${action}`, batchId, runId });
  if (!result?.success) throw new Error(result?.error || '暂时无法读取资料同步任务');
  return result;
}

/** Shared parent-batch view used by media settings and the existing data sync page. */
export function MediaMetadataBatches() {
  const [batches, setBatches] = useState<MediaMetadataBatch[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  const active = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const load = async () => {
    const generation = ++loadGeneration.current;
    try {
      const result = await command('LIST');
      if (mounted.current && generation === loadGeneration.current) setBatches(result.batches || []);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '读取失败'); }
  };
  const apply = (batch: MediaMetadataBatch) => {
    if (mounted.current) setBatches(current => current.map(b => b.id === batch.id ? batch : b));
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[MEDIA_METADATA_TASKS_KEY]) void load();
    };
    const stop = () => { const id = active.current; active.current = null; if (id) void command('PAUSE', id).catch(() => {}); };
    const storageEvents = typeof chrome === 'undefined' ? undefined : chrome.storage?.onChanged;
    storageEvents?.addListener(changed);
    window.addEventListener('beforeunload', stop);
    return () => {
      mounted.current = false; loadGeneration.current++; stop();
      storageEvents?.removeListener(changed);
      window.removeEventListener('beforeunload', stop);
    };
  }, []);

  const run = async (id: string) => {
    if (active.current) return;
    active.current = id; setBusy(id); setError('');
    try {
      let batch = (await command('CONFIRM', id)).batch!;
      apply(batch);
      while (mounted.current && active.current === id && batch.status === 'running') {
        batch = (await command('STEP', id, batch.runId)).batch!;
        apply(batch);
        if (batch.status === 'running') await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '同步失败，可稍后继续');
    } finally {
      if (active.current === id) active.current = null;
      if (mounted.current) { setBusy(null); await load(); }
    }
  };
  const stop = async (id: string, action: 'PAUSE' | 'DISMISS') => {
    if (active.current === id) active.current = null;
    try { apply((await command(action, id)).batch!); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
  };

  return <section data-media-metadata-batches className="mx-2 my-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">媒体影片资料同步</h3>
      <Button variant="ghost" size="sm" onClick={() => void load()}>刷新任务</Button>
    </div>
    <p className="my-2 text-sm text-[var(--color-fg-muted)]">媒体索引补录的影片已标记为“已观看”，播放记录单独决定“真实已看”。确认后按番号从 JavDB 补全标题、封面、演员等资料。</p>
    <p className="mb-2 text-sm text-[var(--color-fg-muted)]">可以稍后再处理。暂停或关闭页面后，当前影片处理完即停止；再次打开可继续。选择暂不同步的历史批次仍会保留，可随时重新确认，已补全的影片不会重复处理。</p>
    {error ? <p role="alert">{error}</p> : null}
    {!batches.length ? <p className="text-sm">暂无待补全的媒体影片。扫描发现新影片后会在这里生成批次。</p> : null}
    <div className="space-y-3">{[...batches].reverse().map(batch => <BatchCard key={batch.id} batch={batch} busy={busy}
      onRun={() => { void requireAuthIfRestricted('data-sync', () => run(batch.id)).catch(e => setError(e instanceof Error ? e.message : '无法开始同步')); }}
      onPause={() => void stop(batch.id, 'PAUSE')} onDismiss={() => void stop(batch.id, 'DISMISS')} />)}</div>
  </section>;
}

function BatchCard({ batch, busy, onRun, onPause, onDismiss }: { batch: MediaMetadataBatch; busy: string | null; onRun(): void; onPause(): void; onDismiss(): void }) {
  const [page, setPage] = useState(0);
  const count = (status: MediaMetadataItemStatus) => batch.items.filter(i => i.status === status).length;
  const retry = count('failed'); const todo = count('pending') + count('running') + retry;
  const cancelled = batch.status === 'cancelled';
  return <article data-metadata-batch={batch.id} className="rounded-[var(--radius-2)] border border-[var(--color-border)] p-3">
    <div className="flex flex-wrap justify-between gap-2"><strong>媒体资料批次 · {new Date(batch.createdAt).toLocaleString()}</strong><span>{statuses[batch.status]}</span></div>
    <p className="my-2 text-sm" aria-live="polite">共 {batch.items.length} 部 · 已补全 {count('done')} · 失败 {retry} · 未识别番号 {count('unidentified')}</p>
    <div className="my-2 flex flex-wrap gap-2">
      {todo > 0 && busy !== batch.id ? <Button disabled={busy !== null} onClick={onRun}>{cancelled ? '重新确认同步' : batch.status === 'pending' ? '确认同步源站资料' : batch.status === 'completed' ? '重试失败项' : '继续同步'}</Button> : null}
      {!cancelled && (busy === batch.id || batch.status === 'running') ? <Button variant="secondary" onClick={onPause}>暂停（完成当前项）</Button> : null}
      {batch.status === 'pending' ? <Button variant="ghost" disabled={busy === batch.id} onClick={onDismiss}>本批暂不同步</Button> : null}
    </div>
    <details><summary className="cursor-pointer text-sm">查看影片与处理结果</summary>
      <ul className="mt-2 space-y-2">{batch.items.slice(page * 25, (page + 1) * 25).map(item => <li key={item.recordId} className="break-words text-sm">
        <strong>{item.code || '未识别番号'}</strong> · {item.title} — {itemStatuses[item.status]}
        {item.error ? <p role="status">{item.error}</p> : null}
      </li>)}</ul>
      {batch.items.length > 25 ? <div className="mt-2 flex gap-2"><Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button><span>{page + 1} / {Math.ceil(batch.items.length / 25)}</span><Button variant="ghost" size="sm" disabled={(page + 1) * 25 >= batch.items.length} onClick={() => setPage(p => p + 1)}>下一页</Button></div> : null}
    </details>
  </article>;
}
