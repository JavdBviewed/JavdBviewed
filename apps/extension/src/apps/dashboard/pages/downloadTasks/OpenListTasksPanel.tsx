import { useCallback, useEffect, useRef, useState } from 'react';
import { getSettings } from '../../../../utils/storage';
import { normalizeOpenListSettings, type OpenListSettings } from '../../../../features/openlist/openlistSettingsModel';
import { listOpenListTasks, operateOpenListTask, OPENLIST_TASK_KINDS, OPENLIST_TASK_STATES, type OpenListDownloadTask } from '../../../../features/openlist/openlistTasksClient';
import { Button } from '../../../../ui/primitives/Button/Button';
import { SettingSelect } from '../../../../ui/patterns/SettingSelect/SettingSelect';
import { Input } from '../../../../ui/primitives/Input/Input';
import { Modal } from '../../../../ui/primitives/Modal/Modal';

const PAGE_SIZE = 20;
const failed = (task: OpenListDownloadTask) => task.state !== undefined && [5, 6, 7].includes(task.state);
const terminal = (task: OpenListDownloadTask) => task.state !== undefined && [2, 4, 7].includes(task.state);

export function OpenListTasksPanel() {
  const [tasks, setTasks] = useState<OpenListDownloadTask[]>([]);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [cancelTask, setCancelTask] = useState<OpenListDownloadTask>();
  const settingsRef = useRef<OpenListSettings | undefined>(undefined);
  const active = useRef(false);
  const inFlight = useRef(false);
  const request = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (inFlight.current || !active.current) return;
    inFlight.current = true;
    setBusy(true);
    const controller = new AbortController(); request.current = controller;
    try {
      const settings = normalizeOpenListSettings((await getSettings()).openlist);
      if (!active.current) return;
      if (settingsRef.current && (settings.baseUrl !== settingsRef.current.baseUrl || settings.token !== settingsRef.current.token)) {
        setTasks([]); setCheckedAt(undefined); setCancelTask(undefined);
      }
      settingsRef.current = settings;
      setConfigured(Boolean(settings.baseUrl && settings.token));
      if (!settings.baseUrl || !settings.token) { setTasks([]); setError(''); return; }
      const result = await listOpenListTasks(settings, { signal: controller.signal });
      if (!active.current || controller.signal.aborted) return;
      setTasks(result.tasks); setError(result.errors.join('\n')); setCheckedAt(Date.now());
    } catch (reason) {
      if (active.current && !controller.signal.aborted) setError(`刷新失败，已有列表为上次读取结果。${reason instanceof Error ? reason.message : '请检查网络后重试。'}`);
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => { active.current = false; request.current?.abort(); window.clearInterval(timer); };
  }, [refresh]);

  const operate = async (task: OpenListDownloadTask, action: 'cancel' | 'retry') => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller;
    let succeeded = false;
    try {
      const settings = normalizeOpenListSettings((await getSettings()).openlist);
      if (!active.current) return;
      if (settings.baseUrl !== settingsRef.current?.baseUrl || settings.token !== settingsRef.current?.token) {
        setTasks([]); setCheckedAt(undefined);
        throw new Error('OpenList 设置已更改，请刷新列表后再操作。');
      }
      await operateOpenListTask(settings, task, action, { signal: controller.signal });
      succeeded = true;
    } catch (reason) {
      if (active.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : '任务操作失败，请重试。');
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
    if (succeeded && active.current) await refresh();
  };

  const filtered = tasks.filter(task => (task.name ?? '').toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
    (filter === 'all' || (filter === 'active' && !terminal(task)) || (filter === 'done' && task.state === 2) || (filter === 'failed' && failed(task))));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  return (
    <section aria-label="OpenList 下载任务" className="mt-4 space-y-4 text-[var(--color-fg)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h4 className="m-0 text-base font-semibold">OpenList 下载任务</h4>
          <p className="mb-0 mt-1 text-sm text-[var(--color-fg-muted)]">下载与转存分别显示；转存完成后，文件才会出现在目标目录。</p></div>
        <a href="#tab-settings/drive-settings/openlist" className="text-sm text-[var(--color-primary)] hover:underline">OpenList 设置</a>
      </div>
      {!configured ? <p role="status">请先填写 OpenList 服务器地址和访问令牌，然后返回查看任务。</p> : <>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-sm" aria-label="搜索 OpenList 任务" placeholder="搜索任务名称…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
          <SettingSelect className="max-w-[160px]" aria-label="OpenList 任务状态" value={filter} onChange={value => { setFilter(value); setPage(1); }} options={[
            { value: 'all', label: '全部状态' }, { value: 'active', label: '未完成' }, { value: 'done', label: '已完成' }, { value: 'failed', label: '出错或失败' },
          ]} />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? '读取中…' : '刷新列表'}</Button>
          <span className="text-sm text-[var(--color-fg-muted)]">共 {filtered.length} 项</span>
        </div>
        {checkedAt ? <p className="text-xs text-[var(--color-fg-muted)]">最近刷新：{new Date(checkedAt).toLocaleTimeString()} · 本页可见时每 5 秒刷新</p> : null}
        {error ? <p role="alert" className="whitespace-pre-line text-sm text-[var(--color-danger)]">{error}</p> : null}
        {!busy && !filtered.length && !error ? <p role="status">{tasks.length ? '没有符合条件的任务。' : '暂无下载任务。影片页推送到 OpenList 后可在这里查看。'}</p> : null}
        <ul className="m-0 list-none space-y-3 p-0">
          {filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(task => <li key={`${task.kind}:${task.id}`} className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1 break-words"><strong className="text-sm">{task.name}</strong>
                <p className="mb-1 mt-1 text-xs text-[var(--color-fg-muted)]">{OPENLIST_TASK_KINDS[task.kind]} · {OPENLIST_TASK_STATES[task.state ?? -1] ?? '未知状态'}</p></div>
              <div className="flex gap-2">
                {task.state === 4 || task.state === 7 ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void operate(task, 'retry')}>重试</Button> : null}
                {task.state !== undefined && [0, 1, 5, 8, 9].includes(task.state) ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => setCancelTask(task)}>取消任务</Button> : null}
              </div>
            </div>
            {task.progress !== undefined ? <div className="flex items-center gap-2"><progress className="h-2 min-w-0 flex-1" aria-label={`${task.name}进度`} max={100} value={task.progress} /><span className="text-xs">{Math.round(task.progress * 10) / 10}%</span></div> : null}
            {task.status ? <p className="mb-0 break-words text-xs text-[var(--color-fg-muted)]">{task.status}</p> : null}
            {task.error ? <p className="mb-0 break-words text-xs text-[var(--color-danger)]">{task.error}</p> : null}
          </li>)}
        </ul>
        {pages > 1 ? <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</Button>
          <span className="text-sm">{currentPage} / {pages}</span>
          <Button size="sm" variant="secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</Button>
        </div> : null}
      </>}
      <Modal open={Boolean(cancelTask)} title="取消 OpenList 任务" onClose={() => setCancelTask(undefined)} footer={<>
        <Button variant="secondary" onClick={() => setCancelTask(undefined)}>保留任务</Button>
        <Button disabled={busy} onClick={() => { const task = cancelTask; setCancelTask(undefined); if (task) void operate(task, 'cancel'); }}>确认取消</Button>
      </>}><p>取消“{cancelTask?.name}”的{cancelTask ? OPENLIST_TASK_KINDS[cancelTask.kind] : ''}任务？</p></Modal>
    </section>
  );
}
