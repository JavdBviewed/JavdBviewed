/**
 * @file embySettingsModel.mediaServerSave.test.ts
 * @description 单台媒体服务器的保存校验与标识文案（新增/编辑弹窗关闭门禁共用的纯函数）
 * @module apps/dashboard/pages/settings/emby
 */
import { describe, expect, it } from 'vitest';
import {
  mediaServerIdentityLabel,
  validateMediaServerForSave,
} from './embySettingsModel';
import type { EmbyMediaServer } from '../../../../../features/embyLibrary/types';

function server(patch: Partial<EmbyMediaServer>): EmbyMediaServer {
  return {
    id: 's1',
    type: 'emby',
    name: '主服务器',
    url: 'http://192.168.1.10:8096',
    apiKey: 'key-1',
    enabled: true,
    ...patch,
  } as EmbyMediaServer;
}

describe('mediaServerIdentityLabel', () => {
  it('combines index, name and url', () => {
    expect(mediaServerIdentityLabel(server({ name: '家庭库' }), 1)).toBe(
      '媒体服务器 2「家庭库」（http://192.168.1.10:8096）',
    );
  });

  it('falls back to the server type name when the name is blank', () => {
    expect(mediaServerIdentityLabel(server({ name: '   ', type: 'jellyfin' }), 0)).toBe(
      '媒体服务器 1「Jellyfin」（http://192.168.1.10:8096）',
    );
  });

  it('omits the url parenthesis when the url is blank', () => {
    expect(mediaServerIdentityLabel(server({ url: '' }), 3)).toBe('媒体服务器 4「主服务器」');
  });

  it('trims the url used for the label', () => {
    expect(mediaServerIdentityLabel(server({ url: '  http://a.local  ' }), 0)).toBe(
      '媒体服务器 1「主服务器」（http://a.local）',
    );
  });
});

describe('validateMediaServerForSave', () => {
  it('accepts a disabled server without url or credentials', () => {
    const v = validateMediaServerForSave(
      server({ enabled: false, url: '', apiKey: '', username: '', password: '' }),
      3,
    );
    expect(v.ok).toBe(true);
    expect(v.message).toBeUndefined();
  });

  it('rejects an enabled server with a malformed url and points at the url field', () => {
    const v = validateMediaServerForSave(server({ url: 'ftp://bad', apiKey: 'k' }), 0);
    expect(v.ok).toBe(false);
    expect(v.field).toBe('url');
    expect(v.message).toContain('媒体服务器 1「主服务器」（ftp://bad）');
    expect(v.message).toContain('地址需要使用 http 或 https');
  });

  it('rejects an enabled server without any credential and points at the credentials field', () => {
    const v = validateMediaServerForSave(server({ apiKey: '', username: '', password: '' }), 1);
    expect(v.ok).toBe(false);
    expect(v.field).toBe('credentials');
    expect(v.message).toBe(
      '媒体服务器 2「主服务器」（http://192.168.1.10:8096）需要至少一种凭据（API Key / 访问令牌 / 用户名+密码）',
    );
  });

  it('rejects an enabled server with a blank url and no credentials', () => {
    const v = validateMediaServerForSave(
      server({ url: '', apiKey: '', username: '', password: '' }),
      0,
    );
    expect(v.ok).toBe(false);
    expect(v.field).toBe('url');
  });

  it('accepts login-session credentials and username+password pairs', () => {
    expect(
      validateMediaServerForSave(server({ apiKey: '', accessToken: 'tok' }), 0).ok,
    ).toBe(true);
    expect(
      validateMediaServerForSave(
        server({ apiKey: '', username: 'u', password: 'p' }),
        0,
      ).ok,
    ).toBe(true);
    expect(
      validateMediaServerForSave(server({ apiKey: '', username: 'u', password: ' ' }), 0).ok,
    ).toBe(false);
  });
});
