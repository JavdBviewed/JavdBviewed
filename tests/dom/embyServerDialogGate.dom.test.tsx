/** @description 媒体服务器弹窗保存校验、取消、键盘和密码可见行为 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  MediaServerCreateDialog,
  MediaServerEditDialog,
} from '../../apps/extension/src/apps/dashboard/pages/settings/emby/EmbySettingsPage';
import type { EmbyMediaServer } from '../../apps/extension/src/features/embyLibrary/types';
const server: EmbyMediaServer = {
  id: 'srv-1',
  type: 'emby',
  name: '家庭库',
  url: 'http://media.test',
  apiKey: 'synthetic-key',
  enabled: true,
};
let root: Root;
let close: ReturnType<typeof vi.fn>;
let save: ReturnType<typeof vi.fn>;
async function mount(patch: Partial<EmbyMediaServer> = {}, create = false) {
  await act(async () =>
    root.render(
      create ? (
        <MediaServerCreateDialog
          draft={{ ...server, ...patch }}
          onChange={() => {}}
          onConfirm={save}
          onCancel={close}
        />
      ) : (
        <MediaServerEditDialog
          server={{ ...server, ...patch }}
          index={0}
          onSave={save}
          onClose={close}
          onRemove={() => {}}
        />
      ),
    ),
  );
}
async function click(selector: string) {
  await act(async () => document.querySelector<HTMLElement>(selector)!.click());
}
async function key(key: string, shiftKey = false) {
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML =
    '<button id="opener">编辑</button><div id="root"></div>';
  document.getElementById('opener')!.focus();
  root = createRoot(document.getElementById('root')!);
  close = vi.fn();
  save = vi.fn(async () => ({ ok: true }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});
it.each([true, false])(
  '保存和取消固定在footer，表单独立滚动（create=%s）',
  async (create) => {
    await mount({}, create);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.className).toContain('max-w-[40rem]');
    expect(
      dialog
        .querySelector('.ui-modal__body')!
        .querySelector('.emby-server-form-body'),
    ).not.toBeNull();
    const labels = [...dialog.querySelectorAll('.ui-modal__footer button')].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual(
      create ? ['取消', '添加服务器'] : ['删除服务器', '取消', '保存修改'],
    );
  },
);
it('无凭据时保存定位错误，但取消可退出', async () => {
  await mount({ apiKey: '' });
  await click('.emby-server-edit-done');
  expect(save).not.toHaveBeenCalled();
  expect(
    document.querySelector('[data-field="credentials"]')?.textContent,
  ).toContain('需要至少一种凭据');
  expect(document.activeElement?.id).toBe('emby-server-srv-1-api-key');
  await click('.emby-server-edit-cancel');
  expect(close).toHaveBeenCalledOnce();
});
it('地址无效时保存定位地址字段', async () => {
  await mount({ url: 'ftp://bad' });
  await click('.emby-server-edit-done');
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector('[data-field="url"]')?.textContent).toContain(
    'http 或 https',
  );
  expect(document.activeElement?.id).toBe('emby-server-srv-1-url');
});
it('停用的未配服务器可保存', async () => {
  await mount({ enabled: false, url: '', apiKey: '' });
  await click('.emby-server-edit-done');
  expect(save).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it.each(['Escape', 'header'])(
  '关闭是取消草稿，不受保存校验卡住（%s）',
  async (method) => {
    await mount({ apiKey: '', url: '' });
    if (method === 'Escape') await key('Escape');
    else await click('.ui-modal__close');
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  },
);
it('类型先聚焦，Tab循环限制在弹窗内', async () => {
  await mount();
  expect(document.activeElement?.id).toBe('emby-server-srv-1-type');
  document.querySelector<HTMLElement>('.emby-server-edit-done')!.focus();
  await key('Tab');
  expect(document.activeElement?.className).toContain('ui-modal__close');
  await key('Tab', true);
  expect(document.activeElement?.className).toContain('emby-server-edit-done');
});
it('密码小眼睛切换可见状态并保持原密码', async () => {
  await mount({ password: 'synthetic-password' });
  const input = document.querySelector<HTMLInputElement>(
    '#emby-server-srv-1-password',
  )!;
  expect(input.type).toBe('password');
  await click('[aria-label="显示密码"]');
  expect(input.type).toBe('text');
  expect(input.value).toBe('synthetic-password');
  await click('[aria-label="隐藏密码"]');
  expect(input.type).toBe('password');
});
it('保存期间禁止关闭和重复提交', async () => {
  let resolve!: (result: { ok: boolean }) => void;
  save.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await mount();
  await click('.emby-server-edit-done');
  await key('Escape');
  await click('.ui-modal__close');
  expect(close).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledOnce();
  await act(async () => resolve({ ok: true }));
  expect(close).toHaveBeenCalledOnce();
});
