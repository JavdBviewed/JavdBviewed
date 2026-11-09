/**
 * @file MediaServerLibraryPicker.tsx
 * @description 当前服务器草稿的库列表与选中范围，失败/迟到响应不覆盖选择
 * @module apps/dashboard/pages/settings/emby
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import type {
  EmbyLibraryFolderOption,
  EmbyMediaServer,
} from '../../../../../features/embyLibrary/types';
import type { listEmbyLibraries } from './embySettingsActions';

export function MediaServerLibraryPicker({
  server,
  specific,
  onSpecificChange,
  onChange,
  disabled,
  load,
}: {
  server: EmbyMediaServer;
  specific: boolean;
  onSpecificChange: (specific: boolean) => void;
  onChange: (patch: Partial<EmbyMediaServer>) => void;
  disabled?: boolean;
  load: typeof listEmbyLibraries;
}) {
  const [state, setState] = useState<{
    kind: 'idle' | 'loading' | 'success' | 'error';
    error?: string;
    options: EmbyLibraryFolderOption[];
  }>({ kind: 'idle', options: server.libraryOptions || [] });
  const signature = JSON.stringify([
    server.type,
    server.url,
    server.apiKey,
    server.accessToken,
    server.userId,
    server.username,
    server.password,
  ]);
  const request = useRef(0);
  const identity = useRef(signature);
  if (identity.current !== signature) {
    identity.current = signature;
    request.current++;
  }
  useEffect(() => {
    setState({ kind: 'idle', options: [] });
  }, [signature]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const refresh = async () => {
    const id = ++request.current;
    setState((previous) => ({
      ...previous,
      kind: 'loading',
      error: undefined,
    }));
    try {
      const result = await load(server);
      if (id !== request.current) return;
      if (!result.ok) {
        setState((previous) => ({
          ...previous,
          kind: 'error',
          error: result.error,
        }));
        return;
      }
      setState({ kind: 'success', options: result.libraries });
      onChange({ libraryOptions: result.libraries });
    } catch {
      if (id === request.current)
        setState((previous) => ({
          ...previous,
          kind: 'error',
          error: '读取媒体库失败，请重试',
        }));
    }
  };
  const selected = server.libraryIds || [];
  const currentIds = new Set(state.options.map((option) => option.id));
  const missing = selected
    .filter((id) => !currentIds.has(id))
    .map((id) => ({
      id,
      name:
        server.libraryOptions?.find((option) => option.id === id)?.name || id,
    }));
  const options: EmbyLibraryFolderOption[] = [...state.options, ...missing];
  const canRead = Boolean(
    server.url.trim() && (server.apiKey.trim() || server.accessToken),
  );
  const toggle = (id: string, checked: boolean) =>
    onChange({
      libraryIds: checked
        ? [...new Set([...selected, id])]
        : selected.filter((value) => value !== id),
    });
  return (
    <div className="emby-library-scope">
      <div className="emby-scope-modes" role="radiogroup" aria-label="同步范围">
        <div className={!specific ? 'is-selected' : ''}>
          <label>
            <input
              type="radio"
              name={`scope-${server.id}`}
              checked={!specific}
              disabled={disabled}
              onChange={() => onSpecificChange(false)}
            />
            全部媒体库
          </label>
          <small>包含以后新增的库</small>
        </div>
        <div className={specific ? 'is-selected' : ''}>
          <label>
            <input
              type="radio"
              name={`scope-${server.id}`}
              checked={specific}
              disabled={disabled}
              onChange={() => onSpecificChange(true)}
            />
            指定媒体库
          </label>
          <small>只同步下方选中的库</small>
        </div>
      </div>
      <div className="emby-library-toolbar">
        <span>
          {specific ? `已选择 ${selected.length} 个库` : '当前范围：全部媒体库'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !canRead || state.kind === 'loading'}
          onClick={() => void refresh()}
        >
          {state.kind === 'loading'
            ? '读取中…'
            : state.kind === 'success'
              ? '刷新列表'
              : '读取媒体库'}
        </Button>
      </div>
      {!canRead ? (
        <p className="emby-dialog-help">
          填写服务器地址和 API Key，或先登录用户，再读取可访问的媒体库。
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="emby-dialog-error" role="alert" data-library-error>
          {state.error}。已选范围未改变。
        </p>
      ) : null}
      {state.kind === 'success' ? (
        <p className="emby-dialog-help" role="status">
          {state.options.length
            ? `连接成功，可读取 ${state.options.length} 个媒体库`
            : '服务器没有返回可选媒体库，请检查账号权限或在服务器中创建媒体库。'}
        </p>
      ) : null}
      {specific && options.length ? (
        <div className="emby-library-options" aria-label="媒体库列表">
          {options.map((option) => (
            <label key={option.id} className="emby-library-option">
              <input
                type="checkbox"
                data-library-id={option.id}
                checked={selected.includes(option.id)}
                disabled={disabled}
                onChange={(e) => toggle(option.id, e.currentTarget.checked)}
              />
              <span>
                <strong>{option.name}</strong>
                {!currentIds.has(option.id) ? (
                  <small>
                    {state.kind === 'success'
                      ? '当前列表未返回，保留原选择；取消勾选后移除'
                      : '已保存的选择，读取列表后核对'}
                  </small>
                ) : null}
              </span>
              {option.collectionType ? (
                <small className="emby-library-kind">
                  {(
                    {
                      movies: '电影',
                      tvshows: '电视剧',
                      music: '音乐',
                      mixed: '混合',
                    } as Record<string, string>
                  )[option.collectionType] || option.collectionType}
                </small>
              ) : null}
            </label>
          ))}
        </div>
      ) : null}
      <p className="emby-dialog-help">
        目前只索引所选库中的电影条目。调整范围不会删除服务器文件。
      </p>
    </div>
  );
}
