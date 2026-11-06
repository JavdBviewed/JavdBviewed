import { useEffect, useState } from 'react';
import { testConnection } from '../../../../../features/openlist/openlistClient';
import {
  DEFAULT_OPENLIST_SETTINGS,
  normalizeOpenListSettings,
  saveOpenListSettings,
  type OpenListSettings,
} from '../../../../../features/openlist/openlistSettingsModel';
import { getSettings } from '../../../../../utils/storage';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';

export function OpenListSettingsSection() {
  const [form, setForm] = useState<OpenListSettings>(DEFAULT_OPENLIST_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    void getSettings().then((settings) => {
      if (active) setForm(normalizeOpenListSettings(settings.openlist));
    }).catch(() => {
      if (active) setFeedback('读取 OpenList 设置失败');
    });
    return () => { active = false; };
  }, []);

  const change = (field: keyof OpenListSettings, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback('');
  };
  const run = async (test: boolean) => {
    const current = normalizeOpenListSettings(form);
    if (!current.baseUrl || (test && !current.token)) {
      setFeedback('请填写有效的服务器地址和令牌');
      return;
    }
    setBusy(true);
    try {
      if (test) {
        const result = await testConnection({ baseUrl: current.baseUrl, token: current.token });
        setFeedback(result.ok ? `连接成功 · ${result.version || 'OpenList'} · ${result.username || '已验证'}` : result.message || '连接失败');
      } else {
        await saveOpenListSettings(current);
        setForm(current);
        setFeedback('设置已保存');
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      {([
        ['baseUrl', '服务器地址', 'url'],
        ['token', '访问令牌', 'password'],
        ['path', '目标目录', 'text'],
        ['tool', '默认下载器', 'text'],
      ] as const).map(([field, label, type]) => (
        <div className="form-group" key={field}>
          <label htmlFor={`openlist${field[0].toUpperCase()}${field.slice(1)}`}>{label}</label>
          <Input
            id={`openlist${field[0].toUpperCase()}${field.slice(1)}`}
            type={type}
            value={form[field]}
            onChange={(event) => change(field, event.currentTarget.value)}
            autoComplete={field === 'token' ? 'off' : undefined}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button id="openlistSave" type="button" size="sm" disabled={busy} onClick={() => void run(false)}>保存设置</Button>
        <Button id="openlistTest" type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(true)}>测试连接</Button>
        {feedback && <span role="status" className="text-[12px] text-[var(--color-fg-muted)]">{feedback}</span>}
      </div>
    </div>
  );
}
