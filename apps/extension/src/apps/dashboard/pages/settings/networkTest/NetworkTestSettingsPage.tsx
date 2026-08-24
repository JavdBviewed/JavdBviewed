/**
 * @file NetworkTestSettingsPage.tsx
 * @description 网络配置 React 全页：加速代理、线路管理、手动/批量连通性测试
 * @module apps/dashboard/pages/settings/networkTest
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { showConfirm } from '../../../../../dashboard/components/confirmModal';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  clearRouteManagerCache,
  ensureDomainConfigLoaded,
  getEnabledDomainsForBatch,
  getLastTestTimeLabel,
  getRouteLatency,
  listDomainCategories,
  resetDefaultDomains,
  runBatchDomainTest,
  runManualPingTest,
  selectAllDomains,
  setDomainEnabledInConfig,
  testAllRoutes,
  testGithubProxy,
  testSingleRoute,
  toast,
  updateRoutesFromGithub,
  type DomainProbeResult,
  type DomainStatsSnapshot,
  type PingProgressItem,
  type ProxyTestResult,
} from './networkTestSettingsActions';
import {
  addJavdbRoute,
  applyNetworkTestFormToSettings,
  buildRouteListItems,
  DEFAULT_NETWORK_TEST_FORM,
  deleteJavdbRoute,
  formatLatencyLabel,
  getLatencyLevel,
  getPreferredUrl,
  getPriorityText,
  GITHUB_PROXY_OPTIONS,
  mapSettingsToNetworkTestForm,
  resetDefaultRoutes,
  setPreferredJavdbRoute,
  toggleJavdbRoute,
  validateNetworkTestForm,
  type GithubProxyService,
  type NetworkTestSettingsFormState,
  type RoutesConfig,
} from './networkTestSettingsModel';
import './networkTestSettingsPage.css';

const AUTO_SAVE_MS = 500;

function latencyBadgeClass(level: ReturnType<typeof getLatencyLevel>): string {
  switch (level) {
    case 'excellent':
      return 'text-[var(--color-success,#1e8e3e)]';
    case 'good':
      return 'text-[var(--color-primary,#2563eb)]';
    case 'medium':
      return 'text-[var(--color-warning,#d97706)]';
    case 'poor':
    case 'error':
      return 'text-[var(--color-danger,#c0392b)]';
    default:
      return 'text-[var(--color-fg-muted)]';
  }
}

/**
 * 网络配置完整页面
 */
export function NetworkTestSettingsPage() {
  const [form, setForm] = useState<NetworkTestSettingsFormState>(DEFAULT_NETWORK_TEST_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 线路输入
  const [newRouteUrl, setNewRouteUrl] = useState('');
  const [newRouteDesc, setNewRouteDesc] = useState('');
  const [routeLatencyMap, setRouteLatencyMap] = useState<Record<string, number>>({});
  const [testingRouteUrl, setTestingRouteUrl] = useState<string | null>(null);
  const [testingAllRoutes, setTestingAllRoutes] = useState(false);
  const [updatingRoutes, setUpdatingRoutes] = useState(false);

  // 代理测试
  const [testingProxy, setTestingProxy] = useState(false);
  const [proxyResult, setProxyResult] = useState<ProxyTestResult | null>(null);

  // 手动 ping
  const [pingUrl, setPingUrl] = useState('https://javdb.com');
  const [pinging, setPinging] = useState(false);
  const [pingItems, setPingItems] = useState<PingProgressItem[]>([]);
  const [showPingResults, setShowPingResults] = useState(false);

  // 批量域名
  const [domainStats, setDomainStats] = useState<DomainStatsSnapshot>({ total: 0, enabled: 0 });
  const [lastTestLabel, setLastTestLabel] = useState('从未');
  const [showDomainConfig, setShowDomainConfig] = useState(false);
  const [domainConfigTick, setDomainConfigTick] = useState(0);
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchResults, setBatchResults] = useState<DomainProbeResult[]>([]);
  const [batchVisible, setBatchVisible] = useState(false);
  const [batchTitle, setBatchTitle] = useState('');

  const persist = useCallback(async (nextForm: NetworkTestSettingsFormState) => {
    const v = validateNetworkTestForm(nextForm);
    if (!v.isValid) {
      setSaveError(v.errors[0] || '校验失败');
      return;
    }
    try {
      const current = await getSettings();
      const next = applyNetworkTestFormToSettings(current, nextForm);
      await saveSettings(next);
      await syncDashboardState(next);
      setSaveError(null);
    } catch (err) {
      console.error('[NetworkTestSettingsPage] save failed', err);
      setSaveError(err instanceof Error ? err.message : '保存失败');
    }
  }, []);

  const { scheduleSave, flush } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  const hydrateLatencies = useCallback((routes: RoutesConfig) => {
    const map: Record<string, number> = {};
    const items = buildRouteListItems(routes.javdb);
    for (const item of items) {
      const lat = getRouteLatency(item.url);
      if (lat !== null) map[item.url] = lat;
    }
    setRouteLatencyMap(map);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        const mapped = mapSettingsToNetworkTestForm(settings);
        setForm(mapped);
        hydrateLatencies(mapped.routes);
        const stats = ensureDomainConfigLoaded();
        setDomainStats(stats);
        setLastTestLabel(getLastTestTimeLabel());
      } catch (err) {
        console.error('[NetworkTestSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateLatencies]);

  const formRef = useRef(form);
  formRef.current = form;

  const updateGithub = useCallback(
    <K extends 'githubEnabled' | 'proxyService' | 'customProxyUrl'>(
      key: K,
      value: NetworkTestSettingsFormState[K],
    ) => {
      const next = { ...formRef.current, [key]: value };
      formRef.current = next;
      setForm(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const commitRoutes = useCallback(
    async (routes: RoutesConfig, options?: { immediate?: boolean }) => {
      const next = { ...formRef.current, routes };
      formRef.current = next;
      setForm(next);
      if (options?.immediate) {
        void flush(next);
      } else {
        scheduleSave(next);
      }
      hydrateLatencies(routes);
    },
    [flush, hydrateLatencies, scheduleSave],
  );

  const routeItems = useMemo(
    () => buildRouteListItems(form.routes.javdb),
    [form.routes.javdb],
  );
  const preferredUrl = useMemo(
    () => getPreferredUrl(form.routes.javdb),
    [form.routes.javdb],
  );

  const domainCategories = useMemo(() => {
    void domainConfigTick;
    return listDomainCategories();
  }, [domainConfigTick]);

  // ---- handlers ----

  const onTestProxy = async () => {
    setTestingProxy(true);
    setProxyResult(null);
    try {
      const result = await testGithubProxy(form.proxyService, form.customProxyUrl);
      setProxyResult(result);
      await toast(
        result.proxyOk ? '代理测试完成' : '代理测试失败',
        result.proxyOk ? 'success' : 'error',
      );
    } catch (err) {
      console.error('[NetworkTestSettingsPage] proxy test failed', err);
      await toast('代理测试失败', 'error');
    } finally {
      setTestingProxy(false);
    }
  };

  const onAddRoute = async () => {
    const result = addJavdbRoute(form.routes, newRouteUrl, newRouteDesc);
    if (!result.ok) {
      await toast(result.error, result.error.includes('格式') ? 'error' : 'warning');
      return;
    }
    await commitRoutes(result.routes, { immediate: true });
    setNewRouteUrl('');
    setNewRouteDesc('');
    await toast('线路添加成功', 'success');
  };

  const onToggleRoute = async (url: string, enabled: boolean) => {
    const next = toggleJavdbRoute(form.routes, url, enabled);
    if (!next) return;
    await commitRoutes(next, { immediate: true });
    await toast(enabled ? `已启用 ${url}` : `已禁用 ${url}`, 'success');
  };

  const onSetPreferred = async (url: string) => {
    const next = setPreferredJavdbRoute(form.routes, url);
    await commitRoutes(next, { immediate: true });
    await clearRouteManagerCache('javdb');
    await toast(`已将 ${url} 设为首选线路`, 'success');
  };

  const onDeleteRoute = async (url: string) => {
    const confirmed = await showConfirm({
      title: '删除访问线路',
      message: '确定要删除这条线路吗？',
      type: 'danger',
      confirmText: '删除',
    });
    if (!confirmed) return;
    const next = deleteJavdbRoute(form.routes, url);
    if (!next) return;
    await commitRoutes(next, { immediate: true });
    await toast('线路已删除', 'success');
  };

  const onTestRoute = async (url: string) => {
    setTestingRouteUrl(url);
    try {
      const result = await testSingleRoute(url);
      setRouteLatencyMap((prev) => ({
        ...prev,
        [url]: result.success ? result.latency : -1,
      }));
      if (result.success) {
        await toast(`线路可用，延迟 ${result.latency}ms`, 'success');
      } else {
        await toast(`线路不可用，耗时 ${result.latency}ms`, 'error');
      }
    } finally {
      setTestingRouteUrl(null);
    }
  };

  const onTestAllRoutes = async () => {
    setTestingAllRoutes(true);
    try {
      const urls = buildRouteListItems(form.routes.javdb).map((r) => r.url);
      await toast(`开始测试 ${urls.length} 条线路...`, 'info');
      const results = await testAllRoutes(urls);
      const map: Record<string, number> = {};
      for (const r of results) {
        map[r.url] = r.success ? r.latency : -1;
      }
      setRouteLatencyMap((prev) => ({ ...prev, ...map }));
      await toast('线路测试完成', 'success');
    } finally {
      setTestingAllRoutes(false);
    }
  };

  const onUpdateRoutesFromGithub = async () => {
    setUpdatingRoutes(true);
    try {
      const result = await updateRoutesFromGithub();
      if (result.updated) {
        const settings = await getSettings();
        const mapped = mapSettingsToNetworkTestForm(settings);
        setForm(mapped);
        hydrateLatencies(mapped.routes);
        await toast(result.message, 'success');
      } else {
        await toast(result.message, 'info');
      }
    } catch (err) {
      console.error('[NetworkTestSettingsPage] update routes failed', err);
      await toast(
        `更新失败: ${err instanceof Error ? err.message : '未知错误'}`,
        'error',
      );
    } finally {
      setUpdatingRoutes(false);
    }
  };

  const onResetRoutes = async () => {
    const confirmed = await showConfirm({
      title: '恢复默认线路',
      message: '确定要恢复默认线路配置吗？这将清除所有自定义线路。',
      type: 'warning',
      confirmText: '恢复默认',
    });
    if (!confirmed) return;
    const routes = resetDefaultRoutes();
    await commitRoutes(routes, { immediate: true });
    await toast('已恢复默认线路配置', 'success');
  };

  const onPing = async () => {
    setPinging(true);
    setShowPingResults(true);
    setPingItems([]);
    try {
      await runManualPingTest(pingUrl, (item) => {
        setPingItems((prev) => {
          // 去掉同 url 的 progress 占位
          if (item.kind === 'reply' || item.kind === 'failure' || item.kind === 'summary') {
            const filtered = prev.filter((p) => p.kind !== 'progress');
            return [...filtered, item];
          }
          return [...prev, item];
        });
      });
    } finally {
      setPinging(false);
    }
  };

  const runDomainBatch = async (mode: 'all' | 'core') => {
    const domains = getEnabledDomainsForBatch(mode);
    if (domains.length === 0) {
      await toast(
        mode === 'core' ? '没有启用的核心域名需要测试' : '没有启用的域名需要测试',
        'warning',
      );
      return;
    }
    setBatchTesting(true);
    setBatchVisible(true);
    setBatchResults([]);
    setBatchProgress({ completed: 0, total: domains.length });
    setBatchTitle(mode === 'core' ? '核心域名' : '所有域名');
    await toast(`开始测试 ${domains.length} 个${mode === 'core' ? '核心' : ''}域名...`, 'info');

    try {
      const { successCount } = await runBatchDomainTest(domains, ({ completed, total, result }) => {
        setBatchProgress({ completed, total });
        setBatchResults((prev) => [...prev, result]);
      });
      setLastTestLabel(getLastTestTimeLabel());
      const rate = ((successCount / domains.length) * 100).toFixed(1);
      await toast(
        `测试完成！成功: ${successCount}/${domains.length} (${rate}%)`,
        successCount === domains.length ? 'success' : 'warning',
      );
    } catch (err) {
      console.error('[NetworkTestSettingsPage] batch test failed', err);
      await toast(mode === 'core' ? '测试核心域名失败' : '测试所有域名失败', 'error');
    } finally {
      setBatchTesting(false);
    }
  };

  const onClearBatch = async () => {
    setBatchResults([]);
    setBatchVisible(false);
    setBatchProgress({ completed: 0, total: 0 });
    await toast('批量测试结果已清空', 'success');
  };

  const onToggleDomainEnabled = (categoryKey: string, index: number, enabled: boolean) => {
    const stats = setDomainEnabledInConfig(categoryKey, index, enabled);
    setDomainStats(stats);
    setDomainConfigTick((t) => t + 1);
  };

  const onSelectAllDomains = async (enabled: boolean) => {
    const stats = selectAllDomains(enabled);
    setDomainStats(stats);
    setDomainConfigTick((t) => t + 1);
    await toast(enabled ? '已全选所有域名' : '已取消选择所有域名', 'success');
  };

  const onResetDomains = async () => {
    const stats = resetDefaultDomains();
    setDomainStats(stats);
    setDomainConfigTick((t) => t + 1);
    await toast('已恢复默认域名配置', 'success');
  };

  const batchGrouped = useMemo(() => {
    const map = new Map<string, DomainProbeResult[]>();
    for (const r of batchResults) {
      const list = map.get(r.categoryLabel) || [];
      list.push(r);
      map.set(r.categoryLabel, list);
    }
    return Array.from(map.entries());
  }, [batchResults]);

  const batchSuccessCount = batchResults.filter((r) => r.success).length;
  const batchFailureCount = batchResults.length - batchSuccessCount;

  return (
    <SettingsPageFrame
      className="network-test-settings-react"
      title="网络配置"
      description="配置网络加速和测试拓展涉及的所有外部服务的网络连通性。"
      rootDataAttrs={{ 'data-network-test-settings-react': '1' }}
      pageId="network-test-settings"
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="network-test-settings">
          {/* 网络加速 */}
          <SettingSection
            className="network-test-section"
            title="网络加速配置"
            icon={<i className="fas fa-rocket" />}
            description="配置 GitHub 等服务的加速代理，提升文件下载速度"
          >
            <SettingToggleRow
              id="enable-github-proxy"
              label={
                <>
                  <i className="fab fa-github" aria-hidden="true" /> 启用 GitHub 文件下载加速
                </>
              }
              description="启用后，从 GitHub 仓库下载文件时将自动使用加速代理"
              checked={form.githubEnabled}
              onChange={(c) => updateGithub('githubEnabled', c)}
            />
            <div id="github-proxy-config" className="network-test-form-group">
              <SettingField id="github-proxy-service" label="选择加速服务">
                <SettingSelect
                  id="github-proxy-service"
                  value={form.proxyService}
                  disabled={!form.githubEnabled}
                  options={GITHUB_PROXY_OPTIONS}
                  onChange={(v) => updateGithub('proxyService', v as GithubProxyService)}
                />
              </SettingField>
            </div>
            <div
              id="custom-proxy-url-group"
              className="network-test-form-group network-test-custom-proxy"
              hidden={form.proxyService !== 'custom'}
            >
              <SettingField
                id="custom-proxy-url"
                label="自定义代理地址"
                description="代理地址格式：https://proxy.com/ （需要以 / 结尾）"
              >
                <div className="network-test-input-with-icon">
                  <i className="fas fa-link" aria-hidden="true" />
                  <Input
                    id="custom-proxy-url"
                    type="text"
                    disabled={!form.githubEnabled}
                    placeholder="例如: https://your-proxy.com/"
                    value={form.customProxyUrl}
                    onChange={(e) => updateGithub('customProxyUrl', e.currentTarget.value)}
                  />
                </div>
              </SettingField>
            </div>
            <div className="network-test-button-group flex flex-wrap gap-2 px-2 py-2">
              <Button
                id="test-github-proxy"
                variant="secondary"
                disabled={!form.githubEnabled || testingProxy}
                onClick={() => void onTestProxy()}
              >
                <i className="fas fa-vial" aria-hidden="true" />{' '}
                {testingProxy ? '测试中…' : '测试加速效果'}
              </Button>
            </div>
            <div
              id="proxy-test-results"
              hidden={!proxyResult}
              className="network-test-results-box mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-[13px]"
              role="status"
            >
              {proxyResult ? (
                <>
                <p className="m-0 mb-2 font-medium text-[var(--color-fg)]">测试结果</p>
                <p
                  className={
                    proxyResult.direct.success
                      ? 'm-0 text-[var(--color-success,#1e8e3e)]'
                      : 'm-0 text-[var(--color-danger,#c0392b)]'
                  }
                >
                  直连: {proxyResult.direct.success ? `${proxyResult.direct.latency}ms` : '失败'}
                </p>
                <p
                  className={
                    proxyResult.proxy.success
                      ? 'm-0 text-[var(--color-success,#1e8e3e)]'
                      : 'm-0 text-[var(--color-danger,#c0392b)]'
                  }
                >
                  代理: {proxyResult.proxy.success ? `${proxyResult.proxy.latency}ms` : '失败'}
                </p>
                {proxyResult.summary ? (
                  <p
                    className={
                      proxyResult.summaryTone === 'success'
                        ? 'm-0 mt-2 text-[var(--color-success,#1e8e3e)]'
                        : proxyResult.summaryTone === 'error'
                          ? 'm-0 mt-2 text-[var(--color-danger,#c0392b)]'
                          : proxyResult.summaryTone === 'warning'
                            ? 'm-0 mt-2 text-[var(--color-warning,#d97706)]'
                            : 'm-0 mt-2 text-[var(--color-fg-muted)]'
                    }
                  >
                    {proxyResult.summary}
                  </p>
                ) : null}
                </>
              ) : (
                <span className="sr-only">点击测试按钮查看代理测试结果</span>
              )}
            </div>
          </SettingSection>

          {/* 线路管理 */}
          <SettingSection
            className="network-test-section"
            title="线路管理"
            icon={<i className="fas fa-route" />}
            description="管理 JavDB 的访问线路，支持添加自定义域名并设置首选线路"
          >
            <div className="network-test-route-warning mx-2 mb-3 rounded-[var(--radius-2)] border border-[var(--color-warning,#d97706)]/40 bg-[var(--color-warning,#d97706)]/10 px-3 py-2 text-[12.5px] text-[var(--color-fg)]">
              <i className="fas fa-exclamation-triangle" aria-hidden="true" />
              <strong>重要提示：</strong>
              备用域名通常为国内访问的域名。不使用 VPN 可能无法体验完整的扩展增强功能（如磁力、翻译等）。建议使用主域名
              javdb.com 以获得最佳体验。
            </div>

            <div className="network-test-routes-list flex flex-col gap-2 px-2" id="javdb-routes-list">
              {routeItems.length === 0 ? (
                <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">暂无线路</p>
              ) : (
                routeItems.map((route) => {
                  const isPreferred = route.url === preferredUrl;
                  const latency = routeLatencyMap[route.url];
                  const dimmed = !route.enabled && !route.isPrimary;
                  return (
                    <div
                      key={route.url}
                      className={
                        'network-test-route-item flex flex-col gap-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between' +
                        (isPreferred ? ' ring-1 ring-[var(--color-primary)]/40' : '') +
                        (dimmed ? ' opacity-50' : '')
                      }
                    >
                      <div className="network-test-route-info min-w-0">
                        <div className="network-test-route-url flex flex-wrap items-center gap-2 text-[13px] font-medium text-[var(--color-fg)]">
                          <span className="break-all">{route.url}</span>
                          {isPreferred ? (
                            <span className="network-test-route-preferred-badge rounded bg-[var(--color-primary)]/15 px-1.5 py-0.5 text-[11px] text-[var(--color-primary)]">
                              首选
                            </span>
                          ) : null}
                          {!route.enabled && !route.isPrimary ? (
                            <span className="network-test-route-disabled-badge rounded bg-[var(--color-fg-muted)]/15 px-1.5 py-0.5 text-[11px] text-[var(--color-fg-muted)]">
                              已禁用
                            </span>
                          ) : null}
                          {typeof latency === 'number' ? (
                            <span
                              className={`network-test-route-latency-badge latency-${getLatencyLevel(latency)} text-[11px] ${latencyBadgeClass(getLatencyLevel(latency))}`}
                            >
                              {formatLatencyLabel(latency)}
                            </span>
                          ) : null}
                        </div>
                        {route.description ? (
                          <div className="network-test-route-description mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
                            {route.description}
                          </div>
                        ) : null}
                      </div>
                      <div className="network-test-route-actions flex flex-wrap gap-1.5">
                        {!isPreferred ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void onSetPreferred(route.url)}
                          >
                            <i className="fas fa-star" aria-hidden="true" /> 设为首选
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={testingRouteUrl === route.url}
                          onClick={() => void onTestRoute(route.url)}
                        >
                          <i className="fas fa-vial" aria-hidden="true" />{' '}
                          {testingRouteUrl === route.url ? '测试中…' : '测试'}
                        </Button>
                        {!route.isPrimary ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void onToggleRoute(route.url, !route.enabled)}
                          >
                            <i className={route.enabled ? 'fas fa-toggle-off' : 'fas fa-toggle-on'} aria-hidden="true" />{' '}
                            {route.enabled ? '禁用' : '启用'}
                          </Button>
                        ) : null}
                        {!route.isPrimary ? (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void onDeleteRoute(route.url)}
                          >
                            <i className="fas fa-trash" aria-hidden="true" /> 删除
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="network-test-route-add-row mt-3 flex flex-col gap-2 px-2 sm:flex-row sm:items-end">
              <SettingField id="javdb-new-route-url" label="新线路 URL" className="flex-1">
                <Input
                  className="network-test-route-url-input"
                  id="javdb-new-route-url"
                  type="text"
                  placeholder="输入新的线路 URL，如 https://javdb570.com"
                  value={newRouteUrl}
                  onChange={(e) => setNewRouteUrl(e.currentTarget.value)}
                />
              </SettingField>
              <SettingField id="javdb-new-route-desc" label="描述（可选）" className="flex-1">
                <Input
                  className="network-test-route-desc-input"
                  id="javdb-new-route-desc"
                  type="text"
                  placeholder="描述（可选）"
                  value={newRouteDesc}
                  onChange={(e) => setNewRouteDesc(e.currentTarget.value)}
                />
              </SettingField>
              <div className="pb-1">
                <Button id="add-javdb-route" variant="secondary" onClick={() => void onAddRoute()}>
                  <i className="fas fa-plus" aria-hidden="true" /> 添加
                </Button>
              </div>
            </div>

            <div className="network-test-route-actions network-test-button-group flex flex-wrap gap-2 px-2 py-2">
              <Button
                id="test-all-routes"
                variant="secondary"
                disabled={testingAllRoutes}
                onClick={() => void onTestAllRoutes()}
              >
                <i className="fas fa-vial" aria-hidden="true" />{' '}
                {testingAllRoutes ? '测试中…' : '测试所有线路'}
              </Button>
              <Button
                id="update-routes-from-github"
                variant="primary"
                disabled={updatingRoutes}
                onClick={() => void onUpdateRoutesFromGithub()}
              >
                <i className="fas fa-sync-alt" aria-hidden="true" />{' '}
                {updatingRoutes ? '正在更新…' : '从 GitHub 更新线路'}
              </Button>
              <Button
                id="reset-default-routes"
                variant="secondary"
                onClick={() => void onResetRoutes()}
              >
                <i className="fas fa-undo" aria-hidden="true" /> 恢复默认
              </Button>
            </div>
          </SettingSection>

          {/* 手动测试 */}
          <SettingSection className="network-test-section" title="手动测试" icon={<i className="fas fa-edit" />} description="输入任意URL进行网络延迟测试">
            <div className="network-test-inline-form flex flex-col gap-2 px-2 sm:flex-row sm:items-center">
              <div className="network-test-input-with-icon flex-1">
                <i className="fas fa-link" aria-hidden="true" />
                <Input
                  id="ping-url"
                  type="text"
                  className="flex-1"
                  placeholder="例如: https://javdb.com"
                  value={pingUrl}
                  onChange={(e) => setPingUrl(e.currentTarget.value)}
                />
              </div>
              <Button
                id="start-ping-test"
                variant="primary"
                disabled={pinging}
                onClick={() => void onPing()}
              >
                <i className="fas fa-play" aria-hidden="true" />{' '}
                {pinging ? '测试中…' : '开始测试'}
              </Button>
            </div>
            <div id="ping-results-container" hidden={!showPingResults} className="network-test-ping-results mx-2 mt-3">
                <h4 className="m-0 mb-2 text-[13px] font-medium text-[var(--color-fg)]">
                  测试结果:
                </h4>
                <div id="ping-results" className="flex flex-col gap-1.5 text-[13px]">
                  {pingItems.length === 0 ? (
                    <p className="m-0 text-[var(--color-fg-muted)]">点击上方按钮开始网络测试</p>
                  ) : (
                    pingItems.map((item) => {
                      if (item.kind === 'separator') {
                        return (
                          <hr
                            key={item.id}
                            className="my-3 border-0 border-t border-[var(--color-border)]"
                          />
                        );
                      }
                      if (item.kind === 'summary' && item.stats) {
                        const s = item.stats;
                        return (
                          <div
                            key={item.id}
                            className="rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2"
                          >
                            <p className="m-0 mb-1 font-medium">{item.message}</p>
                            {s.received > 0 ? (
                              <>
                                <p className="m-0">
                                  数据包: 已发送 = {s.sent}, 已接收 = {s.received}, 丢失 ={' '}
                                  {s.lost} ({s.lossPct}% 丢失)
                                </p>
                                <p className="m-0">
                                  最短 = {s.min}ms, 最长 = {s.max}ms, 平均 = {s.avg}ms
                                </p>
                              </>
                            ) : (
                              <p className="m-0">
                                所有 ping 请求均失败。请检查 URL 或您的网络连接。
                              </p>
                            )}
                          </div>
                        );
                      }
                      const ok = item.success !== false && item.kind !== 'error' && item.kind !== 'failure';
                      return (
                        <div
                          key={item.id}
                          className={
                            ok
                              ? 'text-[var(--color-success,#1e8e3e)]'
                              : 'text-[var(--color-danger,#c0392b)]'
                          }
                        >
                          {item.message}
                          {typeof item.latency === 'number' ? `: 时间=${item.latency}ms` : ''}
                        </div>
                      );
                    })
                  )}
                </div>
            </div>
          </SettingSection>

          {/* 一键测试 */}
          <SettingSection
            className="network-test-section"
            title="一键测试"
            icon={<i className="fas fa-rocket" />}
            description="快速检测拓展涉及的所有外部服务的连通性"
          >
            <div className="network-test-domain-stats mb-3 grid grid-cols-3 gap-2 px-2 text-[12.5px]">
              <div className="network-test-stat-item rounded-[var(--radius-2)] border border-[var(--color-border)] px-2 py-2">
                <div className="text-[var(--color-fg-muted)]">总域名数</div>
                <div id="total-domains" className="font-medium text-[var(--color-fg)]">
                  {domainStats.total}
                </div>
              </div>
              <div className="network-test-stat-item rounded-[var(--radius-2)] border border-[var(--color-border)] px-2 py-2">
                <div className="text-[var(--color-fg-muted)]">已启用</div>
                <div id="enabled-domains" className="font-medium text-[var(--color-fg)]">
                  {domainStats.enabled}
                </div>
              </div>
              <div className="network-test-stat-item rounded-[var(--radius-2)] border border-[var(--color-border)] px-2 py-2">
                <div className="text-[var(--color-fg-muted)]">上次测试</div>
                <div id="last-test-time" className="font-medium text-[var(--color-fg)]">
                  {lastTestLabel}
                </div>
              </div>
            </div>

            <div className="network-test-button-group flex flex-wrap gap-2 px-2 py-2">
              <Button
                id="test-all-domains"
                variant="primary"
                disabled={batchTesting}
                onClick={() => void runDomainBatch('all')}
              >
                <i className="fas fa-vial" aria-hidden="true" />{' '}
                {batchTesting ? '测试中…' : '测试所有域名'}
              </Button>
              <Button
                id="test-core-domains"
                variant="secondary"
                disabled={batchTesting}
                onClick={() => void runDomainBatch('core')}
              >
                <i className="fas fa-bullseye" aria-hidden="true" /> 仅测试核心服务
              </Button>
              <Button
                id="toggle-domain-config"
                variant="secondary"
                onClick={() => setShowDomainConfig((v) => !v)}
              >
                <i className="fas fa-cog" aria-hidden="true" />{' '}
                {showDomainConfig ? '隐藏配置' : '配置域名'}
              </Button>
              <Button
                id="clear-batch-results"
                variant="secondary"
                onClick={() => void onClearBatch()}
              >
                <i className="fas fa-eraser" aria-hidden="true" /> 清空结果
              </Button>
            </div>

            <div
              id="domain-config-panel"
              hidden={!showDomainConfig}
              className="network-test-domain-config mx-2 mb-3 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3"
            >
                <p className="network-test-config-header m-0 mb-1 text-[13px] font-medium text-[var(--color-fg)]">
                  域名测试配置
                </p>
                <p className="m-0 mb-3 text-[12px] text-[var(--color-fg-muted)]">
                  选择要测试的服务域名，只有启用的域名会被测试
                </p>
                <div id="domain-config-content" className="network-test-domain-config-content flex flex-col gap-3">
                  {domainCategories.map((cat) => (
                    <div key={cat.key} className="domain-category-group">
                      <p className="m-0 mb-1 text-[13px] font-medium">
                        {cat.icon} {cat.name}
                      </p>
                      <p className="m-0 mb-2 text-[12px] text-[var(--color-fg-muted)]">
                        {cat.description}
                      </p>
                      <div className="flex flex-col gap-2">
                        {cat.domains.map((domain, index) => (
                          <label
                            key={`${cat.key}-${domain.domain}`}
                            className="network-test-domain-config-item flex cursor-pointer items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-[12.5px]"
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={domain.enabled}
                              onChange={(e) =>
                                onToggleDomainEnabled(cat.key, index, e.currentTarget.checked)
                              }
                            />
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5 font-medium text-[var(--color-fg)]">
                                {domain.name}
                                <span className="rounded bg-[var(--color-fg-muted)]/15 px-1 text-[10px] text-[var(--color-fg-muted)]">
                                  {getPriorityText(domain.priority)}
                                </span>
                              </span>
                              <span className="block text-[var(--color-fg-muted)]">
                                {domain.domain}
                              </span>
                              <span className="block text-[var(--color-fg-muted)]">
                                {domain.description}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="network-test-config-actions mt-3 flex flex-wrap gap-2">
                  <Button
                    id="select-all-domains"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onSelectAllDomains(true)}
                  >
                    <i className="fas fa-check-square" aria-hidden="true" /> 全选
                  </Button>
                  <Button
                    id="deselect-all-domains"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onSelectAllDomains(false)}
                  >
                    <i className="fas fa-square" aria-hidden="true" /> 全不选
                  </Button>
                  <Button
                    id="reset-default-domains"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onResetDomains()}
                  >
                    <i className="fas fa-undo" aria-hidden="true" /> 恢复默认
                  </Button>
                </div>
            </div>

            <div
              id="batch-test-results"
              hidden={!batchVisible}
              className="network-test-batch-results mx-2 rounded-[var(--radius-2)] border border-[var(--color-border)] px-3 py-3"
            >
                {batchTesting || batchResults.length > 0 ? (
                  <>
                    <div className="mb-2">
                      <p className="m-0 text-[13px] font-medium">
                        {batchTesting
                          ? `正在测试${batchTitle}...`
                          : `测试完成（${batchTitle}）`}
                      </p>
                      <div className="mt-2 h-2 overflow-hidden rounded bg-[var(--color-surface-2)]">
                        <div
                          className="h-full bg-[var(--color-primary)] transition-all"
                          style={{
                            width:
                              batchProgress.total > 0
                                ? `${(batchProgress.completed / batchProgress.total) * 100}%`
                                : '0%',
                          }}
                        />
                      </div>
                      <p className="m-0 mt-1 text-[12px] text-[var(--color-fg-muted)]">
                        {batchProgress.completed} / {batchProgress.total}
                      </p>
                    </div>

                    {!batchTesting && batchResults.length > 0 ? (
                      <div className="mb-3 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
                        <div>
                          总计: <strong>{batchResults.length}</strong>
                        </div>
                        <div className="text-[var(--color-success,#1e8e3e)]">
                          成功: <strong>{batchSuccessCount}</strong>
                        </div>
                        <div className="text-[var(--color-danger,#c0392b)]">
                          失败: <strong>{batchFailureCount}</strong>
                        </div>
                        <div>
                          成功率:{' '}
                          <strong>
                            {batchResults.length
                              ? ((batchSuccessCount / batchResults.length) * 100).toFixed(1)
                              : '0'}
                            %
                          </strong>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-2">
                      {batchGrouped.map(([label, items]) => (
                        <div key={label}>
                          <p className="m-0 mb-1 text-[12.5px] font-medium text-[var(--color-fg)]">
                            {label}
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {items.map((r) => (
                              <div
                                key={`${r.domain.domain}-${r.latency}`}
                                className={
                                  'rounded border px-2 py-1.5 text-[12.5px] ' +
                                  (r.success
                                    ? 'border-[var(--color-success,#1e8e3e)]/30 bg-[var(--color-success,#1e8e3e)]/5'
                                    : 'border-[var(--color-danger,#c0392b)]/30 bg-[var(--color-danger,#c0392b)]/5')
                                }
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1">
                                  <span className="font-medium">{r.domain.name}</span>
                                  <span>
                                    {r.success ? '可访问' : '无法访问'}
                                    {r.latency >= 0 ? ` · ${r.latency}ms` : ''}
                                  </span>
                                </div>
                                <div className="text-[var(--color-fg-muted)]">{r.domain.domain}</div>
                                {r.error ? (
                                  <div className="text-[var(--color-danger,#c0392b)]">{r.error}</div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="py-4 text-center text-[13px] text-[var(--color-fg-muted)]">
                    点击上方按钮开始批量测试
                  </div>
                )}
            </div>
          </SettingSection>

          {saveError ? (
            <p className="m-0 text-[12.5px] text-[var(--color-danger,#c0392b)]" role="alert">
              保存失败：{saveError}
            </p>
          ) : null}
        </div>
      )}
    </SettingsPageFrame>
  );
}
