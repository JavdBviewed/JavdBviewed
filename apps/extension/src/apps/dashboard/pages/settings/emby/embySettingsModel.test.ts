/**
 * @file embySettingsModel.test.ts
 * @description Emby/Jellyfin 设置模型单测
 * @module apps/dashboard/pages/settings/emby
 */
import { describe, expect, it } from 'vitest';
import {
  addMatchUrl,
  addMediaServer,
  applyEmbyFormToSettings,
  createEmptyMediaServerDraft,
  DEFAULT_EMBY_SETTINGS_FORM,
  formToEmbySettings,
  isValidServerUrl,
  isValidUrlPattern,
  mapSettingsToEmbyForm,
  normalizeMediaServers,
  removeMatchUrlAt,
  removeMediaServerAt,
  clearMediaServerUserSession,
  updateMatchUrlAt,
  updateMediaServerAt,
  validateEmbyForm,
  validateMediaServerInput,
  hasUsableServerCredentials,
  serverCredentialMode,
  serverCredentialCapabilityLines,
} from './embySettingsModel';
import { isEmbyRecognitionEnabled, isEmbyLibraryEnabled } from '../../../../../utils/config';

describe('embySettingsModel', () => {
  it('defaults match legacy DEFAULT_SETTINGS.emby', () => {
    expect(DEFAULT_EMBY_SETTINGS_FORM.enabled).toBe(false);
    expect(DEFAULT_EMBY_SETTINGS_FORM.linkBehavior).toBe('javdb-search');
    expect(DEFAULT_EMBY_SETTINGS_FORM.showQuickSearchCode).toBe(true);
    expect(DEFAULT_EMBY_SETTINGS_FORM.showQuickSearchActor).toBe(true);
    expect(DEFAULT_EMBY_SETTINGS_FORM.syncIntervalMinutes).toBe(60);
    expect(DEFAULT_EMBY_SETTINGS_FORM.libraryStatusEnabled).toBe(false);
    expect(DEFAULT_EMBY_SETTINGS_FORM.libraryShowOnList).toBe(true);
    expect(DEFAULT_EMBY_SETTINGS_FORM.mediaServers).toEqual([]);
    expect(DEFAULT_EMBY_SETTINGS_FORM.videoCodePatterns.length).toBeGreaterThan(0);
  });

  it('maps empty settings to defaults', () => {
    // matchUrlDrafts 是 mapSettingsToEmbyForm 的派生字段（与 matchUrls 同源），不参与默认表单契约
    const excludeDrafts = (v: unknown) => {
      if (v && typeof v === 'object' && 'matchUrlDrafts' in (v as object)) {
        const { matchUrlDrafts: _drop, ...rest } = v as Record<string, unknown>;
        return rest;
      }
      return v;
    };
    expect(excludeDrafts(mapSettingsToEmbyForm(undefined))).toEqual(excludeDrafts(DEFAULT_EMBY_SETTINGS_FORM));
    expect(excludeDrafts(mapSettingsToEmbyForm({}))).toEqual(excludeDrafts(DEFAULT_EMBY_SETTINGS_FORM));
  });

  it('maps nested ExtensionSettings.emby', () => {
    const form = mapSettingsToEmbyForm({
      emby: {
        enabled: true,
        matchUrls: ['https://media.example.com/*'],
        linkBehavior: 'javdb-direct',
        showQuickSearchCode: false,
        showQuickSearchActor: true,
        mediaServers: [
          {
            id: 's1',
            type: 'jellyfin',
            name: 'Home',
            url: 'http://192.168.1.10:8096/',
            apiKey: 'key',
            enabled: true,
          },
        ],
        syncIntervalMinutes: 30,
        libraryStatus: { enabled: true, showOnList: false, showOnDetail: true },
        realtimeCheck: {
          enabled: true,
          concurrency: 2,
          batchSize: 10,
          cacheTtlMinutes: 5,
        },
      },
    } as any);

    expect(form.enabled).toBe(true);
    expect(form.matchUrls).toEqual(['https://media.example.com/*']);
    expect(form.linkBehavior).toBe('javdb-direct');
    expect(form.showQuickSearchCode).toBe(false);
    expect(form.mediaServers).toHaveLength(1);
    expect(form.mediaServers[0].type).toBe('jellyfin');
    expect(form.mediaServers[0].url).toBe('http://192.168.1.10:8096');
    expect(form.syncIntervalMinutes).toBe(30);
    expect(form.libraryStatusEnabled).toBe(true);
    expect(form.libraryShowOnList).toBe(false);
    expect(form.realtimeCheckEnabled).toBe(true);
    expect(form.realtimeConcurrency).toBe(2);
  });

  it('maps bare emby object', () => {
    const form = mapSettingsToEmbyForm({
      enabled: true,
      linkBehavior: 'javdb-search',
      mediaServers: [],
    });
    expect(form.enabled).toBe(true);
    expect(form.linkBehavior).toBe('javdb-search');
  });

  it('formToEmbySettings + applyEmbyFormToSettings round-trip', () => {
    const form = {
      ...DEFAULT_EMBY_SETTINGS_FORM,
      enabled: true,
      recognitionEnabled: true,
      libraryEnabled: true,
      matchUrls: ['https://a.com/*', '  '],
      mediaServers: [
        {
          id: 's1',
          type: 'emby' as const,
          name: 'Main',
          url: 'http://10.0.0.1:8096/',
          apiKey: 'k',
          enabled: true,
        },
      ],
      libraryStatusEnabled: true,
      realtimeCheckEnabled: true,
    };
    const emby = formToEmbySettings(form);
    expect((emby.matchUrls as string[])).toEqual(['https://a.com/*']);
    expect((emby.matchUrlDrafts as string[])).toEqual(['https://a.com/*', '  ']);
    expect((emby.mediaServers as any[])[0].url).toBe('http://10.0.0.1:8096');
    expect((emby.libraryStatus as any).enabled).toBe(true);
    expect((emby.realtimeCheck as any).enabled).toBe(true);
    expect(emby.enableAutoDetection).toBe(true);

    const next = applyEmbyFormToSettings({} as any, form);
    expect(next.emby?.enabled).toBe(true);
  });

  it('normalizes media servers and filters empty rows', () => {
    const servers = normalizeMediaServers([
      { type: 'jellyfin', name: 'JF', url: 'http://x/', apiKey: 'a', enabled: false },
      { url: '', apiKey: '' },
      null,
    ]);
    expect(servers).toHaveLength(1);
    expect(servers[0].type).toBe('jellyfin');
    expect(servers[0].enabled).toBe(false);
    expect(servers[0].id).toBeTruthy();
  });

  it('preserves the saved password through settings normalization and round-trip', () => {
    const form = mapSettingsToEmbyForm({
      emby: {
        mediaServers: [
          {
            id: 'saved-login',
            type: 'emby',
            name: 'Home',
            url: 'http://media.local:8096',
            apiKey: 'api-key',
            username: 'ryen',
            password: 'saved-password',
            enabled: true,
          },
        ],
      },
    } as any);

    expect(form.mediaServers[0]?.password).toBe('saved-password');
    expect(
      (formToEmbySettings(form).mediaServers as Array<{ password?: string }>)[0]?.password,
    ).toBe('saved-password');
  });

  it('keeps the saved password when clearing a user session', () => {
    const server = normalizeMediaServers([
      {
        id: 'saved-login',
        type: 'emby',
        name: 'Home',
        url: 'http://media.local:8096',
        apiKey: 'api-key',
        username: 'ryen',
        password: 'saved-password',
        accessToken: 'session-token',
        userId: 'user-1',
        enabled: true,
      },
    ])[0];

    const cleared = clearMediaServerUserSession(server);

    expect(cleared.password).toBe('saved-password');
    expect(cleared.accessToken).toBeUndefined();
    expect(cleared.userId).toBeUndefined();
  });

  it('validates form urls and servers', () => {
    expect(validateEmbyForm(DEFAULT_EMBY_SETTINGS_FORM).isValid).toBe(true);

    const bad = validateEmbyForm({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      matchUrls: [''],
      mediaServers: [
        {
          id: 's1',
          type: 'emby',
          name: 'x',
          url: 'ftp://bad',
          apiKey: '',
          enabled: true,
        },
      ],
      syncIntervalMinutes: 1,
    });
    expect(bad.isValid).toBe(false);
    expect(bad.errors.some((e) => e.includes('额外匹配地址'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('http 或 https'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('需要至少一种凭据'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('同步间隔'))).toBe(true);
  });

  it('accepts servers with login-session credentials (no apiKey) for cross-device parity', () => {
    // 云同步/桌面端来源：仅登录会话（accessToken+userId），无 apiKey → 应可保存
    expect(
      validateEmbyForm({
        ...DEFAULT_EMBY_SETTINGS_FORM,
        mediaServers: [
          {
            id: 's-token',
            type: 'emby',
            name: 'A',
            url: 'http://a.local',
            apiKey: '',
            enabled: true,
            accessToken: 'tok',
            userId: 'u1',
          },
        ],
      }).isValid,
    ).toBe(true);

    // 仅用户名+密码 → 应可保存
    expect(
      validateEmbyForm({
        ...DEFAULT_EMBY_SETTINGS_FORM,
        mediaServers: [
          {
            id: 's-pwd',
            type: 'emby',
            name: 'B',
            url: 'http://b.local',
            apiKey: '',
            enabled: true,
            username: 'u',
            password: 'p',
          },
        ],
      }).isValid,
    ).toBe(true);

    // 只有用户名没有密码 → 仍缺凭据
    const bad = validateEmbyForm({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      mediaServers: [
        {
          id: 's-useronly',
          type: 'emby',
          name: 'C',
          url: 'http://c.local',
          apiKey: '',
          enabled: true,
          username: 'u',
        },
      ],
    });
    expect(bad.isValid).toBe(false);
    expect(bad.errors.some((e) => e.includes('需要至少一种凭据'))).toBe(true);

    // 仅 apiKey（空白 apiKey 视为无）
    expect(
      validateEmbyForm({
        ...DEFAULT_EMBY_SETTINGS_FORM,
        mediaServers: [
          {
            id: 's-key',
            type: 'emby',
            name: 'D',
            url: 'http://d.local',
            apiKey: 'key-1',
            enabled: true,
          },
        ],
      }).isValid,
    ).toBe(true);
  });

  it('hasUsableServerCredentials honors any single credential path', () => {
    expect(
      hasUsableServerCredentials({ apiKey: ' k ', accessToken: undefined, username: undefined, password: undefined }),
    ).toBe(true);
    expect(
      hasUsableServerCredentials({ apiKey: '', accessToken: 'tok', username: undefined, password: undefined }),
    ).toBe(true);
    expect(
      hasUsableServerCredentials({ apiKey: ' ', accessToken: '', username: 'u', password: 'p' }),
    ).toBe(true);
    expect(
      hasUsableServerCredentials({ apiKey: '', accessToken: '', username: 'u', password: '' }),
    ).toBe(false);
    expect(
      hasUsableServerCredentials({ apiKey: '', accessToken: '', username: '', password: 'p' }),
    ).toBe(false);
  });

  it('keeps empty match-url drafts in settings for editing while persisting only filled ones', () => {
    const emby = formToEmbySettings({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      matchUrls: ['https://a.com/*', ''],
    });
    expect((emby.matchUrls as string[])).toEqual(['https://a.com/*']);
    expect((emby.matchUrlDrafts as string[])).toEqual(['https://a.com/*', '']);

    const remapped = mapSettingsToEmbyForm(emby);
    expect(remapped.matchUrls).toEqual(['https://a.com/*', '']);

    // 编辑后保存：落库 matchUrls 只有非空行；drafts 保留空行以便刷新后继续编辑
    const saved = formToEmbySettings(remapped);
    expect((saved.matchUrls as string[])).toEqual(['https://a.com/*']);
    expect((saved.matchUrlDrafts as string[])).toEqual(['https://a.com/*', '']);
  });

  it('warns on suspicious match url pattern', () => {
    const r = validateEmbyForm({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      matchUrls: ['(unclosed'],
    });
    // 无效正则 → warning（isValidUrlPattern false）
    expect(r.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('isValidServerUrl / isValidUrlPattern', () => {
    expect(isValidServerUrl('http://192.168.1.1:8096')).toBe(true);
    expect(isValidServerUrl('https://media.example.com')).toBe(true);
    expect(isValidServerUrl('ftp://x')).toBe(false);
    expect(isValidServerUrl('not-url')).toBe(false);
    expect(isValidUrlPattern('https://media.example.com/*')).toBe(true);
  });

  it('CRUD helpers for media servers and match urls', () => {
    let servers = addMediaServer([], {
      type: 'emby',
      name: 'A',
      url: 'http://a/',
      apiKey: 'k',
      enabled: true,
    });
    expect(servers).toHaveLength(1);
    servers = updateMediaServerAt(servers, 0, { name: 'B', type: 'jellyfin' });
    expect(servers[0].name).toBe('B');
    expect(servers[0].type).toBe('jellyfin');
    servers = removeMediaServerAt(servers, 0);
    expect(servers).toHaveLength(0);

    let urls = addMatchUrl([], 'https://x/*');
    urls = updateMatchUrlAt(urls, 0, 'https://y/*');
    expect(urls[0]).toBe('https://y/*');
    urls = removeMatchUrlAt(urls, 0);
    expect(urls).toHaveLength(0);
  });

  it('validateMediaServerInput and createEmptyMediaServerDraft', () => {
    const draft = createEmptyMediaServerDraft();
    expect(draft.type).toBe('emby');
    expect(draft.enabled).toBe(true);
    expect(validateMediaServerInput({ url: 'bad', apiKey: '', username: '', password: '' }).ok).toBe(false);
    expect(
      validateMediaServerInput({ url: 'http://192.168.1.1:8096', apiKey: 'k', username: '', password: '' }).ok,
    ).toBe(true);
  });

  it('validateMediaServerInput accepts all three credential shapes and rejects none', () => {
    const base = { url: 'http://192.168.1.1:8096/' };
    // 仅 API Key
    expect(
      validateMediaServerInput({ ...base, apiKey: 'k', username: '', password: '' }).ok,
    ).toBe(true);
    // 仅 用户名+密码
    expect(
      validateMediaServerInput({ ...base, apiKey: '', username: 'u', password: 'p' }).ok,
    ).toBe(true);
    // 两者都配（合法，不得报错）
    expect(
      validateMediaServerInput({ ...base, apiKey: 'k', username: 'u', password: 'p' }).ok,
    ).toBe(true);
    // 全空 → 明确凭据错误
    const none = validateMediaServerInput({ ...base, apiKey: '', username: '', password: '' });
    expect(none.ok).toBe(false);
    expect(none.field).toBe('credentials');
    expect(none.message).toContain('至少一种凭据');
    // 只有用户名没有密码 → 视为未配置账号
    expect(
      validateMediaServerInput({ ...base, apiKey: '', username: 'u', password: '' }).ok,
    ).toBe(false);
    // 空白串等同未配置
    expect(
      validateMediaServerInput({ ...base, apiKey: '  ', username: '  ', password: 'p' }).ok,
    ).toBe(false);
    // url 非法优先级不变
    const badUrl = validateMediaServerInput({ url: 'ftp://x', apiKey: 'k', username: '', password: '' });
    expect(badUrl.ok).toBe(false);
    expect(badUrl.field).toBe('url');
  });

  it('serverCredentialMode classifies apiKey / account / both / none', () => {
    expect(serverCredentialMode({ apiKey: 'k', username: '', password: '' })).toBe('apiKey');
    expect(serverCredentialMode({ apiKey: '', username: 'u', password: 'p' })).toBe('account');
    expect(serverCredentialMode({ apiKey: 'k', username: 'u', password: 'p' })).toBe('both');
    expect(serverCredentialMode({ apiKey: '', username: '', password: '' })).toBe('none');
    expect(serverCredentialMode({ apiKey: ' ', username: 'u', password: ' ' })).toBe('none');
  });

  it('serverCredentialCapabilityLines reflects the credential shape and login state', () => {
    expect(serverCredentialCapabilityLines({ apiKey: '', username: '', password: '' })[0])
      .toContain('请至少配置一种凭据');
    expect(serverCredentialCapabilityLines({ apiKey: 'k', username: '', password: '' })[0])
      .toContain('进度写回与标记已看需再配置用户名');
    expect(serverCredentialCapabilityLines({ apiKey: '', username: 'u', password: 'p' })[0])
      .toContain('登录并保存令牌');
    expect(serverCredentialCapabilityLines({ apiKey: 'k', username: 'u', password: 'p' })[0])
      .toContain('立即可用');
    const loggedIn = serverCredentialCapabilityLines({
      apiKey: '',
      username: 'u',
      password: 'p',
      loggedIn: true,
    })[0];
    expect(loggedIn).toContain('全部可用');
  });
});

describe('embySettingsModel: capability split (recognition/library)', () => {
  it('reads new capability fields directly when present', () => {
    const form = mapSettingsToEmbyForm({
      emby: {
        enabled: true,
        recognitionEnabled: true,
        libraryEnabled: false,
        libraryStatus: { enabled: false, showOnList: true, showOnDetail: true },
      } as any,
    });
    expect(form.recognitionEnabled).toBe(true);
    expect(form.libraryEnabled).toBe(false);
    expect(form.enabled).toBe(true);
  });

  it('backfills legacy data (only emby.enabled) to recognition-only', () => {
    const form = mapSettingsToEmbyForm({
      emby: {
        enabled: true,
        libraryStatus: { enabled: false, showOnList: true, showOnDetail: true },
      } as any,
    });
    expect(form.recognitionEnabled).toBe(true);
    expect(form.libraryEnabled).toBe(false);
    expect(form.enabled).toBe(true);
  });

  it('backfills legacy data (enabled + libraryStatus.enabled) to both', () => {
    const form = mapSettingsToEmbyForm({
      emby: {
        enabled: true,
        libraryStatus: { enabled: true, showOnList: false, showOnDetail: true },
      } as any,
    });
    expect(form.recognitionEnabled).toBe(true);
    expect(form.libraryEnabled).toBe(true);
    expect(form.enabled).toBe(true);
  });

  it('backfills legacy disabled data to both false', () => {
    const form = mapSettingsToEmbyForm({
      emby: {
        enabled: false,
        libraryStatus: { enabled: true, showOnList: true, showOnDetail: true },
      } as any,
    });
    expect(form.recognitionEnabled).toBe(false);
    expect(form.libraryEnabled).toBe(false);
    expect(form.enabled).toBe(false);
  });

  it('formToEmbySettings derives enabled (OR) and libraryStatus.enabled from capability fields', () => {
    const form = {
      ...DEFAULT_EMBY_SETTINGS_FORM,
      recognitionEnabled: true,
      libraryEnabled: true,
    };
    const emby = formToEmbySettings(form);
    expect(emby.recognitionEnabled).toBe(true);
    expect(emby.libraryEnabled).toBe(true);
    expect(emby.enabled).toBe(true);
    expect((emby.libraryStatus as any).enabled).toBe(true);

    const recognitionOnly = { ...form, recognitionEnabled: true, libraryEnabled: false };
    const emby2 = formToEmbySettings(recognitionOnly);
    expect(emby2.enabled).toBe(true);
    expect(emby2.libraryEnabled).toBe(false);
    expect((emby2.libraryStatus as any).enabled).toBe(false);

    const allOff = { ...form, recognitionEnabled: false, libraryEnabled: false };
    const emby3 = formToEmbySettings(allOff);
    expect(emby3.enabled).toBe(false);
  });

  it('shared capability helpers handle legacy + new data', () => {
    // new data
    expect(isEmbyRecognitionEnabled({ recognitionEnabled: true, enabled: false })).toBe(true);
    expect(isEmbyRecognitionEnabled({ recognitionEnabled: false, enabled: true })).toBe(false);
    expect(isEmbyLibraryEnabled({ libraryEnabled: true, enabled: false })).toBe(true);
    // legacy data (no recognition/library fields)
    expect(isEmbyRecognitionEnabled({ enabled: true })).toBe(true);
    expect(isEmbyRecognitionEnabled({ enabled: false })).toBe(false);
    expect(isEmbyLibraryEnabled({ enabled: true, libraryStatus: { enabled: true } })).toBe(true);
    expect(isEmbyLibraryEnabled({ enabled: true, libraryStatus: { enabled: false } })).toBe(false);
    expect(isEmbyLibraryEnabled({ enabled: false, libraryStatus: { enabled: true } })).toBe(false);
    // null/undefined
    expect(isEmbyRecognitionEnabled(null)).toBe(false);
    expect(isEmbyLibraryEnabled(undefined)).toBe(false);
  });
});


describe('embySettingsModel: disabled servers are excluded from save validation', () => {
  // 用户报障：某台服务器停用且未配凭据时，整表单保存被「需要至少一种凭据」阻断
  it('skips url and credential checks for disabled servers', () => {
    const result = validateEmbyForm({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      mediaServers: [
        {
          id: 's1',
          type: 'emby',
          name: '主服务器',
          url: 'http://192.168.1.10:8096',
          apiKey: 'key-1',
          enabled: true,
        },
        {
          id: 's4',
          type: 'jellyfin',
          name: '备用（暂停）',
          url: '',
          apiKey: '',
          enabled: false,
        },
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.isValid).toBe(true);
  });

  it('still rejects a disabled server with a malformed url when it is enabled again', () => {
    const result = validateEmbyForm({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      mediaServers: [
        {
          id: 's4',
          type: 'emby',
          name: '备用',
          url: 'ftp://bad',
          apiKey: 'key-1',
          enabled: true,
        },
      ],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('地址需要使用 http 或 https'))).toBe(true);
  });

  it('names the offending server (index + name + url) in credential errors', () => {
    const result = validateEmbyForm({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      mediaServers: [
        {
          id: 's1',
          type: 'emby',
          name: '主服务器',
          url: 'http://192.168.1.10:8096',
          apiKey: 'key-1',
          enabled: true,
        },
        {
          id: 's2',
          type: 'emby',
          name: '家庭库',
          url: 'http://192.168.1.5:8096',
          apiKey: '',
          enabled: true,
        },
      ],
    });
    expect(result.isValid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e ===
          '媒体服务器 2「家庭库」（http://192.168.1.5:8096）需要至少一种凭据（API Key / 访问令牌 / 用户名+密码）',
      ),
    ).toBe(true);
  });

  it('names the offending server in url errors too', () => {
    const result = validateEmbyForm({
      ...DEFAULT_EMBY_SETTINGS_FORM,
      mediaServers: [
        {
          id: 's1',
          type: 'jellyfin',
          name: '',
          url: 'ftp://bad',
          apiKey: 'key-1',
          enabled: true,
        },
      ],
    });
    expect(
      result.errors.some((e) => e.startsWith('媒体服务器 1「Jellyfin」（ftp://bad）地址需要使用')),
    ).toBe(true);
  });

  it('validateMediaServerInput credential message lists the access token option', () => {
    const v = validateMediaServerInput({
      url: 'http://a.local',
      apiKey: '',
      username: '',
      password: '',
    });
    expect(v.ok).toBe(false);
    expect(v.field).toBe('credentials');
    expect(v.message).toContain('API Key / 访问令牌 / 用户名+密码');
  });
});
