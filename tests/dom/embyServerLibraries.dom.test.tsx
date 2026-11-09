import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MediaServerCreateDialog,
  MediaServerEditDialog,
} from '../../apps/extension/src/apps/dashboard/pages/settings/emby/EmbySettingsPage';
import type { EmbyMediaServer } from '../../apps/extension/src/features/embyLibrary/types';

const actions = vi.hoisted(() => ({
  listEmbyLibraries: vi.fn(),
  loginEmbyUser: vi.fn(),
  toast: vi.fn(),
}));
vi.mock(
  '../../apps/extension/src/apps/dashboard/pages/settings/emby/embySettingsActions',
  async (original) => ({
    ...(await original<object>()),
    ...actions,
  }),
);
const initial: EmbyMediaServer = {
  id: 's1',
  type: 'emby',
  name: '家庭库',
  url: 'http://media.test',
  apiKey: 'synthetic-key',
  enabled: true,
};
let root: Root;
let saved: EmbyMediaServer | undefined;
let saveResult = { ok: true, error: '' };
let closed = false;
function Harness({
  edit = false,
  server = initial,
}: {
  edit?: boolean;
  server?: EmbyMediaServer;
}) {
  const [draft, setDraft] = useState(server);
  const [open, setOpen] = useState(true);
  const close = () => {
    closed = true;
    setOpen(false);
  };
  const save = async (next: EmbyMediaServer) => {
    saved = next;
    return saveResult;
  };
  return edit ? (
    <MediaServerEditDialog
      server={open ? server : null}
      index={0}
      onSave={(_index, value) => save(value)}
      onClose={close}
      onRemove={() => {}}
    />
  ) : (
    <MediaServerCreateDialog
      draft={open ? draft : null}
      onChange={setDraft}
      onConfirm={save}
      onCancel={close}
    />
  );
}
async function click(text: string) {
  const node = Array.from(document.querySelectorAll('button, label')).find(
    (n) => n.textContent?.trim() === text,
  );
  expect(node, text).toBeTruthy();
  await act(async () => (node as HTMLElement).click());
}
function input(suffix: string, value: string) {
  const node = document.querySelector<HTMLInputElement>(
    `input[id$="-${suffix}"]`,
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(edit = false, server = initial) {
  await act(async () => root.render(<Harness edit={edit} server={server} />));
}
function checkbox(id: string) {
  return document.querySelector<HTMLInputElement>(
    `input[data-library-id="${id}"]`,
  )!;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="test-root"></div>';
  root = createRoot(document.getElementById('test-root')!);
  saved = undefined;
  closed = false;
  saveResult = { ok: true, error: '' };
  vi.clearAllMocks();
  actions.listEmbyLibraries.mockResolvedValue({
    ok: true,
    libraries: [
      { id: 'movies', name: '电影', collectionType: 'movies' },
      { id: 'family', name: '家庭录像' },
    ],
  });
  actions.loginEmbyUser.mockResolvedValue({
    ok: true,
    accessToken: 'synthetic-token',
    userId: 'u1',
    username: 'demo',
    tokenObtainedAt: 1,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('媒体服务器选库与草稿保存', () => {
  it('新增可登录后读库，只保存选中的库', async () => {
    await mount(false, {
      ...initial,
      apiKey: '',
      username: 'demo',
      password: 'synthetic-password',
    });
    await click('登录验证');
    expect(document.body.textContent).toContain('已登录');
    await click('指定媒体库');
    await click('读取媒体库');
    await act(async () => checkbox('movies').click());
    await click('添加服务器');
    expect(saved).toMatchObject({
      libraryIds: ['movies'],
      accessToken: 'synthetic-token',
      userId: 'u1',
    });
    expect(closed).toBe(true);
  });
  it('指定模式空选不可保存，不能隐式变全库', async () => {
    await mount();
    await click('指定媒体库');
    await click('添加服务器');
    expect(saved).toBeUndefined();
    expect(document.body.textContent).toContain('请至少选择一个媒体库');
    await click('全部媒体库');
    await click('添加服务器');
    expect(saved?.libraryIds ?? []).toEqual([]);
  });
  it('编辑只改草稿，取消保留原配置', async () => {
    await mount(true);
    input('name', '改后名称');
    input('url', 'http://other.test');
    expect(saved).toBeUndefined();
    await click('取消');
    expect(saved).toBeUndefined();
    expect(initial.url).toBe('http://media.test');
  });
  it('保存失败保留草稿，再保存成功才关闭', async () => {
    await mount(true);
    input('name', '我的电影');
    saveResult = { ok: false, error: '保存失败，请重试' };
    await click('保存修改');
    expect(closed).toBe(false);
    expect(document.body.textContent).toContain('保存失败，请重试');
    expect(
      document.querySelector<HTMLInputElement>('input[id$="-name"]')?.value,
    ).toBe('我的电影');
    saveResult = { ok: true, error: '' };
    await click('保存修改');
    expect(saved?.name).toBe('我的电影');
    expect(closed).toBe(true);
  });
  it('读取失败不清空已有库；不可见ID明确保留', async () => {
    await mount(true, { ...initial, libraryIds: ['offline'] });
    actions.listEmbyLibraries.mockResolvedValue({
      ok: false,
      error: '无权读取媒体库',
    });
    await click('读取媒体库');
    expect(document.body.textContent).toContain('无权读取媒体库');
    expect(checkbox('offline').checked).toBe(true);
    actions.listEmbyLibraries.mockResolvedValue({
      ok: true,
      libraries: [{ id: 'movies', name: '电影' }],
    });
    await click('读取媒体库');
    expect(document.body.textContent).toContain('当前列表未返回');
    await click('保存修改');
    expect(saved?.libraryIds).toEqual(['offline']);
  });
  it('合法空列表区别于请求失败', async () => {
    await mount();
    await click('指定媒体库');
    actions.listEmbyLibraries.mockResolvedValue({ ok: true, libraries: [] });
    await click('读取媒体库');
    expect(document.body.textContent).toContain('没有返回可选媒体库');
    expect(document.querySelector('[data-library-error]')).toBeNull();
  });
  it('连接变化后忽略旧列表响应并清空旧会话，指定模式不会退回全部', async () => {
    let resolve!: (value: unknown) => void;
    actions.listEmbyLibraries.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount(true, {
      ...initial,
      accessToken: 'old-token',
      userId: 'old-user',
      libraryIds: ['movies'],
    });
    await click('读取媒体库');
    input('url', 'http://new.test');
    await act(async () =>
      resolve({
        ok: true,
        libraries: [{ id: 'old-only', name: '旧服务器的库' }],
      }),
    );
    expect(document.body.textContent).not.toContain('旧服务器的库');
    await click('保存修改');
    expect(saved).toBeUndefined();
    await click('全部媒体库');
    await click('保存修改');
    expect(saved?.accessToken).toBeUndefined();
    expect(saved?.userId).toBeUndefined();
    expect(saved?.url).toBe('http://new.test');
  });
  it('关闭新增弹窗后的登录响应不保存凭据', async () => {
    let resolve!: (value: unknown) => void;
    actions.loginEmbyUser.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount(false, {
      ...initial,
      username: 'demo',
      password: 'synthetic-password',
    });
    await click('登录验证');
    await click('取消');
    await act(async () =>
      resolve({
        ok: true,
        accessToken: 'late-token',
        userId: 'late-user',
        username: 'demo',
        tokenObtainedAt: 1,
      }),
    );
    expect(saved).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('登录中修改地址不接收旧凭据', async () => {
    let resolve!: (value: unknown) => void;
    actions.loginEmbyUser.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount(false, {
      ...initial,
      username: 'demo',
      password: 'synthetic-password',
    });
    await click('登录验证');
    input('url', 'http://new.test');
    await act(async () =>
      resolve({
        ok: true,
        accessToken: 'old-token',
        userId: 'old-user',
        username: 'demo',
        tokenObtainedAt: 1,
      }),
    );
    await click('添加服务器');
    expect(saved?.accessToken).toBeUndefined();
    expect(saved?.url).toBe('http://new.test');
  });
});
