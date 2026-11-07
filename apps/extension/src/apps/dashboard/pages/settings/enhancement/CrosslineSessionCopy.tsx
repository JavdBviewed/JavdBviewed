import { useState } from 'react';
import type { CrosslineSessionStatus } from '../../../../../shared/protocols/crosslineSession';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Modal } from '../../../../../ui/primitives/Modal/Modal';

/** 手动选定来源和目标；只有确认动作才请求覆盖。 */
export function CrosslineSessionCopy({ status, busy, onCopy }: {
  status: CrosslineSessionStatus;
  busy: boolean;
  onCopy: (source: string, target: string) => Promise<void>;
}) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const routes = status.routes.filter(route => !['disabled', 'unsupported'].includes(route.status));
  const sources = routes.filter(route => ['present', 'synced', 'conflict'].includes(route.status));
  const valid = status.reason !== 'multiple-stores' && sources.some(route => route.host === source) &&
    routes.some(route => route.host === target) && target !== source;
  return (
    <div className="mt-3 space-y-2">
      <p className="m-0">选择你已登录的网站作为来源，再选择要同步到的网站。无需退出或重新登录。</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1" htmlFor="crosslineSource">已登录的网站
          <SettingSelect id="crosslineSource" value={source} disabled={busy} onChange={value => { setSource(value); setTarget(''); }}
            options={[{ value: '', label: '请选择来源' }, ...sources.map(route => ({ value: route.host, label: route.host }))]} />
        </label>
        <label className="flex min-w-0 flex-col gap-1" htmlFor="crosslineTarget">同步到
          <SettingSelect id="crosslineTarget" value={target} disabled={busy || !source} onChange={setTarget}
            options={[{ value: '', label: '请选择目标' }, ...routes.filter(route => route.host !== source).map(route => ({ value: route.host, label: route.host }))]} />
        </label>
        <Button id="crosslineCopy" size="sm" disabled={busy || !valid} onClick={() => setConfirming(true)}>使用此站登录态</Button>
      </div>
      <Modal open={confirming} title="确认同步登录态" onClose={() => { if (!busy) setConfirming(false); }} footer={<>
        <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>取消</Button>
        <Button id="crosslineConfirmCopy" disabled={busy || !valid} onClick={() => {
          setConfirming(false);
          void onCopy(source, target);
        }}>确认替换并同步</Button>
      </>}>
        <p>将使用 <strong>{source}</strong> 保存的登录信息，替换 <strong>{target}</strong> 的现有会话。</p>
        <p>如果目标网站登录着其他账号，将改用来源账号。请先通过“打开网站查看账号”确认来源；完成后刷新目标网站检查是否已登录。</p>
      </Modal>
    </div>
  );
}
