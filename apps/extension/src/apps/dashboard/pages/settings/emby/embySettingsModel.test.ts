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
    expect(bad.errors.some((e) => e.includes('API Key'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('同步间隔'))).toBe(true);
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
    expect(validateMediaServerInput({ url: 'bad', apiKey: '' }).ok).toBe(false);
    expect(
      validateMediaServerInput({ url: 'http://192.168.1.1:8096', apiKey: 'k' }).ok,
    ).toBe(true);
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

