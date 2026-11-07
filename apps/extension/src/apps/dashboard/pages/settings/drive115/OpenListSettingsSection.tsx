import { useEffect, useState } from 'react';
import { listTools, testConnection } from '../../../../../features/openlist/openlistClient';
import {
  DEFAULT_OPENLIST_SETTINGS,
  normalizeOpenListSettings,
  saveOpenListSettings,
  type OpenListSettings,
} from '../../../../../features/openlist/openlistSettingsModel';
import { getSettings } from '../../../../../utils/storage';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';

const COMMON_TOOLS = [
  ['aria2', 'Aria2'],
  ['qbittorrent', 'qBittorrent'],
  ['transmission', 'Transmission'],
  ['SimpleHttp', 'SimpleHttp'],
] as const;

type ToolCheck = { status: 'idle' | 'loading' | 'ready' | 'error'; tools: string[] };

function uniqueTools(tools: readonly string[]): string[] {
  const names = new Map<string, string>();
  for (const tool of tools) {
    const value = tool.trim();
    if (value && !names.has(value.toLowerCase())) names.set(value.toLowerCase(), value);
  }
  return [...names.values()];
}

function toolLabel(tool: string): string {
  return COMMON_TOOLS.find(([value]) => value.toLowerCase() === tool.toLowerCase())?.[1] ?? tool;
}

const FIELD_HELP: Record<'baseUrl' | 'token' | 'path' | 'tool', string> = {
  baseUrl: '填写浏览器访问 OpenList 的完整地址，例如 https://openlist.example.com；不要填写 /api 路径。',
  token: '在 OpenList 的个人资料或用户设置中复制 API 令牌；这里不是登录密码，请勿将令牌发给他人。',
  path: '填写 OpenList 中已存在且有写入权限的目录，例如 /115；不是电脑上的本地路径。',
  tool: '选择当前目录支持的离线下载工具。工具需先在 OpenList 服务端配置；连接后会显示当前路径的可用项。推送磁链还需下载器本身支持磁链。',
};

export function OpenListSettingsSection() {
  const [form, setForm] = useState<OpenListSettings>(DEFAULT_OPENLIST_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [toolCheck, setToolCheck] = useState<ToolCheck>({ status: 'idle', tools: [] });
  const [refreshTools, setRefreshTools] = useState(0);
  const configured = normalizeOpenListSettings(form);
  const availableTools = toolCheck.status === 'ready' ? toolCheck.tools : null;
  const selectedTool = availableTools?.find(tool => tool.toLowerCase() === form.tool.toLowerCase()) ?? form.tool;
  const toolOptions = uniqueTools([...(availableTools ?? COMMON_TOOLS.map(([value]) => value)), selectedTool]);
  const onlyHttp = availableTools?.length === 1 && availableTools[0].toLowerCase() === 'simplehttp';

  useEffect(() => {
    let active = true;
    void getSettings().then((settings) => {
      if (active) setForm(normalizeOpenListSettings(settings.openlist));
    }).catch(() => {
      if (active) setFeedback('读取 OpenList 设置失败');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!configured.baseUrl) { setToolCheck({ status: 'idle', tools: [] }); return; }
    let active = true;
    setToolCheck({ status: 'loading', tools: [] });
    const timer = window.setTimeout(() => {
      void listTools({ baseUrl: configured.baseUrl, path: configured.path }).then((result) => {
        if (active) setToolCheck(result.success
          ? { status: 'ready', tools: uniqueTools(result.tools ?? []) }
          : { status: 'error', tools: [] });
      }).catch(() => { if (active) setToolCheck({ status: 'error', tools: [] }); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [configured.baseUrl, configured.path, refreshTools]);

  const change = (field: keyof OpenListSettings, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback('');
  };
  const run = async (test: boolean) => {
    const current = normalizeOpenListSettings({ ...form, tool: selectedTool });
    if (!current.baseUrl || (test && !current.token)) {
      setFeedback('请填写有效的服务器地址和令牌');
      return;
    }
    setBusy(true);
    try {
      if (test) {
        const result = await testConnection({ baseUrl: current.baseUrl, token: current.token });
        setFeedback(result.ok ? `连接成功 · ${result.version || 'OpenList'} · ${result.username || '已验证'}` : result.message || '连接失败');
        if (result.ok) setRefreshTools(value => value + 1);
        if (!result.ok) console.error('[OpenList] 测试连接失败', {
          stage: result.diagnostics?.stage ?? 'connection',
          httpStatus: result.diagnostics?.httpStatus,
          apiCode: result.diagnostics?.apiCode,
          contentType: result.diagnostics?.contentType,
        });
      } else {
        await saveOpenListSettings(current);
        setForm(current);
        setFeedback('设置已保存');
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '操作失败');
      if (test) console.error('[OpenList] 测试连接异常', { type: error instanceof Error ? error.name : 'unknown' });
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
      ] as const).map(([field, label, type]) => (
        <div className="form-group" key={field}>
          <div className="flex items-center gap-2 mb-1.5">
            <label htmlFor={`openlist${field[0].toUpperCase()}${field.slice(1)}`}>{label}</label>
            <span className="relative group inline-flex">
              <button type="button" className="text-[var(--color-fg-muted)]" aria-label={`${label}填写帮助`} title={FIELD_HELP[field]}>
                <i className="fas fa-circle-question" aria-hidden="true" />
              </button>
              <span role="tooltip" className="hidden group-hover:block group-focus-within:block absolute bottom-full left-0 z-20 w-64 max-w-[80vw] mb-2 p-2 text-xs leading-relaxed text-white bg-neutral-800 shadow-lg rounded">{FIELD_HELP[field]}</span>
            </span>
          </div>
          <Input
            id={`openlist${field[0].toUpperCase()}${field.slice(1)}`}
            type={type}
            value={form[field]}
            onChange={(event) => change(field, event.currentTarget.value)}
            autoComplete={field === 'token' ? 'off' : undefined}
            placeholder={field === 'baseUrl' ? 'https://openlist.example.com' : field === 'path' ? '/115' : '从 OpenList 个人资料中获取'}
          />
        </div>
      ))}
      <div className="form-group">
        <div className="flex items-center gap-2 mb-1.5">
          <label htmlFor="openlistTool">默认下载器</label>
          <span className="relative group inline-flex">
            <button type="button" className="text-[var(--color-fg-muted)]" aria-label="默认下载器填写帮助" title={FIELD_HELP.tool}>
              <i className="fas fa-circle-question" aria-hidden="true" />
            </button>
            <span role="tooltip" className="hidden group-hover:block group-focus-within:block absolute bottom-full left-0 z-20 w-64 max-w-[80vw] mb-2 p-2 text-xs leading-relaxed text-white bg-neutral-800 shadow-lg rounded">{FIELD_HELP.tool}</span>
          </span>
        </div>
        <select id="openlistTool" className="w-full min-h-9 border rounded bg-[var(--input-bg)] text-[var(--text-primary)]" value={selectedTool} disabled={toolCheck.status !== 'ready'} onChange={(event) => change('tool', event.currentTarget.value)} aria-describedby="openlistToolStatus openlistToolHelp">
          {toolOptions.map((tool) => {
            const label = tool.toLowerCase() === 'simplehttp' ? 'SimpleHttp（仅 HTTP，不支持磁链）' : toolLabel(tool);
            const supported = availableTools === null || availableTools.includes(tool);
            return <option key={tool.toLowerCase()} value={tool} disabled={!supported}>{label}{supported ? '' : '（尚未提供）'}</option>;
          })}
        </select>
        <p id="openlistToolStatus" role="status" className="text-xs text-[var(--color-fg-muted)] mt-2">
          {toolCheck.status === 'idle' && '填写有效的服务器地址后检测可用下载器。'}
          {toolCheck.status === 'loading' && '正在检测当前目录的可用下载器…'}
          {toolCheck.status === 'error' && '下载器检测失败，请检查 OpenList 地址与网络后重新检测。'}
          {toolCheck.status === 'ready' && (toolCheck.tools.length
            ? `当前目录可用：${toolCheck.tools.map(toolLabel).join('、')}`
            : '当前目录未返回可用下载器，请先检查 OpenList 的离线下载配置。')}
        </p>
        {onlyHttp && <p className="text-xs text-[var(--color-fg-muted)] mt-1">目前只有 HTTP 下载器，磁链暂不可用。</p>}
        {availableTools !== null && !availableTools.includes(selectedTool) && <p className="text-xs text-[var(--color-fg-muted)] mt-1">已保存的 {toolLabel(selectedTool)} 尚未由服务器提供，请先完成配置或选择其他可用下载器。</p>}
        <p id="openlistToolHelp" className="text-xs text-[var(--color-fg-muted)] mt-2 leading-relaxed">
          要使用 Aria2、qBittorrent 或 Transmission，请先启动对应下载器，并在 OpenList 管理后台的离线下载设置中配置连接地址及认证信息。保存后回到这里重新检测，服务器返回该下载器时即可选择；目标目录也需要有写入权限。
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <Button id="openlistRefreshTools" size="sm" variant="secondary" disabled={!configured.baseUrl || toolCheck.status === 'loading'} onClick={() => setRefreshTools(value => value + 1)}>重新检测下载器</Button>
          {configured.baseUrl && <a id="openlistOpenServer" href={configured.baseUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-primary)] underline">打开 OpenList 配置</a>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button id="openlistSave" type="button" size="sm" disabled={busy} onClick={() => void run(false)}>保存设置</Button>
        <Button id="openlistTest" type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(true)}>测试连接</Button>
        {feedback && <span role="status" className="text-[12px] text-[var(--color-fg-muted)]">{feedback}</span>}
      </div>
    </div>
  );
}
