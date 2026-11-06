/**
 * @file networkTestSettingsModel.test.ts
 * @description 网络配置设置模型测试
 * @module apps/dashboard/pages/settings/networkTest
 */
import { describe, expect, it } from 'vitest';
import {
  addJavdbRoute,
  applyNetworkTestFormToSettings,
  buildRouteListItems,
  DEFAULT_NETWORK_TEST_FORM,
  DEFAULT_ROUTES,
  deleteJavdbRoute,
  formatLastTestTime,
  formatLatencyLabel,
  getLatencyLevel,
  getPreferredUrl,
  getPriorityText,
  getProxyBaseUrl,
  mapSettingsToNetworkTestForm,
  resetDefaultRoutes,
  stampEditedJavdbRoutes,
  setPreferredJavdbRoute,
  toggleJavdbRoute,
  validateNetworkTestForm,
} from './networkTestSettingsModel';

describe('networkTestSettingsModel', () => {
  it('defaults match legacy NetworkTestSettings', () => {
    expect(DEFAULT_NETWORK_TEST_FORM.githubEnabled).toBe(true);
    expect(DEFAULT_NETWORK_TEST_FORM.proxyService).toBe('ghproxy');
    expect(DEFAULT_NETWORK_TEST_FORM.routes.javdb.primary).toBe('https://javdb.com');
    expect(DEFAULT_ROUTES.javdb.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_ROUTES.javdb.alternatives.some((r) => r.url === 'https://javdb575.com')).toBe(true);
  });

  it('maps empty settings to defaults', () => {
    const form = mapSettingsToNetworkTestForm(undefined);
    expect(form.githubEnabled).toBe(true);
    expect(form.proxyService).toBe('ghproxy');
    expect(form.routes.javdb.primary).toBe('https://javdb.com');
  });

  it('maps stored networkAcceleration and routes', () => {
    const form = mapSettingsToNetworkTestForm({
      networkAcceleration: {
        github: {
          enabled: false,
          proxyService: 'jsdelivr',
          customProxyUrl: 'https://proxy.example/',
        },
      },
      routes: {
        javdb: {
          primary: 'https://javdb.com',
          preferredUrl: 'https://javdb570.com',
          updatedAt: 1234,
          alternatives: [
            {
              url: 'https://javdb570.com',
              enabled: true,
              description: '备用',
              addedAt: 1,
            },
          ],
        },
        javbus: {
          primary: 'https://www.javbus.com',
          alternatives: [],
        },
      },
    } as any);

    expect(form.githubEnabled).toBe(false);
    expect(form.proxyService).toBe('jsdelivr');
    expect(form.customProxyUrl).toBe('https://proxy.example/');
    expect(form.routes.javdb.preferredUrl).toBe('https://javdb570.com');
    expect(form.routes.javdb.updatedAt).toBe(1234);
    expect(form.routes.javdb.alternatives).toHaveLength(1);
    expect((applyNetworkTestFormToSettings({} as any, form) as any).routes.javdb.updatedAt).toBe(1234);
  });

  it('timestamps real JavDB edits monotonically and leaves JavBus unchanged', () => {
    const previous = { ...DEFAULT_ROUTES, javdb: { ...DEFAULT_ROUTES.javdb, updatedAt: 2000 } };
    const edited = { ...previous, javdb: { ...previous.javdb, preferredUrl: 'https://javdb575.com' } };
    const result = stampEditedJavdbRoutes(previous, edited, 1500);
    expect(result.javdb.updatedAt).toBe(2001);
    expect(result.javbus).toEqual(previous.javbus);
    expect(stampEditedJavdbRoutes(previous, previous, 4000).javdb.updatedAt).toBe(2000);
  });

  it('saving unrelated settings preserves a newer route pulled while the form was open', () => {
    const current = { routes: { javdb: { ...DEFAULT_ROUTES.javdb, preferredUrl: 'https://javdb580.com', updatedAt: 3000 }, javbus: DEFAULT_ROUTES.javbus } } as any;
    const form = { ...DEFAULT_NETWORK_TEST_FORM, routes: { ...DEFAULT_ROUTES, javdb: { ...DEFAULT_ROUTES.javdb, preferredUrl: 'https://javdb575.com', updatedAt: 1000 } }, githubEnabled: false };
    expect((applyNetworkTestFormToSettings(current, form) as any).routes.javdb.preferredUrl).toBe('https://javdb580.com');
  });

  it('applies form into networkAcceleration and routes', () => {
    const next = applyNetworkTestFormToSettings({} as any, {
      ...DEFAULT_NETWORK_TEST_FORM,
      githubEnabled: false,
      proxyService: 'custom',
      customProxyUrl: 'https://my-proxy/',
    });
    expect((next as any).networkAcceleration.github.enabled).toBe(false);
    expect((next as any).networkAcceleration.github.proxyService).toBe('custom');
    expect((next as any).routes.javdb.primary).toBe('https://javdb.com');
  });

  it('resolves proxy base urls', () => {
    expect(getProxyBaseUrl('ghproxy', '')).toBe('https://ghproxy.com/');
    expect(getProxyBaseUrl('custom', 'https://x/')).toBe('https://x/');
  });

  it('builds route list with preferred first', () => {
    const routes = {
      primary: 'https://javdb.com',
      preferredUrl: 'https://alt.com',
      alternatives: [
        { url: 'https://alt.com', enabled: true, description: 'A', addedAt: 1 },
        { url: 'https://other.com', enabled: false, description: 'B', addedAt: 2 },
      ],
    };
    const items = buildRouteListItems(routes);
    expect(items[0].url).toBe('https://alt.com');
    expect(getPreferredUrl(routes)).toBe('https://alt.com');
  });

  it('adds / toggles / prefers / deletes routes', () => {
    let routes = DEFAULT_ROUTES;
    const added = addJavdbRoute(routes, 'https://new-route.example', '新线路');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    routes = added.routes;
    expect(routes.javdb.alternatives.some((r) => r.url === 'https://new-route.example')).toBe(
      true,
    );

    const dup = addJavdbRoute(routes, 'https://javdb.com', '');
    expect(dup.ok).toBe(false);

    const invalid = addJavdbRoute(routes, 'not-a-url', '');
    expect(invalid.ok).toBe(false);

    const toggled = toggleJavdbRoute(routes, 'https://new-route.example', false);
    expect(toggled?.javdb.alternatives.find((r) => r.url === 'https://new-route.example')?.enabled).toBe(
      false,
    );

    const preferred = setPreferredJavdbRoute(routes, 'https://new-route.example');
    expect(preferred.javdb.preferredUrl).toBe('https://new-route.example');

    const deleted = deleteJavdbRoute(preferred, 'https://new-route.example');
    expect(
      deleted?.javdb.alternatives.some((r) => r.url === 'https://new-route.example'),
    ).toBe(false);
  });

  it('resets default routes', () => {
    const reset = resetDefaultRoutes();
    expect(reset.javdb.primary).toBe('https://javdb.com');
    expect(reset.javdb.alternatives).toHaveLength(2);
    expect(reset.javdb.alternatives[0].url).toBe('https://javdb570.com');
    expect(reset.javdb.alternatives[1].url).toBe('https://javdb575.com');
  });

  it('latency helpers', () => {
    expect(getLatencyLevel(-1)).toBe('error');
    expect(getLatencyLevel(100)).toBe('excellent');
    expect(getLatencyLevel(300)).toBe('good');
    expect(getLatencyLevel(800)).toBe('medium');
    expect(getLatencyLevel(1500)).toBe('poor');
    expect(formatLatencyLabel(-1)).toBe('失败');
    expect(formatLatencyLabel(42)).toBe('42ms');
    expect(getPriorityText('high')).toBe('高');
  });

  it('formats last test time', () => {
    expect(formatLastTestTime(null)).toBe('从未');
    expect(formatLastTestTime(new Date().toISOString())).toBe('刚刚');
  });

  it('validates custom proxy when enabled', () => {
    expect(validateNetworkTestForm(DEFAULT_NETWORK_TEST_FORM).isValid).toBe(true);
    const bad = validateNetworkTestForm({
      ...DEFAULT_NETWORK_TEST_FORM,
      proxyService: 'custom',
      customProxyUrl: '',
    });
    expect(bad.isValid).toBe(false);
  });
});
