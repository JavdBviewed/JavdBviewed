import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../../../ui/primitives/Button/Button';
import { sendRuntimeMessage } from '../../../../platform/browser/runtimeMessages';
import {
  EMPTY_MEDIA_CLEANUP_STATE,
  EMPTY_MEDIA_DELETION_HISTORY,
  type MediaCleanupCopyEntry,
  type MediaCleanupState,
  type MediaDeletionHistoryState,
} from '../../../../features/mediaCleanup/mediaCleanupModel';
import {
  importHistoricalWatchedFromCurrentLibrary,
  loadMediaCleanupState,
  loadMediaDeletionHistory,
} from '../../../../features/mediaCleanup/mediaCleanupStorage';

type CleanupTab = 'pending' | 'failed' | 'history';
type SelectedCopy = { titleId: string; copyId: string };
type MediaCleanupPanelProps = {
  refreshKey?: number;
  onScan?: () => Promise<{ enqueuedCount: number; warning?: string }>;
};

function selectionKey(titleId: string, copyId: string): string {
  return `${titleId}\u0000${copyId}`;
}

function formatTime(value: number): string {
  return value > 0 ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
}

function copyLabel(copy: MediaCleanupCopyEntry): string {
  const source = copy.source === '115' ? '115' : copy.source === 'jellyfin' ? 'Jellyfin' : 'Emby';
  return [source, copy.serverName, copy.fileName || copy.folderPath].filter(Boolean).join(' · ');
}

export function MediaCleanupPanel({ refreshKey = 0, onScan }: MediaCleanupPanelProps) {
  const [cleanup, setCleanup] = useState<MediaCleanupState>(EMPTY_MEDIA_CLEANUP_STATE);
  const [history, setHistory] = useState<MediaDeletionHistoryState>(EMPTY_MEDIA_DELETION_HISTORY);
  const [tab, setTab] = useState<CleanupTab>('pending');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    const [nextCleanup, nextHistory] = await Promise.all([
      loadMediaCleanupState(),
      loadMediaDeletionHistory(),
    ]);
    setCleanup(nextCleanup);
    setHistory(nextHistory);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const rows = useMemo(() => Object.values(cleanup.items).flatMap((item) => (
    Object.values(item.copies)
      .filter((copy) => tab === 'pending'
        ? copy.status === 'pending'
        : tab === 'failed'
          ? copy.status === 'failed'
          : false)
      .map((copy) => ({ item, copy }))
  )), [cleanup.items, tab]);

  const titleGroups = useMemo(() => Object.values(cleanup.items).map((item) => ({
    item,
    copies: Object.values(item.copies).filter((copy) => tab === 'pending'
      ? copy.status === 'pending'
      : tab === 'failed'
        ? copy.status === 'failed'
        : false),
  })).filter((group) => group.copies.length > 0), [cleanup.items, tab]);

  const selected = useMemo<SelectedCopy[]>(() => rows
    .filter(({ item, copy }) => selectedKeys.has(selectionKey(item.titleId, copy.copyId)))
    .map(({ item, copy }) => ({ titleId: item.titleId, copyId: copy.copyId })), [rows, selectedKeys]);

  const toggleSelected = (titleId: string, copyId: string) => {
    const key = selectionKey(titleId, copyId);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const executeSelected = async () => {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setMessage(`正在处理 0 / ${selected.length}`);
    let failed = 0;
    for (let index = 0; index < selected.length; index += 1) {
      const target = selected[index];
      try {
        const response = await sendRuntimeMessage<{ success?: boolean; error?: string; message?: string }>({
          type: 'MEDIA_CLEANUP_DELETE_COPY',
          titleId: target.titleId,
          copyId: target.copyId,
        });
        if (!response?.success) failed += 1;
      } catch {
        failed += 1;
      }
      setMessage(`正在处理 ${index + 1} / ${selected.length}`);
    }
    setConfirming(false);
    setSelectedKeys(new Set());
    setMessage(`已处理 ${selected.length} 个文件，失败 ${failed} 个`);
    setBusy(false);
    await reload();
    if (failed > 0) setTab('failed');
  };

  const scanWatched = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('正在更新媒体来源并查找已看影片…');
    try {
      const result: { enqueuedCount: number; warning?: string } = onScan
        ? await onScan()
        : {
          enqueuedCount: (await importHistoricalWatchedFromCurrentLibrary()).enqueuedCount,
        };
      await reload();
      setMessage(
        result.enqueuedCount > 0
          ? `找到并加入 ${result.enqueuedCount} 部已看影片${result.warning ? `；${result.warning}` : ''}`
          : `查找完成，没有新增待处理影片${result.warning ? `；${result.warning}` : ''}`,
      );
      setTab('pending');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '查找失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ml-cleanup-panel" data-media-cleanup-panel="1">
      <section className="ml-cleanup-scan-card">
        <div>
          <strong>整理已看影片</strong>
          <p>先更新媒体来源的观看状态，再找出已经看完的影片。查找只会生成待处理列表，不会自动删除任何文件。</p>
        </div>
        <Button disabled={busy} onClick={() => void scanWatched()}>
          {busy ? '正在查找…' : '查找已看影片'}
        </Button>
      </section>

      <div className="ml-cleanup-tabs" role="tablist" aria-label="影片整理视图">
        {([ 
          ['pending', '待处理'],
          ['failed', '处理失败'],
          ['history', '操作记录'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : ''}
            onClick={() => {
              setTab(id);
              setSelectedKeys(new Set());
              setConfirming(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {message ? <p className="ml-cleanup-msg" aria-live="polite">{message}</p> : null}

      {tab === 'history' ? (
        <div className="ml-cleanup-history">
          {Object.values(history.records).length === 0 ? (
            <p className="ml-cleanup-empty">还没有操作记录。</p>
          ) : Object.values(history.records)
            .sort((a, b) => b.deletedAt - a.deletedAt)
            .map((record) => (
              <div key={record.id} className="ml-cleanup-history-row">
                <div>
                  <strong>{record.code}</strong>
                  <span>{record.title}</span>
                </div>
                <p>{[record.source, record.serverName, record.fileName || record.folderPath].filter(Boolean).join(' · ')}</p>
                <small>
                  {record.reason === 'external_missing' ? '更新媒体来源时发现文件已不存在' : '已在扩展中删除'}
                  {' · '}{formatTime(record.deletedAt)}
                </small>
              </div>
            ))}
          <p className="ml-cleanup-disclaimer">操作记录只用于核对处理结果，不代表文件已有备份，也不能用于恢复文件。</p>
        </div>
      ) : rows.length === 0 ? (
        <p className="ml-cleanup-empty">{tab === 'pending' ? '当前没有待处理影片。点击上方按钮查找已看影片。' : '当前没有处理失败的文件。'}</p>
      ) : (
        <div className="ml-cleanup-title-list">
          {titleGroups.map(({ item, copies }) => (
            <section key={item.titleId} className="ml-cleanup-title-group" data-media-cleanup-title-group="1">
              <header>
                <strong>{item.code}</strong>
                <span>{item.title}</span>
                <small>{copies.length} 个来源文件</small>
              </header>
              <div className="ml-cleanup-copy-list">
                {copies.map((copy) => {
                  const key = selectionKey(item.titleId, copy.copyId);
                  return (
                    <label key={key} className={`ml-cleanup-copy-row is-${copy.status}`}>
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(key)}
                        disabled={busy}
                        onChange={() => toggleSelected(item.titleId, copy.copyId)}
                      />
                      <span className="ml-cleanup-copy-body">
                        <strong>{copyLabel(copy)}</strong>
                        <small>{copy.folderPath || copy.fileName || '未记录文件位置'}</small>
                        {copy.error ? <em>{copy.error}</em> : null}
                      </span>
                      <span className="ml-cleanup-copy-status">{copy.status === 'failed' ? '可重试' : '待确认'}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab !== 'history' ? (
        <div className="ml-cleanup-footer">
          <span>已选择 {selected.length} 个文件</span>
          <Button disabled={busy || selected.length === 0} onClick={() => setConfirming(true)}>
            删除选中的文件
          </Button>
        </div>
      ) : null}

      {confirming ? (
        <div className="ml-cleanup-confirm" role="alertdialog" aria-modal="true" aria-labelledby="cleanup-confirm-title">
          <div className="ml-cleanup-confirm-body">
            <h3 id="cleanup-confirm-title">确认删除 {selected.length} 个文件？</h3>
            <p>115 文件会移入回收站；Emby/Jellyfin 管理的本地媒体文件可能被直接删除。请确认已有备份或不再需要这些文件。</p>
            <ul>
              {selected.map((target) => {
                const item = cleanup.items[target.titleId];
                const copy = item?.copies[target.copyId];
                return <li key={selectionKey(target.titleId, target.copyId)}>{item?.code} · {copy ? copyLabel(copy) : target.copyId}</li>;
              })}
            </ul>
            <div className="ml-cleanup-confirm-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>取消</Button>
              <Button disabled={busy} onClick={() => void executeSelected()}>{busy ? '删除中…' : '确认删除'}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
