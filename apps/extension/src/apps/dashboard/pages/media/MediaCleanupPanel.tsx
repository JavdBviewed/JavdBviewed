import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../ui/primitives/Button/Button';
import { MediaCover } from '../../../../ui/primitives/MediaCover/MediaCover';
import { sendRuntimeMessage } from '../../../../platform/browser/runtimeMessages';
import {
  EMPTY_MEDIA_CLEANUP_STATE,
  EMPTY_MEDIA_DELETION_HISTORY,
  type MediaCleanupCopyEntry,
  type MediaCleanupItem,
  type MediaCleanupState,
  type MediaDeletionHistoryState,
} from '../../../../features/mediaCleanup/mediaCleanupModel';
import {
  importHistoricalWatchedFromCurrentLibrary,
  loadMediaCleanupState,
  loadMediaDeletionHistory,
} from '../../../../features/mediaCleanup/mediaCleanupStorage';
import {
  getCleanupPage,
  getTitleSelectionState,
  selectionKey,
  setPageSelection,
  setTitleSelection,
  type MediaCleanupTitleGroup,
} from './mediaCleanupViewModel';
import { useDrive115Cover } from './useDrive115Cover';

type CleanupTab = 'pending' | 'failed' | 'history';
type SelectedCopy = { titleId: string; copyId: string };
type MediaCleanupPanelProps = {
  refreshKey?: number;
  onScan?: () => Promise<{ enqueuedCount: number; warning?: string }>;
};

function formatTime(value: number): string {
  return value > 0 ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
}

function sourceLabel(source: MediaCleanupCopyEntry['source']): string {
  if (source === '115') return '115 网盘';
  if (source === 'jellyfin') return 'Jellyfin';
  return 'Emby';
}

function copyLabel(copy: MediaCleanupCopyEntry): string {
  return [sourceLabel(copy.source), copy.serverName, copy.fileName || copy.folderPath].filter(Boolean).join(' · ');
}

function sourceSummary(copies: readonly MediaCleanupCopyEntry[]): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const copy of copies) {
    const key = `${copy.source}\u0000${copy.serverName || ''}`;
    const current = counts.get(key) || {
      label: [sourceLabel(copy.source), copy.serverName].filter(Boolean).join(' · '),
      count: 0,
    };
    current.count += 1;
    counts.set(key, current);
  }
  return Array.from(counts.values()).map(({ label, count }) => `${label} · ${count} 个文件`);
}

function toHistoryTitleGroups(history: MediaDeletionHistoryState): MediaCleanupTitleGroup[] {
  const groups = new Map<string, MediaCleanupTitleGroup>();
  for (const record of Object.values(history.records)) {
    const copy: MediaCleanupCopyEntry = {
      ...record,
      status: 'deleted',
      updatedAt: record.deletedAt,
    };
    const current = groups.get(record.titleId);
    if (current) {
      current.copies.push(copy);
      current.item.copies[copy.copyId] = copy;
      current.item.updatedAt = Math.max(current.item.updatedAt, record.deletedAt);
      continue;
    }
    const item: MediaCleanupItem = {
      id: record.titleId,
      titleId: record.titleId,
      code: record.code,
      title: record.title,
      reason: 'watched',
      addedAt: record.deletedAt,
      updatedAt: record.deletedAt,
      copies: { [copy.copyId]: copy },
    };
    groups.set(record.titleId, { item, copies: [copy] });
  }
  return Array.from(groups.values()).sort((a, b) => b.item.updatedAt - a.item.updatedAt);
}

function IndeterminateCheckbox({
  checked,
  indeterminate,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
    />
  );
}

function CleanupCardCover({ code, copies }: { code: string; copies: readonly MediaCleanupCopyEntry[] }) {
  const directCover = copies.find((copy) => Boolean(copy.coverImageUrl))?.coverImageUrl;
  const driveCover = copies.find((copy) => copy.source === '115' && Boolean(copy.coverPickCode));
  const { ref, coverUrl } = useDrive115Cover({
    source: '115',
    coverPickCode: driveCover?.coverPickCode,
  });
  return (
    <div ref={ref} className="ml-cleanup-card-cover">
      <MediaCover
        imageUrl={directCover || coverUrl}
        fallbackImageUrl={directCover ? coverUrl : undefined}
        fit="cover"
        hoverZoom={false}
        showPlayHint={false}
        alt={code}
        artStyle={{ backgroundColor: 'var(--color-bg-muted)' }}
      />
    </div>
  );
}

function CleanupTitleCard({
  group,
  selectedKeys,
  busy,
  history,
  onToggleTitle,
  onToggleCopy,
}: {
  group: MediaCleanupTitleGroup;
  selectedKeys: ReadonlySet<string>;
  busy: boolean;
  history?: boolean;
  onToggleTitle: (group: MediaCleanupTitleGroup) => void;
  onToggleCopy: (item: MediaCleanupItem, copy: MediaCleanupCopyEntry) => void;
}) {
  const { item, copies } = group;
  const allCopies = Object.values(item.copies);
  const selection = getTitleSelectionState(selectedKeys, item, copies);
  return (
    <article className="ml-cleanup-card" data-media-cleanup-card="1">
      <CleanupCardCover code={item.code} copies={allCopies} />
      <div className="ml-cleanup-card-main">
        <div className="ml-cleanup-card-heading">
          {history ? null : (
            <IndeterminateCheckbox
              checked={selection.isSelected}
              indeterminate={selection.isPartial}
              disabled={busy}
              label={`选择 ${item.code} 的全部来源文件`}
              onChange={() => onToggleTitle(group)}
            />
          )}
          <div>
            <strong>{item.code}</strong>
            <span>{item.title}</span>
          </div>
        </div>
        <div className="ml-cleanup-source-badges" aria-label={`${item.code} 的来源`}>
          {sourceSummary(allCopies).map((label) => <span key={label}>{label}</span>)}
        </div>
        <small className="ml-cleanup-card-time">
          {history ? `处理于 ${formatTime(item.updatedAt)}` : `已看于 ${formatTime(Math.max(0, ...allCopies.map((copy) => copy.watchedAt || 0))) || '未记录'}`}
        </small>
        {!history ? (() => {
          const failedCopies = allCopies.filter((copy) => copy.status === 'failed' && copy.error);
          if (failedCopies.length === 0) return null;
          return (
            <p className="ml-cleanup-card-error" role="alert">
              {failedCopies.length === 1
                ? failedCopies[0].error
                : `部分来源删除失败：${failedCopies.map((copy) => `${copyLabel(copy)}（${copy.error}）`).join('；')}`}
            </p>
          );
        })() : null}
        <details className="ml-cleanup-card-details">
          <summary>{history ? `查看 ${copies.length} 条操作记录` : `查看 ${allCopies.length} 个来源文件`}</summary>
          <div className="ml-cleanup-copy-list">
            {allCopies.map((copy) => {
              const isActionable = copies.some((candidate) => candidate.copyId === copy.copyId);
              const isSelected = selectedKeys.has(selectionKey(item.titleId, copy.copyId));
              return (
                <label key={copy.copyId} className={`ml-cleanup-copy-row is-${copy.status}`}>
                  {history ? null : (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={busy || !isActionable}
                      aria-label={`选择 ${copyLabel(copy)}`}
                      onChange={() => onToggleCopy(item, copy)}
                    />
                  )}
                  <span className="ml-cleanup-copy-body">
                    <strong>{copyLabel(copy)}</strong>
                    <small>{copy.folderPath || copy.fileName || '未记录文件位置'}</small>
                    {copy.error ? <em>{copy.error}</em> : null}
                  </span>
                  <span className="ml-cleanup-copy-status">
                    {history
                      ? '已处理'
                      : isActionable
                        ? copy.status === 'failed' ? '可重试' : '待确认'
                        : copy.status === 'deleted' ? '已处理' : '其他列表'}
                  </span>
                </label>
              );
            })}
          </div>
        </details>
      </div>
    </article>
  );
}

export function MediaCleanupPanel({ refreshKey = 0, onScan }: MediaCleanupPanelProps) {
  const [cleanup, setCleanup] = useState<MediaCleanupState>(EMPTY_MEDIA_CLEANUP_STATE);
  const [history, setHistory] = useState<MediaDeletionHistoryState>(EMPTY_MEDIA_DELETION_HISTORY);
  const [tab, setTab] = useState<CleanupTab>('pending');
  const [pageNumber, setPageNumber] = useState(1);
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

  const titleGroups = useMemo<MediaCleanupTitleGroup[]>(() => Object.values(cleanup.items).map((item) => ({
    item,
    copies: Object.values(item.copies).filter((copy) => tab === 'pending'
      ? copy.status === 'pending'
      : tab === 'failed'
        ? copy.status === 'failed'
        : false),
  })).filter((group) => group.copies.length > 0), [cleanup.items, tab]);
  const historyGroups = useMemo(() => toHistoryTitleGroups(history), [history]);
  const activeGroups = tab === 'history' ? historyGroups : titleGroups;
  const page = useMemo(() => getCleanupPage(activeGroups, pageNumber), [activeGroups, pageNumber]);

  useEffect(() => {
    if (pageNumber !== page.page) setPageNumber(page.page);
  }, [page.page, pageNumber]);

  const selected = useMemo<SelectedCopy[]>(() => titleGroups.flatMap(({ item, copies }) => copies
    .filter((copy) => selectedKeys.has(selectionKey(item.titleId, copy.copyId)))
    .map((copy) => ({ titleId: item.titleId, copyId: copy.copyId }))), [titleGroups, selectedKeys]);
  const selectedTitleCount = useMemo(() => new Set(selected.map((item) => item.titleId)).size, [selected]);
  const pageFullySelected = page.items.length > 0 && page.items.every((group) => (
    getTitleSelectionState(selectedKeys, group.item, group.copies).isSelected
  ));
  const pagePartiallySelected = page.items.some((group) => {
    const state = getTitleSelectionState(selectedKeys, group.item, group.copies);
    return state.isSelected || state.isPartial;
  }) && !pageFullySelected;
  const selectedSourceSummary = useMemo(() => {
    const counts = new Map<MediaCleanupCopyEntry['source'], number>();
    for (const target of selected) {
      const copy = cleanup.items[target.titleId]?.copies[target.copyId];
      if (copy) counts.set(copy.source, (counts.get(copy.source) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([source, count]) => `${sourceLabel(source)} ${count} 个文件`);
  }, [cleanup.items, selected]);

  const toggleSelected = (item: MediaCleanupItem, copy: MediaCleanupCopyEntry) => {
    const key = selectionKey(item.titleId, copy.copyId);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTitle = (group: MediaCleanupTitleGroup) => {
    const state = getTitleSelectionState(selectedKeys, group.item, group.copies);
    setSelectedKeys((current) => setTitleSelection(current, group.item, group.copies, !state.isSelected));
  };

  const togglePage = () => {
    setSelectedKeys((current) => setPageSelection(current, page.items, !pageFullySelected));
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
    setMessage(
      failed === 0
        ? `已处理 ${selected.length} 个文件，全部成功`
        : `已处理 ${selected.length} 个文件，失败 ${failed} 个；失败原因见「处理失败」列表`,
    );
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
      setPageNumber(1);
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
          <p>更新来源观看状态后，列出已看影片在 115 网盘和自建媒体库中的文件。查找不会自动选择或删除任何文件。</p>
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
              setPageNumber(1);
              setSelectedKeys(new Set());
              setConfirming(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {message ? <p className="ml-cleanup-msg" aria-live="polite">{message}</p> : null}

      {activeGroups.length === 0 ? (
        <p className="ml-cleanup-empty">
          {tab === 'pending'
            ? '当前没有待处理影片。点击上方按钮查找已看影片。'
            : tab === 'failed'
              ? '当前没有处理失败的文件。'
              : '还没有操作记录。'}
        </p>
      ) : (
        <>
          {tab !== 'history' ? (
            <div className="ml-cleanup-bulk-actions">
              <IndeterminateCheckbox
                checked={pageFullySelected}
                indeterminate={pagePartiallySelected}
                disabled={busy}
                label="选择本页全部影片文件"
                onChange={togglePage}
              />
              <span>本页全选</span>
              <small>第 {page.page} / {page.totalPages} 页，共 {page.totalItems} 部影片</small>
            </div>
          ) : null}
          <div className="ml-cleanup-card-grid">
            {page.items.map((group) => (
              <CleanupTitleCard
                key={group.item.titleId}
                group={group}
                selectedKeys={selectedKeys}
                busy={busy}
                history={tab === 'history'}
                onToggleTitle={toggleTitle}
                onToggleCopy={toggleSelected}
              />
            ))}
          </div>
          <div className="ml-cleanup-pagination" aria-label="已看影片整理分页">
            <button
              type="button"
              className="ml-cleanup-page-btn"
              disabled={page.page <= 1}
              title="上一页"
              aria-label="上一页"
              onClick={() => setPageNumber(page.page - 1)}
            >&lt;</button>
            <span>第 {page.page} / {page.totalPages} 页</span>
            <button
              type="button"
              className="ml-cleanup-page-btn"
              disabled={page.page >= page.totalPages}
              title="下一页"
              aria-label="下一页"
              onClick={() => setPageNumber(page.page + 1)}
            >&gt;</button>
          </div>
        </>
      )}

      {tab !== 'history' ? (
        <div className="ml-cleanup-footer">
          <span>已选择 {selectedTitleCount} 部影片 / {selected.length} 个文件</span>
          <div>
            <Button variant="secondary" disabled={busy || selected.length === 0} onClick={() => setSelectedKeys(new Set())}>
              清空选择
            </Button>
            <Button disabled={busy || selected.length === 0} onClick={() => setConfirming(true)}>
              删除选中的文件
            </Button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div className="ml-cleanup-confirm" role="alertdialog" aria-modal="true" aria-labelledby="cleanup-confirm-title">
          <div className="ml-cleanup-confirm-body">
            <h3 id="cleanup-confirm-title">确认删除 {selected.length} 个文件？</h3>
            <p>本次会处理 {selectedTitleCount} 部影片：{selectedSourceSummary.join('；')}。</p>
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
