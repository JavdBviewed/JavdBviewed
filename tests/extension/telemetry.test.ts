/**
 * @file telemetry.test.ts
 * @description telemetry settings defaults 测试
 * @module tests/extension
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_ENDPOINT_STATE_KEY } from '../../apps/extension/src/platform/network';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../apps/extension/src/utils/config';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';

describe('telemetry settings defaults', () => {
  it('uses the Cloudflare API endpoint by default', () => {
    expect((DEFAULT_SETTINGS as any).telemetry.endpoint).toBe('https://jbd-server.we-together.club/v1/telemetry/report');
  });

  it('fills the Cloudflare endpoint for legacy settings with an empty endpoint', async () => {
    const { getSettings } = await import('../../apps/extension/src/utils/storage');
    setChromeStorage({
      [STORAGE_KEYS.SETTINGS]: {
        telemetry: {
          enabled: true,
          endpoint: '',
          channel: 'stable',
        },
      },
    });

    const settings = await getSettings();

    expect(settings.telemetry.endpoint).toBe('https://jbd-server.we-together.club/v1/telemetry/report');
  });
});

describe('telemetry client state', () => {
  it('uses existing Device ID as the first installId and persists it separately', async () => {
    const { getTelemetryClientState, TELEMETRY_CLIENT_STATE_KEY } = await import('../../apps/extension/src/features/telemetry');

    const state = await getTelemetryClientState({
      webdav: { clientId: 'existing-device-id' },
    });

    expect(state.installId).toBe('existing-device-id');
    expect(state.sessionId).toMatch(/^session-/);
    expect(getChromeStorageSnapshot()[TELEMETRY_CLIENT_STATE_KEY]).toEqual(expect.objectContaining({
      installId: 'existing-device-id',
      sessionId: state.sessionId,
    }));
  });

  it('keeps a persisted installId even when settings Device ID changes', async () => {
    const { getTelemetryClientState, TELEMETRY_CLIENT_STATE_KEY } = await import('../../apps/extension/src/features/telemetry');
    setChromeStorage({
      [TELEMETRY_CLIENT_STATE_KEY]: {
        installId: 'persisted-install-id',
        sessionId: 'session-existing',
        sessionStartedAt: '2026-05-26T01:00:00.000Z',
      },
    });

    const state = await getTelemetryClientState({
      webdav: { clientId: 'new-device-id' },
    });

    expect(state.installId).toBe('persisted-install-id');
    expect(state.sessionId).toBe('session-existing');
  });
});

describe('telemetry payload', () => {
  it('uses finer buckets for large viewed libraries', async () => {
    const { bucketViewedCount } = await import('../../apps/extension/src/features/telemetry');

    expect([
      bucketViewedCount(999),
      bucketViewedCount(1000),
      bucketViewedCount(1999),
      bucketViewedCount(2000),
      bucketViewedCount(4999),
      bucketViewedCount(5000),
      bucketViewedCount(9999),
      bucketViewedCount(10000),
      bucketViewedCount(19999),
      bucketViewedCount(20000),
      bucketViewedCount(49999),
      bucketViewedCount(50000),
      bucketViewedCount(79999),
      bucketViewedCount(80000),
      bucketViewedCount(99999),
      bucketViewedCount(100000),
    ]).toEqual([
      '500-999',
      '1000-1999',
      '1000-1999',
      '2000-4999',
      '2000-4999',
      '5000-9999',
      '5000-9999',
      '10000-19999',
      '10000-19999',
      '20000-49999',
      '20000-49999',
      '50000-79999',
      '50000-79999',
      '80000-99999',
      '80000-99999',
      '100000+',
    ]);
  });

  it('applies viewed-library buckets to telemetry payload metrics', async () => {
    const { buildTelemetryPayload } = await import('../../apps/extension/src/features/telemetry');
    setChromeStorage({
      [STORAGE_KEYS.VIEWED_RECORDS]: Object.fromEntries(Array.from({ length: 2000 }, (_v, index) => [`ID-${index}`, {}])),
    });

    const payload = await buildTelemetryPayload({
      event: 'startup',
      settings: DEFAULT_SETTINGS,
      state: {
        installId: 'install-id',
        sessionId: 'session-test',
        sessionStartedAt: '2026-05-26T01:00:00.000Z',
      },
      now: new Date('2026-05-26T02:00:00.000Z'),
      runtime: {
        version: '1.20.2',
      },
    });

    expect(payload.metrics.viewedCountBucket).toBe('2000-4999');
    expect(payload.metrics.actorCountBucket).toBe('0');
    expect(payload.metrics.enabledSearchEngineCountBucket).toBe('10-49');
  });

  it('defines reportable feature flags through a display catalog', async () => {
    const { TELEMETRY_FEATURE_CATALOG } = await import('../../apps/extension/src/features/telemetry');

    const keys = TELEMETRY_FEATURE_CATALOG.map((feature) => feature.key);

    expect(keys).toEqual([
      'webdavEnabled',
      'drive115Enabled',
      'actorSyncEnabled',
      'actorAutoSyncEnabled',
      'aiEnabled',
      'magnetSearchEnabled',
      'magnetAutoSearchEnabled',
      'newWorksAutoCheckEnabled',
      'videoEnhancementEnabled',
      'titleTranslationEnabled',
      'externalSearchEnabled',
      'onlineAvailabilityEnabled',
      'subtitleSearchEnabled',
      'fc2BreakerEnabled',
      'reviewBreakerEnabled',
      'relatedListsEnabled',
      'actorRemarksEnabled',
      'actorNameMarksEnabled',
      'videoFavoriteRatingEnabled',
      'wantSyncEnabled',
      'autoMarkWatchedAfter115Enabled',
      'listEnhancementEnabled',
      'listVideoPreviewEnabled',
      'scrollPagingEnabled',
      'actorWatermarkEnabled',
      'listStatusQuickActionEnabled',
      'listFavoriteQuickActionEnabled',
      'actorEnhancementEnabled',
      'embyEnabled',
      'embyRecognitionEnabled',
      'embyLibraryStatusEnabled',
      'embyRealtimeCheckEnabled',
      'privacyScreenshotModeEnabled',
      'privacyPrivateModeEnabled',
      'contentFilterEnabled',
      'anchorOptimizationEnabled',
      'passwordHelperEnabled',
      'superRankingEnabled',
      'insightsAutoMonthlyEnabled',
      'githubProxyEnabled',
    ]);
    expect(TELEMETRY_FEATURE_CATALOG.find((feature) => feature.key === 'onlineAvailabilityEnabled')).toMatchObject({
      label: '在线可看检测',
      category: 'video',
      order: 120,
    });
    expect(keys).not.toContain('externalEntryPanelEnabled');
    expect(keys).not.toContain('remoteConfigEnabled');
  });

  it('builds a strict whitelist payload with bucketed metrics', async () => {
    const { buildTelemetryPayload, TELEMETRY_FEATURE_CATALOG } = await import('../../apps/extension/src/features/telemetry');
    setChromeStorage({
      [STORAGE_KEYS.VIEWED_RECORDS]: Object.fromEntries(Array.from({ length: 12 }, (_v, index) => [`ID-${index}`, { title: `Title ${index}` }])),
      [STORAGE_KEYS.ACTOR_RECORDS]: Object.fromEntries(Array.from({ length: 51 }, (_v, index) => [`actor-${index}`, { name: `Actor ${index}` }])),
      [STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS]: {
        a: {},
        b: {},
      },
      [STORAGE_KEYS.NEW_WORKS_CONFIG]: {
        autoCheckEnabled: true,
      },
    });

    const payload = await buildTelemetryPayload({
      event: 'startup',
      settings: {
        ...DEFAULT_SETTINGS,
        webdav: {
          ...DEFAULT_SETTINGS.webdav,
          enabled: true,
          url: 'https://example.invalid/dav',
          username: 'sensitive-user',
          password: 'sensitive-password',
          clientId: 'existing-device-id',
        },
        drive115: {
          ...(DEFAULT_SETTINGS as any).drive115,
          enabled: true,
          v2AccessToken: 'sensitive-115-token',
        },
        actorSync: {
          ...(DEFAULT_SETTINGS as any).actorSync,
          enabled: true,
          autoSync: true,
        },
        ai: {
          ...(DEFAULT_SETTINGS as any).ai,
          enabled: true,
          apiKey: 'sensitive-ai-key',
        },
        dataEnhancement: {
          ...(DEFAULT_SETTINGS as any).dataEnhancement,
          enableTranslation: true,
        },
        userExperience: {
          ...(DEFAULT_SETTINGS as any).userExperience,
          enableContentFilter: true,
          enableMagnetSearch: true,
          enableAnchorOptimization: true,
          enableListEnhancement: true,
          enableActorEnhancement: true,
          enablePasswordHelper: true,
          enableSuperRanking: true,
        },
        magnetSearch: {
          ...(DEFAULT_SETTINGS as any).magnetSearch,
          autoSearch: true,
          sources: {
            sukebei: true,
            btdig: true,
            btsow: false,
            javbus: true,
          },
        },
        videoEnhancement: {
          ...(DEFAULT_SETTINGS as any).videoEnhancement,
          enabled: true,
          enableExternalEntryPanel: true,
          enableExternalSearch: true,
          enableOnlineAvailability: true,
          enableSubtitleSearch: true,
          enableFC2Breaker: true,
          enableReviewBreaker: true,
          enableRelatedLists: true,
          enableActorRemarks: true,
          enableActorNameMarks: true,
          enableVideoFavoriteRating: true,
          enableWantSync: true,
          autoMarkWatchedAfter115: true,
          onlineAvailabilitySites: {
            fanza: false,
            jable: true,
            missav: true,
          },
        },
        listEnhancement: {
          ...(DEFAULT_SETTINGS as any).listEnhancement,
          enabled: true,
          enableVideoPreview: true,
          enableScrollPaging: true,
          enableActorWatermark: true,
          enableStatusQuickAction: true,
          enableListFavoriteQuickAction: true,
        },
        actorEnhancement: {
          ...(DEFAULT_SETTINGS as any).actorEnhancement,
          enabled: true,
        },
        emby: {
          ...(DEFAULT_SETTINGS as any).emby,
          enabled: true,
          recognitionEnabled: true,
          libraryEnabled: true,
          libraryStatus: {
            enabled: true,
            showOnList: true,
            showOnDetail: true,
          },
          realtimeCheck: {
            enabled: true,
          },
        },
        privacy: {
          ...(DEFAULT_SETTINGS as any).privacy,
          screenshotMode: {
            ...(DEFAULT_SETTINGS as any).privacy.screenshotMode,
            enabled: true,
          },
          privateMode: {
            ...(DEFAULT_SETTINGS as any).privacy.privateMode,
            enabled: true,
          },
        },
        insights: {
          ...(DEFAULT_SETTINGS as any).insights,
          autoMonthlyEnabled: true,
        },
        networkAcceleration: {
          ...(DEFAULT_SETTINGS as any).networkAcceleration,
          github: {
            ...(DEFAULT_SETTINGS as any).networkAcceleration.github,
            enabled: true,
          },
        },
        telemetry: {
          enabled: true,
          endpoint: 'https://telemetry.example.invalid/v1/telemetry/report',
          channel: 'stable',
        },
      },
      state: {
        installId: 'existing-device-id',
        sessionId: 'session-test',
        sessionStartedAt: '2026-05-26T01:00:00.000Z',
      },
      now: new Date('2026-05-26T02:00:00.000Z'),
      runtime: {
        version: '1.20.2',
        build: 68,
        browser: 'Chrome',
        browserVersion: '125',
        platform: 'windows',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
    });

    expect(payload).toEqual(expect.objectContaining({
      schemaVersion: 1,
      deviceId: 'existing-device-id',
      installId: 'existing-device-id',
      anonymous: true,
      event: 'startup',
      client: expect.objectContaining({
        extensionVersion: '1.20.2',
        build: 68,
        channel: 'stable',
      }),
      features: {
        webdavEnabled: true,
        drive115Enabled: true,
        actorSyncEnabled: true,
        actorAutoSyncEnabled: true,
        aiEnabled: true,
        magnetSearchEnabled: true,
        magnetAutoSearchEnabled: true,
        newWorksAutoCheckEnabled: true,
        videoEnhancementEnabled: true,
        titleTranslationEnabled: true,
        externalSearchEnabled: true,
        onlineAvailabilityEnabled: true,
        subtitleSearchEnabled: true,
        fc2BreakerEnabled: true,
        reviewBreakerEnabled: true,
        relatedListsEnabled: true,
        actorRemarksEnabled: true,
        actorNameMarksEnabled: true,
        videoFavoriteRatingEnabled: true,
        wantSyncEnabled: true,
        autoMarkWatchedAfter115Enabled: true,
        listEnhancementEnabled: true,
        listVideoPreviewEnabled: true,
        scrollPagingEnabled: true,
        actorWatermarkEnabled: true,
        listStatusQuickActionEnabled: true,
        listFavoriteQuickActionEnabled: true,
        actorEnhancementEnabled: true,
        embyEnabled: true,
        embyRecognitionEnabled: true,
        embyLibraryStatusEnabled: true,
        embyRealtimeCheckEnabled: true,
        privacyScreenshotModeEnabled: true,
        privacyPrivateModeEnabled: true,
        contentFilterEnabled: true,
        anchorOptimizationEnabled: true,
        passwordHelperEnabled: true,
        superRankingEnabled: true,
        insightsAutoMonthlyEnabled: true,
        githubProxyEnabled: true,
      },
      metrics: {
        viewedCountBucket: '10-49',
        actorCountBucket: '50-99',
        newWorksSubscriptionCountBucket: '1-9',
        enabledSearchEngineCountBucket: '10-49',
        enabledExternalSearchEngineCountBucket: '10-49',
        enabledSubtitleSearchEngineCountBucket: '1-9',
        enabledOnlineAvailabilitySiteCountBucket: '1-9',
        enabledMagnetSourceCountBucket: '1-9',
      },
    }));
    expect(Object.keys(payload.features)).toEqual(TELEMETRY_FEATURE_CATALOG.map((feature) => feature.key));
    expect(JSON.stringify(payload)).not.toContain('sensitive-user');
    expect(JSON.stringify(payload)).not.toContain('sensitive-password');
    expect(JSON.stringify(payload)).not.toContain('sensitive-115-token');
    expect(JSON.stringify(payload)).not.toContain('sensitive-ai-key');
    expect(JSON.stringify(payload)).not.toContain('Title 1');
    expect(JSON.stringify(payload)).not.toContain('Actor 1');
  });

  it('uses the latest settings Device ID while preserving telemetry installId', async () => {
    const { buildTelemetryPayload } = await import('../../apps/extension/src/features/telemetry');

    const payload = await buildTelemetryPayload({
      event: 'heartbeat',
      settings: {
        ...DEFAULT_SETTINGS,
        webdav: {
          ...DEFAULT_SETTINGS.webdav,
          clientId: 'new-settings-device-id',
        },
        telemetry: {
          enabled: true,
          endpoint: 'https://telemetry.example.invalid/v1/telemetry/report',
          channel: 'stable',
        },
      },
      state: {
        installId: 'persisted-telemetry-install-id',
        sessionId: 'session-test',
        sessionStartedAt: '2026-05-26T01:00:00.000Z',
      },
      now: new Date('2026-05-26T02:00:00.000Z'),
      runtime: {
        version: '1.20.2',
        build: 68,
        browser: 'Chrome',
        browserVersion: '125',
        platform: 'windows',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
    });

    expect(payload.deviceId).toBe('new-settings-device-id');
    expect(payload.installId).toBe('persisted-telemetry-install-id');
  });

  it('does not report an install-prefixed telemetry ID as the real Device ID when settings Device ID is missing', async () => {
    const { buildTelemetryPayload } = await import('../../apps/extension/src/features/telemetry');

    const payload = await buildTelemetryPayload({
      event: 'heartbeat',
      settings: {
        ...DEFAULT_SETTINGS,
        webdav: {
          ...DEFAULT_SETTINGS.webdav,
          clientId: '',
        },
        telemetry: {
          enabled: true,
          endpoint: 'https://telemetry.example.invalid/v1/telemetry/report',
          channel: 'stable',
        },
      },
      state: {
        installId: 'install-8c1a06f9-d196-4471-97c2-989ddab243fa',
        sessionId: 'session-test',
        sessionStartedAt: '2026-05-26T01:00:00.000Z',
      },
      now: new Date('2026-05-26T02:00:00.000Z'),
      runtime: {
        version: '1.20.2',
      },
    });

    expect(payload.deviceId).toBeUndefined();
    expect(payload.installId).toBe('install-8c1a06f9-d196-4471-97c2-989ddab243fa');
  });
});

describe('telemetry reporter', () => {
  beforeEach(() => {
    setChromeStorage({
      [SERVER_ENDPOINT_STATE_KEY]: {
        apiBaseUrl: 'https://jbd-server.we-together.club',
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    });
  });

  it('does not schedule heartbeat alarms while the endpoint is empty', async () => {
    const { TELEMETRY_HEARTBEAT_ALARM, syncTelemetryHeartbeatAlarm } = await import('../../apps/extension/src/features/telemetry');

    syncTelemetryHeartbeatAlarm({
      telemetry: {
        enabled: true,
        endpoint: '',
        channel: 'stable',
      },
    });

    expect(chrome.alarms.clear).toHaveBeenCalledWith(TELEMETRY_HEARTBEAT_ALARM);
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('schedules heartbeat alarms every 6 hours when reporting is configured', async () => {
    const { TELEMETRY_HEARTBEAT_ALARM, syncTelemetryHeartbeatAlarm } = await import('../../apps/extension/src/features/telemetry');

    syncTelemetryHeartbeatAlarm({
      telemetry: {
        enabled: true,
        endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
        channel: 'stable',
      },
    });

    expect(chrome.alarms.create).toHaveBeenCalledWith(TELEMETRY_HEARTBEAT_ALARM, {
      delayInMinutes: 360,
      periodInMinutes: 360,
    });
  });

  it('allows another heartbeat after 6 hours', async () => {
    const { reportTelemetryEvent, TELEMETRY_CLIENT_STATE_KEY } = await import('../../apps/extension/src/features/telemetry');
    setChromeStorage({
      [TELEMETRY_CLIENT_STATE_KEY]: {
        installId: 'persisted-install-id',
        sessionId: 'session-existing',
        sessionStartedAt: '2026-05-26T00:00:00.000Z',
        lastHeartbeatAt: Date.parse('2026-05-26T00:00:00.000Z'),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await reportTelemetryEvent('heartbeat', {
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: true,
          endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T06:00:00.000Z'),
    });

    expect(result).toEqual({ sent: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes the default telemetry endpoint through the server endpoint resolver', async () => {
    const { reportTelemetryEvent, TELEMETRY_CLIENT_STATE_KEY } = await import('../../apps/extension/src/features/telemetry');
    setChromeStorage({
      [SERVER_ENDPOINT_STATE_KEY]: {
        apiBaseUrl: 'https://resolved-api.example',
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      [TELEMETRY_CLIENT_STATE_KEY]: {
        installId: 'persisted-install-id',
        sessionId: 'session-existing',
        sessionStartedAt: '2026-05-26T00:00:00.000Z',
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await reportTelemetryEvent('heartbeat', {
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: true,
          endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T06:00:00.000Z'),
    });

    expect(result).toEqual({ sent: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://resolved-api.example/v1/telemetry/report',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports immediately for dashboard open even when heartbeat was just sent', async () => {
    const { reportTelemetryForDashboardOpen, TELEMETRY_CLIENT_STATE_KEY } = await import('../../apps/extension/src/features/telemetry');
    setChromeStorage({
      [TELEMETRY_CLIENT_STATE_KEY]: {
        installId: 'persisted-install-id',
        sessionId: 'session-existing',
        sessionStartedAt: '2026-05-26T00:00:00.000Z',
        lastHeartbeatAt: Date.parse('2026-05-26T02:59:00.000Z'),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await reportTelemetryForDashboardOpen({
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: true,
          endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T03:00:00.000Z'),
    });

    expect(result).toEqual({ sent: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles dashboard open runtime messages silently', async () => {
    const { handleTelemetryRuntimeMessage, TELEMETRY_DASHBOARD_OPEN_MESSAGE } = await import('../../apps/extension/src/features/telemetry');
    const reporter = vi.fn().mockResolvedValue({ sent: true, status: 200 });
    const sendResponse = vi.fn();

    const handled = handleTelemetryRuntimeMessage(
      { type: TELEMETRY_DASHBOARD_OPEN_MESSAGE },
      sendResponse,
      reporter,
    );
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('skips reporting when telemetry is disabled', async () => {
    const { reportTelemetryEvent } = await import('../../apps/extension/src/features/telemetry');
    const fetchMock = vi.fn();

    const result = await reportTelemetryEvent('startup', {
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: false,
          endpoint: 'https://telemetry.example.invalid/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T02:00:00.000Z'),
    });

    expect(result).toEqual({ sent: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips reporting when endpoint is empty', async () => {
    const { reportTelemetryEvent } = await import('../../apps/extension/src/features/telemetry');
    const fetchMock = vi.fn();

    const result = await reportTelemetryEvent('startup', {
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: true,
          endpoint: '',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T02:00:00.000Z'),
    });

    expect(result).toEqual({ sent: false, reason: 'missing-endpoint' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently handles server failures', async () => {
    const { reportTelemetryEvent } = await import('../../apps/extension/src/features/telemetry');
    const fetchMock = vi.fn().mockRejectedValue(new Error('server is still in development'));

    const result = await reportTelemetryEvent('heartbeat', {
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: true,
          endpoint: 'https://telemetry.example.invalid/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T02:00:00.000Z'),
    });

    expect(result).toEqual({ sent: false, reason: 'network-error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports sanitized error payloads without touching heartbeat throttling', async () => {
    const { reportTelemetryError, TELEMETRY_CLIENT_STATE_KEY } = await import('../../apps/extension/src/features/telemetry');
    setChromeStorage({
      [TELEMETRY_CLIENT_STATE_KEY]: {
        installId: 'persisted-telemetry-install-id',
        sessionId: 'session-existing',
        sessionStartedAt: '2026-05-26T00:00:00.000Z',
        lastHeartbeatAt: Date.parse('2026-05-26T02:59:00.000Z'),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const error = new TypeError('failed https://javdb.com/v/ABC token=secret magnet:?xt=urn:btih:abcdef');
    error.stack = [
      'TypeError: failed https://javdb.com/v/ABC token=secret',
      '    at fetchActor (chrome-extension://test-runtime/background.js:11:22)',
      '    at https://javdb.com/v/ABC:33:44',
    ].join('\n');

    const result = await reportTelemetryError({
      component: 'background',
      code: 'ACTOR_REMARKS_FETCH_FAILED',
      error,
      fatal: false,
    }, {
      settings: {
        ...DEFAULT_SETTINGS,
        webdav: {
          ...DEFAULT_SETTINGS.webdav,
          clientId: 'settings-device-id',
        },
        telemetry: {
          enabled: true,
          endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T03:00:00.000Z'),
    });

    expect(result).toEqual({ sent: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentPayload).toEqual(expect.objectContaining({
      event: 'error_report',
      deviceId: 'settings-device-id',
      installId: 'persisted-telemetry-install-id',
      error: {
        component: 'background',
        code: 'ACTOR_REMARKS_FETCH_FAILED',
        message: 'TypeError',
        stackHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
        fatal: false,
      },
    }));
    expect(JSON.stringify(sentPayload)).not.toContain('javdb.com');
    expect(JSON.stringify(sentPayload)).not.toContain('token=secret');
    expect(JSON.stringify(sentPayload)).not.toContain('magnet:');
    expect(getChromeStorageSnapshot()[TELEMETRY_CLIENT_STATE_KEY].lastHeartbeatAt)
      .toBe(Date.parse('2026-05-26T02:59:00.000Z'));
  });

  it('throttles duplicate telemetry errors by stack hash', async () => {
    const { reportTelemetryError } = await import('../../apps/extension/src/features/telemetry');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const settings = {
      ...DEFAULT_SETTINGS,
      telemetry: {
        enabled: true,
        endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
        channel: 'stable',
      },
    };
    const error = new Error('same private message');
    error.stack = 'Error: same private message\n    at run (chrome-extension://test-runtime/background.js:1:2)';

    const first = await reportTelemetryError({
      component: 'background',
      code: 'DUPLICATE_ERROR',
      error,
      fatal: false,
    }, {
      settings,
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T03:00:00.000Z'),
    });
    const second = await reportTelemetryError({
      component: 'background',
      code: 'DUPLICATE_ERROR',
      error,
      fatal: false,
    }, {
      settings,
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T03:01:00.000Z'),
    });

    expect(first).toEqual({ sent: true, status: 200 });
    expect(second).toEqual({ sent: false, reason: 'throttled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not consume duplicate error throttle while telemetry is disabled', async () => {
    const { reportTelemetryError } = await import('../../apps/extension/src/features/telemetry');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const error = new Error('same private message');
    error.stack = 'Error: same private message\n    at run (chrome-extension://test-runtime/background.js:1:2)';

    const disabled = await reportTelemetryError({
      component: 'background',
      code: 'TEMPORARILY_DISABLED_ERROR',
      error,
      fatal: false,
    }, {
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: false,
          endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T03:00:00.000Z'),
    });
    const enabled = await reportTelemetryError({
      component: 'background',
      code: 'TEMPORARILY_DISABLED_ERROR',
      error,
      fatal: false,
    }, {
      settings: {
        ...DEFAULT_SETTINGS,
        telemetry: {
          enabled: true,
          endpoint: 'https://jbd-server.we-together.club/v1/telemetry/report',
          channel: 'stable',
        },
      },
      fetchImpl: fetchMock,
      now: new Date('2026-05-26T03:01:00.000Z'),
    });

    expect(disabled).toEqual({ sent: false, reason: 'disabled' });
    expect(enabled).toEqual({ sent: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles error report runtime messages silently', async () => {
    const { handleTelemetryRuntimeMessage, TELEMETRY_ERROR_REPORT_MESSAGE } = await import('../../apps/extension/src/features/telemetry');
    const reporter = vi.fn().mockResolvedValue({ sent: true, status: 200 });
    const sendResponse = vi.fn();

    const handled = handleTelemetryRuntimeMessage(
      {
        type: TELEMETRY_ERROR_REPORT_MESSAGE,
        payload: {
          component: 'content',
          code: 'CONTENT_UNHANDLED_ERROR',
          message: 'TypeError',
          stackHash: 'sha256-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          fatal: false,
        },
      },
      sendResponse,
      {
        errorReporter: reporter,
      },
    );
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(reporter).toHaveBeenCalledWith({
      component: 'content',
      code: 'CONTENT_UNHANDLED_ERROR',
      message: 'TypeError',
      stackHash: 'sha256-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      fatal: false,
    });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});
