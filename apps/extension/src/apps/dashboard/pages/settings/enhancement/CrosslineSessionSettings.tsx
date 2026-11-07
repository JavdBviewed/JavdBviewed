import { useEffect, useRef, useState } from 'react';
import { sendRuntimeMessage } from '../../../../../platform/browser/runtimeMessages';
import type { CrosslineSessionStatus, CrosslineRouteStatus, CrosslineSessionRequest, CrosslineSessionResponse } from '../../../../../shared/protocols/crosslineSession';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';

import { SettingSection } from './_shared';
import { CrosslineSessionCopy } from './CrosslineSessionCopy';

const LABELS: Record<CrosslineRouteStatus, string> = {
  disabled: '线路未启用',
  unsupported: '此线路尚未验证，暂不支持同步',
  error: '写入失败',
  missing: '未找到会话',
  present: '已找到会话',
  synced: '本次已补齐',
  conflict: '保存的信息不同，尚未同步',
};

const REASONS: Record<CrosslineSessionStatus['reason'], string> = {
  ready: '已读取当前浏览器的会话。',
  'no-session': '已启用的线路中未找到可用会话，请确认登录的浏览器与当前扩展使用同一配置文件。',
  'different-sessions': '这些网站保存的会话信息不同，可能只是未登录时留下的信息，并不一定是不同账号。请在下方选择已登录的网站作为来源，手动同步到目标网站。',
  'multiple-stores': '检测到多个浏览器 cookie 存储空间；手动刷新无法安全选择单一来源，请在当前浏览器窗口检查登录状态。',
};

export function CrosslineSessionSettings() {
  const [status, setStatus] = useState<CrosslineSessionStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const operationId = useRef(0);
  const inFlight = useRef(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const id = ++operationId.current;
    void sendRuntimeMessage<CrosslineSessionResponse>({ type: 'JAVDB_CROSSLINE:STATUS' })
      .then(result => {
        if (!active || id !== operationId.current) return;
        if (result?.success) setStatus(result.status);
        else setError(result?.error || '无法读取登录态');
      })
      .catch(() => { if (active && id === operationId.current) setError('后台无响应，请重新加载扩展后重试'); })
      .finally(() => { if (active && id === operationId.current) { inFlight.current = false; setBusy(false); } });
    return () => { active = false; operationId.current++; };
  }, []);

  const run = async (message: CrosslineSessionRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const id = ++operationId.current;
    setBusy(true);
    setError('');
    try {
      const result = await sendRuntimeMessage<CrosslineSessionResponse>(message);
      if (id !== operationId.current) return;
      if (!result?.success) {
        setError(result?.error || '操作失败，请重试');
        return;
      }
      setStatus(result.status);
    } catch {
      if (id === operationId.current) setError('后台无响应，请重新加载扩展后重试');
    } finally {
      if (id === operationId.current) { inFlight.current = false; setBusy(false); }
    }
  };

  return (
    <SettingSection
      title="跨线路登录态"
      description="读取本浏览器已有的会话，无需退出再登录。自动同步仅覆盖已启用的主站、570 和 575 线路。"
    >
      <SettingToggleRow
        id="crosslineEnabled"
        label="自动同步登录态"
        description="关闭后不再自动同步或联动退出；仍可查看状态和手动同步。"
        checked={status?.enabled ?? true}
        disabled={!status || busy}
        onChange={enabled => void run({ type: 'JAVDB_CROSSLINE:SET_ENABLED', enabled })}
      />
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
        <Button id="crosslineRefresh" size="sm" variant="secondary" type="button" disabled={busy} onClick={() => void run({ type: 'JAVDB_CROSSLINE:REFRESH' })}>
          <i className="fas fa-sync-alt" aria-hidden="true" />{' '}{busy ? '读取中…' : '获取或刷新当前登录态'}
        </Button>
        <a className="text-[13px] text-[var(--color-primary)] hover:underline" href="#tab-settings/network-test-settings">
          线路管理 <i className="fas fa-arrow-right" aria-hidden="true" />
        </a>
      </div>
      {error ? <p role="alert" className="px-2 text-[13px] text-[var(--color-danger)]">{error}{status ? ' 以下为上次读取结果，尚未更新。' : ''}</p> : null}
      {status ? (
        <div aria-live="polite" className="px-2 pb-2 text-[13px]">
          <p className="m-0 text-[12px] text-[var(--color-fg-muted)]">最近检查：{new Date(status.checkedAt).toLocaleString()}</p>
          {status.error ? <p role="alert" className="text-[var(--color-danger)]">{status.error.message}</p> : null}
          <p className="mb-2 text-[var(--color-fg-muted)]">{status.enabled ? REASONS[status.reason] : '自动同步已关闭。仅显示当前浏览器的会话状态。'}</p>
          <ul className="m-0 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] p-0">
            {status.routes.map(route => (
              <li key={route.host} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{route.host}</span><span className="text-[var(--color-fg-muted)]">{LABELS[route.status]}</span>
                <a href={`https://${route.host}/`} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline" aria-label={`打开 ${route.host} 查看账号`}>打开网站查看账号</a>
              </li>
            ))}
          </ul>
          <CrosslineSessionCopy status={status} busy={busy} onCopy={(sourceHost, targetHost) => run({ type: 'JAVDB_CROSSLINE:COPY', sourceHost, targetHost })} />
          <p className="mt-2 text-[12px] text-[var(--color-fg-muted)]">检测到会话不代表账号已登录：未登录时，网站也会保存浏览信息。点击“打开网站查看账号”，在网站右上角查看是否显示你的账号；同步后刷新目标网站。</p>
        </div>
      ) : null}
    </SettingSection>
  );
}
