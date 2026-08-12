// src/dashboard/home/charts.ts

import { dbInsViewsRange, dbTrendsRecordsRange, dbTrendsActorsRange, dbTrendsNewWorksRange, dbNewWorksDailyStatRefresh, ensureBackgroundReady } from '../dbClient';
import { aggregateMonthly } from '../../features/insights';
import { initStatsOverview, initHomeSectionsOverview } from './overview';
import { themeManager } from '../services/themeManager';
import { shouldRefreshHomeOverview } from './homeRefreshPolicy';
import { createRefreshCoordinator } from './refreshCoordinator';
import {
  loadHomeOverviewStages,
} from './homeOverviewLoader';
import { buildHomeStatusData } from './homeChartData';
import { createHomeChartRenderQueue, scheduleHomeChartRender, yieldToBrowser } from './homeRenderScheduler';
import {
  createHomeChartLifecycle,
  disposeChartRegistry,
  type HomeChartSession,
} from './homeChartLifecycle';
import { invalidateHomeStatsSnapshot, loadHomeStatsSnapshot } from './homeStatsSnapshot';
import {
  getHomeChartRenderPlan,
  readHomeChartDiagnosticConfig,
  type HomeChartRenderPlan,
} from './homeChartDiagnosticMode';
import {
  getHomeEchartsInitOptions,
  withHomeChartRenderPolicy,
} from './homeChartRenderPolicy';

function installCanvasDirectionGuard(): void {
  try {
    const w: any = window as any;
    if (w.__CANVAS_DIR_GUARD_INSTALLED__) return;
    const Ctx = (w as any).CanvasRenderingContext2D;
    if (!Ctx || !Ctx.prototype) return;
    const proto = Ctx.prototype as any;
    const desc = Object.getOwnPropertyDescriptor(proto, 'direction');
    if (!desc) return;
    const origSet = desc.set;
    const origGet = desc.get;
    const allowed = ['ltr', 'rtl', 'inherit'];
    Object.defineProperty(proto, 'direction', {
      configurable: true,
      enumerable: true,
      get: origGet ? function(this: any) { try { return origGet.call(this); } catch { return 'ltr'; } } : function(this: any) { return 'ltr'; },
      set: function(this: any, val: any) {
        try {
          const v = allowed.includes(val) ? val : 'ltr';
          if (origSet) origSet.call(this, v);
        } catch {}
      }
    });

    // 额外：在实例级别兜底，拦截 getContext('2d') 返回的 ctx 并定义安全的 direction 访问器
    const CanvasProto = (w as any).HTMLCanvasElement?.prototype;
    const origGetContext = CanvasProto && CanvasProto.getContext;
    if (CanvasProto && typeof origGetContext === 'function') {
      CanvasProto.getContext = function(this: HTMLCanvasElement, type: any, ...args: any[]) {
        const ctx: any = origGetContext.apply(this, [type, ...args]);
        try {
          if (type === '2d' && ctx) {
            const desc2 = Object.getOwnPropertyDescriptor(ctx, 'direction');
            if (!desc2 || desc2.configurable) {
              Object.defineProperty(ctx, 'direction', {
                configurable: true,
                enumerable: true,
                get() { try { return proto.direction ? (proto as any).direction : 'ltr'; } catch { return 'ltr'; } },
                set(val: any) {
                  try {
                    const v = allowed.includes(val) ? val : 'ltr';
                    if (origSet) origSet.call(ctx, v);
                  } catch { try { (ctx as any)._direction = 'ltr'; } catch {} }
                }
              });
            }
          }
        } catch {}
        return ctx;
      } as any;
    }
    w.__CANVAS_DIR_GUARD_INSTALLED__ = true;
  } catch {}
}

// 确保被动事件监听器 polyfill 已加载
let passivePolyfillLoaded = false;
async function ensurePassivePolyfill(): Promise<void> {
  if (passivePolyfillLoaded) return;
  const inject = (src: string) => new Promise<void>((resolve, reject) => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load failed'));
      (document.head || document.documentElement).appendChild(s);
    } catch { resolve(); }
  });
  try {
    await inject(chrome.runtime.getURL('assets/templates/passive-events-polyfill.js'));
    passivePolyfillLoaded = true;
  } catch {
    // 如果加载失败，标记为已加载以避免重复尝试
    passivePolyfillLoaded = true;
  }
}

let echartsLoadingPromise: Promise<any> | null = null;
async function ensureEchartsLoaded(): Promise<any> {
  const w: any = window as any;
  if (w.echarts) return w.echarts;
  if (echartsLoadingPromise) return echartsLoadingPromise.then(() => (w.echarts || null));
  const inject = (src: string) => new Promise<void>((resolve, reject) => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load failed'));
      (document.head || document.documentElement).appendChild(s);
    } catch { resolve(); }
  });
  echartsLoadingPromise = new Promise(async (resolve) => {
    // 先加载 polyfill
    await ensurePassivePolyfill();
    try { await inject(chrome.runtime.getURL('assets/templates/echarts.min.js')); }
    catch { try { await inject(chrome.runtime.getURL('assets/echarts.min.js')); } catch {} }
    resolve(void 0);
  });
  return echartsLoadingPromise.then(() => ((window as any).echarts || null));
}

let g2plotLoadingPromise: Promise<any> | null = null;
async function ensureG2PlotLoaded(): Promise<any> {
  const w: any = window as any;
  if (w.G2Plot) return w.G2Plot;
  if (g2plotLoadingPromise) return g2plotLoadingPromise.then(() => (w.G2Plot || null));
  const inject = (src: string) => new Promise<void>((resolve, reject) => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load failed'));
      (document.head || document.documentElement).appendChild(s);
    } catch { resolve(); }
  });
  g2plotLoadingPromise = new Promise(async (resolve) => {
    // 先加载 polyfill
    await ensurePassivePolyfill();
    try { await inject(chrome.runtime.getURL('assets/templates/g2plot.min.js')); }
    catch { try { await inject(chrome.runtime.getURL('assets/g2plot.min.js')); } catch {} }
    resolve(void 0);
  });
  return g2plotLoadingPromise.then(() => ((window as any).G2Plot || null));
}

function getChartShell(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function getChartBody(shell: HTMLElement | null): HTMLElement | null {
  return shell?.querySelector('.chart-card-body') as HTMLElement | null;
}

export interface HomeTagsBarTheme {
  text: string;
  muted: string;
  border: string;
}

export interface HomeTagsBarDatum {
  name: string;
  value: number;
  color: string;
}

const HOME_TAGS_BAR_COLORS = ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#f59e0b','#ef4444','#06b6d4','#84cc16','#fb7185'];

export function buildHomeTagsBarData(
  tags: Array<{ name: string; count: number }>,
  page: number,
  pageSize: number,
): HomeTagsBarDatum[] {
  const start = Math.max(0, page) * Math.max(1, pageSize);
  return (Array.isArray(tags) ? tags : [])
    .slice(start, start + Math.max(1, pageSize))
    .map((tag, index) => ({
      name: String(tag.name || '').trim(),
      value: Number(tag.count || 0),
      color: HOME_TAGS_BAR_COLORS[index % HOME_TAGS_BAR_COLORS.length],
    }))
    .filter(tag => tag.name && Number.isFinite(tag.value));
}

export function buildHomeTagsBarOptions(data: HomeTagsBarDatum[], theme: HomeTagsBarTheme): any {
  return {
    data,
    xField: 'value',
    yField: 'name',
    legend: false,
    autoFit: true,
    barStyle: { radius: [0, 6, 6, 0] },
    label: {
      position: 'right',
      style: { fill: theme.text, fontWeight: 700 },
    },
    tooltip: { showTitle: false },
    xAxis: {
      min: 0,
      nice: true,
      label: { style: { fill: theme.muted } },
      line: { style: { stroke: theme.border } },
      tickLine: { style: { stroke: theme.border } },
      grid: { line: { style: { stroke: theme.border, lineDash: [4, 4] } } },
    },
    yAxis: {
      label: { autoHide: true, autoEllipsis: true, style: { fill: theme.muted } },
      line: { style: { stroke: theme.border } },
      tickLine: null,
      grid: null,
    },
    color: (datum: HomeTagsBarDatum) => datum.color,
  };
}

function renderChartEmptyState(el: HTMLElement, text: string): void {
  el.innerHTML = `<div class="chart-empty-state">${text}</div>`;
}

function clearChartEmptyState(el: HTMLElement): void {
  const empty = el.querySelector('.chart-empty-state');
  if (empty) empty.remove();
}

function hideChartLoading(el: HTMLElement): void {
  const loadingDiv = el.querySelector('.chart-loading-overlay');
  if (loadingDiv) loadingDiv.remove();
}

function updateG2Plot(
  charts: Record<string, any>,
  key: string,
  Plot: any,
  el: HTMLElement,
  options: Record<string, any>,
  data: any[],
): any {
  const current = charts[key];
  if (current?.changeData && charts[`${key}Element`] === el) {
    try {
      current.changeData(data);
      return current;
    } catch {}
  }
  try { current?.destroy?.(); } catch {}
  try { current?.dispose?.(); } catch {}
  const plot = new Plot(el, withHomeChartRenderPolicy({ ...options, data }));
  plot.render();
  charts[key] = plot;
  charts[`${key}Element`] = el;
  return plot;
}

interface HomeTrendRenderArgs {
  recordsTrendEl: HTMLElement | null;
  actorsTrendEl: HTMLElement | null;
  newWorksTrendEl: HTMLElement | null;
  range: { start: string; end: string };
  records: any[];
  actors: any[];
  newWorks: any[];
  colors: Record<string, string>;
  linePlot: any;
  charts: Record<string, any>;
  canRender: () => boolean;
}

async function renderHomeTrendCharts(args: HomeTrendRenderArgs): Promise<void> {
  const { recordsTrendEl, actorsTrendEl, newWorksTrendEl, range, records, actors, newWorks, colors, linePlot, charts, canRender } = args;
  try {
    if (recordsTrendEl) {
      await yieldToBrowser();
      if (!canRender()) return;
      hideChartLoading(recordsTrendEl);
      let data = ([] as any[]).concat(
        records.map((point: any) => ({ date: point.date, type: '总记录', value: point.total })),
        records.map((point: any) => ({ date: point.date, type: '已观看', value: point.viewed })),
        records.map((point: any) => ({ date: point.date, type: '已浏览', value: point.browsed })),
        records.map((point: any) => ({ date: point.date, type: '想看', value: point.want })),
      );
      const sum = data.reduce((total, point) => total + Number(point.value || 0), 0);
      if (!data.length) {
        data = [
          { date: range.start, type: '总记录', value: 0 },
          { date: range.end, type: '总记录', value: 0 },
          { date: range.start, type: '已观看', value: 0 },
          { date: range.end, type: '已观看', value: 0 },
          { date: range.start, type: '已浏览', value: 0 },
          { date: range.end, type: '已浏览', value: 0 },
          { date: range.start, type: '想看', value: 0 },
          { date: range.end, type: '想看', value: 0 },
        ];
      }
      const yAxis = sum <= 0 ? { min: 0, max: 1 } : { min: 0, nice: true };
      updateG2Plot(charts, 'recordsTrend', linePlot, recordsTrendEl, {
        xField: 'date', yField: 'value', seriesField: 'type', smooth: true, autoFit: true,
        legend: { position: 'top' }, tooltip: { shared: true }, yAxis,
        color: (datum: any) => ({
          '总记录': colors.primary,
          '已观看': colors.success,
          '已浏览': colors.info,
          '想看': colors.warning,
        } as Record<string, string>)[String(datum?.type)] || colors.primary,
      }, data);
    }

    if (actorsTrendEl) {
      await yieldToBrowser();
      if (!canRender()) return;
      hideChartLoading(actorsTrendEl);
      let data = ([] as any[]).concat(
        actors.map((point: any) => ({ date: point.date, type: '总演员数', value: point.total })),
        actors.map((point: any) => ({ date: point.date, type: '女性', value: point.female })),
        actors.map((point: any) => ({ date: point.date, type: '男性', value: point.male })),
        actors.map((point: any) => ({ date: point.date, type: '拉黑', value: point.blacklisted })),
      );
      const sum = data.reduce((total, point) => total + Number(point.value || 0), 0);
      if (!data.length) {
        data = [
          { date: range.start, type: '总演员数', value: 0 },
          { date: range.end, type: '总演员数', value: 0 },
          { date: range.start, type: '女性', value: 0 },
          { date: range.end, type: '女性', value: 0 },
          { date: range.start, type: '男性', value: 0 },
          { date: range.end, type: '男性', value: 0 },
          { date: range.start, type: '拉黑', value: 0 },
          { date: range.end, type: '拉黑', value: 0 },
        ];
      }
      const yAxis = sum <= 0 ? { min: 0, max: 1 } : { min: 0, nice: true };
      updateG2Plot(charts, 'actorsTrend', linePlot, actorsTrendEl, {
        xField: 'date', yField: 'value', seriesField: 'type', smooth: true, autoFit: true,
        legend: { position: 'top' }, tooltip: { shared: true }, yAxis,
        color: (datum: any) => ({
          '总演员数': colors.primary,
          '女性': colors.success,
          '男性': colors.info,
          '拉黑': colors.danger,
        } as Record<string, string>)[String(datum?.type)] || colors.primary,
      }, data);
    }

    if (newWorksTrendEl) {
      await yieldToBrowser();
      if (!canRender()) return;
      hideChartLoading(newWorksTrendEl);
      let data = ([] as any[]).concat(
        newWorks.map((point: any) => ({ date: point.date, type: '当天总量', value: point.total })),
        newWorks.map((point: any) => ({ date: point.date, type: '未读', value: point.unread })),
        newWorks.map((point: any) => ({ date: point.date, type: '已读', value: Math.max(0, (point.total || 0) - (point.unread || 0)) })),
      );
      const sum = data.reduce((total, point) => total + Number(point.value || 0), 0);
      if (!data.length) {
        data = [
          { date: range.start, type: '当天总量', value: 0 },
          { date: range.end, type: '当天总量', value: 0 },
          { date: range.start, type: '未读', value: 0 },
          { date: range.end, type: '未读', value: 0 },
          { date: range.start, type: '已读', value: 0 },
          { date: range.end, type: '已读', value: 0 },
        ];
      }
      const yAxis = sum <= 0 ? { min: 0, max: 1 } : { min: 0, nice: true };
      updateG2Plot(charts, 'newWorksTrend', linePlot, newWorksTrendEl, {
        xField: 'date', yField: 'value', seriesField: 'type', smooth: true, autoFit: true,
        legend: { position: 'top' }, tooltip: { shared: true }, yAxis,
        color: (datum: any) => ({
          '当天总量': colors.primary,
          '未读': colors.warning,
          '已读': colors.success,
        } as Record<string, string>)[String(datum?.type)] || colors.primary,
      }, data);
    }
  } catch {}
}

let homeChartsThemeListenerBound = false;
let homeChartsPageLifecycleBound = false;
let homeOverviewRefreshPromise: Promise<void> | null = null;
let homeOverviewInitialized = false;
let homeOverviewNeedsRender = false;
let homeOverviewHasRendered = false;
let homeNewWorksDailyStatRefreshed = false;

const homeChartLifecycle = createHomeChartLifecycle();

function isHomeTabActive(): boolean {
  try {
    const activeTab = document.querySelector<HTMLElement>('.tab-content.active');
    return document.visibilityState !== 'hidden' && (!activeTab || activeTab.id === 'tab-home');
  } catch {
    return false;
  }
}

function isHomeChartSessionActive(session: HomeChartSession): boolean {
  return homeChartLifecycle.isCurrent(session) && isHomeTabActive();
}

export function disposeHomeCharts(options: { preserveOverviewRender?: boolean } = {}): void {
  homeChartLifecycle.dispose();
  if (options.preserveOverviewRender !== true) homeOverviewNeedsRender = false;
  homeOverviewHasRendered = false;
  const charts = (window as any).__HOME_CHARTS__ as Record<string, unknown> | undefined;
  if (!charts) return;
  try {
    const trendRenderTask = charts.__trendRenderTask as { cancel?: () => void } | undefined;
    trendRenderTask?.cancel?.();
    delete charts.__trendRenderTask;
  } catch {}
  try {
    const resizeCleanup = charts._resizeCleanup;
    if (typeof resizeCleanup === 'function') resizeCleanup();
  } catch {}
  disposeChartRegistry(charts);
}

function bindHomeChartsPageLifecycle(): void {
  if (homeChartsPageLifecycleBound) return;
  homeChartsPageLifecycleBound = true;
  try {
    window.addEventListener('pagehide', () => disposeHomeCharts());
    window.addEventListener('tab:hide', (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string }>).detail;
      if (detail?.tabId !== 'tab-home') return;
      // 隐藏时使未完成的异步渲染失效，但保留已绘制的图表表面供恢复时复用。
      homeChartLifecycle.cancel();
    });
  } catch {}
}

function bindHomeChartsThemeListener(): void {
  if (homeChartsThemeListenerBound) return;
  homeChartsThemeListenerBound = true;
  try {
    const onThemeChange = () => {
      if (!isHomeTabActive()) {
        homeOverviewNeedsRender = true;
        return;
      }
      try { initOrUpdateHomeCharts(); } catch {}
    };
    themeManager.onThemeChange(onThemeChange);
  } catch {}
}

async function renderHomeChartsWithEcharts(
  session: HomeChartSession,
  plan: HomeChartRenderPlan,
): Promise<void> {
  try {
    const canRender = () => isHomeChartSessionActive(session);
    if (!canRender()) return;
    installCanvasDirectionGuard();
    try { await ensureBackgroundReady(); } catch {}
    if (!canRender()) return;
    const statusShell = getChartShell('homeStatusDonut') as HTMLDivElement | null;
    const barsShell = getChartShell('homeNewWorksBars') as HTMLDivElement | null;
    const recordsTrendShell = getChartShell('homeRecordsTrend') as HTMLDivElement | null;
    const actorsTrendShell = getChartShell('homeActorsTrend') as HTMLDivElement | null;
    const newWorksTrendShell = getChartShell('homeNewWorksTrend') as HTMLDivElement | null;
    const tagsShell = getChartShell('homeTagsTop') as HTMLDivElement | null;
    const changeShell = getChartShell('homeTagsChange') as HTMLDivElement | null;
    const newTagsShell = getChartShell('homeNewTagsTop') as HTMLDivElement | null;
    const statusEl = plan.enabled.status ? getChartBody(statusShell) : null;
    const barsEl = plan.enabled.bars ? getChartBody(barsShell) : null;
    const recordsTrendEl = plan.enabled.recordsTrend ? getChartBody(recordsTrendShell) : null;
    const actorsTrendEl = plan.enabled.actorsTrend ? getChartBody(actorsTrendShell) : null;
    const newWorksTrendEl = plan.enabled.newWorksTrend ? getChartBody(newWorksTrendShell) : null;
    const tagsEl = plan.enabled.tags ? getChartBody(tagsShell) : null;
    const changeEl = plan.enabled.change ? getChartBody(changeShell) : null;
    const newTagsEl = plan.enabled.newTags ? getChartBody(newTagsShell) : null;
    if (!statusEl && !barsEl && !recordsTrendEl && !actorsTrendEl && !newWorksTrendEl && !tagsEl && !changeEl && !newTagsEl) return;
    const ech = await ensureEchartsLoaded();
    if (!ech) return;
    const W: any = window as any;
    const HC: any = (W.__HOME_CHARTS__ = W.__HOME_CHARTS__ || {});
    const getChart = (el: HTMLElement | null, key: string) => {
      if (!el) return null;
      const cur = HC[key];
      if (cur && cur.getDom && cur.getDom() === el) return cur;
      if (cur && cur.dispose) { try { cur.dispose(); } catch {} }
      const inst = ech.init(el, undefined, getHomeEchartsInitOptions());
      HC[key] = inst;
      return inst;
    };
    if (!HC._resizeBound) {
      try {
        const onResize = () => {
          ['statusDonut','newWorksBars','activityTrend','tagsTop','tagsChange','newTagsTop','recordsTrend','actorsTrend','newWorksTrend'].forEach((k: string) => {
            const c = HC[k];
            if (c && c.resize) { try { c.resize(); } catch {} }
          });
        };
        window.addEventListener('resize', onResize);
        HC._resizeCleanup = () => window.removeEventListener('resize', onResize);
        HC._resizeBound = true;
      } catch {}
    }
    const getVar = (name: string, fallback: string) => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
      } catch { return fallback; }
    };
    const COLORS: any = {
      primary: getVar('--primary', '#3b82f6'),
      success: getVar('--success', '#22c55e'),
      info: getVar('--info', '#14b8a6'),
      warning: getVar('--warning', '#f59e0b'),
      danger: getVar('--danger', '#ef4444'),
      text: getVar('--text', '#111827'),
      muted: getVar('--muted', '#6b7280'),
      border: getVar('--border', '#e5e7eb'),
      surface: getVar('--surface', '#ffffff'),
      pieBorder: getVar('--bg-primary', '#f5f7fb')
    };
    const fmtDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    let s: any = null, w: any = null, insRange: any = null, insAll: any = null, viewsArrRange: any[] = [];
    const parse = (s: string) => { try { const [Y,M,D] = String(s||'').split('-').map((n) => Number(n)); return new Date(Y, (M||1)-1, D||1); } catch { return new Date(); } };
    const msDay = 24*60*60*1000;
    try {
      const stats = await loadHomeStatsSnapshot();
      s = stats.viewedStats;
      w = stats.newWorksStats;
    } catch {}
    try {
      const { start: startStr, end: endStr } = getHomeChartsRange();
      const sDate = parse(startStr), eDate = parse(endStr);
      const span = Math.max(1, Math.round((eDate.getTime() - sDate.getTime())/msDay) + 1);
      const prevEnd = new Date(sDate.getTime() - msDay);
      const prevStart = new Date(prevEnd.getTime() - (span - 1) * msDay);
      const prevArr = await dbInsViewsRange(fmtDate(prevStart), fmtDate(prevEnd));
      viewsArrRange = await dbInsViewsRange(startStr, endStr);
      insRange = aggregateMonthly(viewsArrRange || [], { topN: 8, previousDays: prevArr || [] });
      try { console.info('[INSIGHTS] home echarts range', { start: startStr, end: endStr, views: (viewsArrRange || []).length, trend: Array.isArray(insRange?.trend) ? insRange.trend.length : 0 }); } catch {}
    } catch {}
    if (!canRender()) return;

    try {
      if (statusEl) {
        if (!canRender()) return;
        const c = getChart(statusEl, 'statusDonut');
        if (c) {
          const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
          const data = [
            { name: '已观看', value: s?.byStatus?.viewed ?? 0, color: isDark ? '#4ade80' : COLORS.success },
            { name: '已浏览', value: s?.byStatus?.browsed ?? 0, color: isDark ? '#2dd4bf' : COLORS.info },
            { name: '想看', value: s?.byStatus?.want ?? 0, color: isDark ? '#fbbf24' : COLORS.warning },
          ];
          const total = data.reduce((s, d) => s + Number(d.value || 0), 0);
          c.setOption({
            tooltip: { trigger: 'item', confine: true },
            legend: {
              orient: 'horizontal',
              left: 'center',
              bottom: 2,
              itemWidth: 10,
              itemHeight: 10,
              icon: 'circle',
              textStyle: { color: COLORS.muted, fontSize: 12 },
            },
            graphic: [{
              type: 'text', left: 'center', top: 'middle', z: 10,
              style: {
                text: `总数\n${total}`,
                textAlign: 'center',
                fill: COLORS.text,
                lineHeight: 18,
                fontSize: 14,
                fontWeight: 700,
              }
            }],
            series: [
              {
                type: 'pie',
                radius: ['46%', '72%'],
                center: ['50%', '42%'],
                avoidLabelOverlap: false,
                minAngle: 6,
                itemStyle: {
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: COLORS.pieBorder,
                  shadowBlur: isDark ? 10 : 6,
                  shadowColor: isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(15, 23, 42, 0.10)',
                },
                label: { show: true, position: 'inside', color: '#fff', fontWeight: 700, formatter: ({ value }: any) => `${value ?? 0}` },
                labelLine: { show: false },
                emphasis: { label: { show: true, fontWeight: 'bold' } },
                data: data.map(d => ({ name: d.name, value: d.value, itemStyle: { color: d.color } }))
              }
            ]
          });
        }
      }
    } catch {}

    try {
      if (barsEl) {
        if (!canRender()) return;
        const c = getChart(barsEl, 'newWorksBars');
        if (c) {
          const vals = [w?.today ?? 0, w?.week ?? 0, w?.unread ?? 0];
          const cats = ['今日发现', '本周发现', '未读'];
          c.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: { left: 50, right: 12, top: 10, bottom: 10 },
            xAxis: { type: 'category', data: cats, axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted } },
            yAxis: { type: 'value', axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted }, splitLine: { lineStyle: { color: COLORS.border } } },
            series: [{ type: 'bar', data: vals, itemStyle: { color: COLORS.primary, borderRadius: [6,6,0,0] }, barMaxWidth: 22 }]
          });
        }
      }
    } catch {}

    try {
      if (tagsEl) {
        if (!canRender()) return;
        const full = await getTagsTopFromRecords(50);
        if (!canRender()) return;
        const pager = document.getElementById('homeTagsPager') as HTMLDivElement | null;
        const prevBtn = document.getElementById('homeTagsPrevBtn') as HTMLButtonElement | null;
        const nextBtn = document.getElementById('homeTagsNextBtn') as HTMLButtonElement | null;
        const pageText = document.getElementById('homeTagsPageText') as HTMLSpanElement | null;
        const pageSize = 10;
        const totalPages = Math.max(1, Math.ceil(full.length / pageSize));
        const color = (idx: number) => ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#f59e0b','#ef4444','#06b6d4','#84cc16','#fb7185'][idx % 10];
        let chart: any = null;

        const ctrl: any = {
          page: 0,
          render() {
            if (!chart) chart = getChart(tagsEl, 'tagsTop');
            if (!chart) return;
              const start = this.page * pageSize;
              const pageData = full.slice(start, start + pageSize);
              const option = {
                dataset: [{ source: pageData.map((d, i) => ({ label: d.name, value: d.count, color: color(i) })) }],
                grid: { left: 80, right: 12, top: 10, bottom: 10 },
                xAxis: { type: 'value', axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted } },
                yAxis: { type: 'category', axisTick: { show: false }, axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted } },
                series: [{ type: 'bar', encode: { x: 'value', y: 'label' }, label: { show: true, position: 'right', color: COLORS.text }, itemStyle: { color: (p: any) => p.data.color, borderRadius: [0,6,6,0] }, barMaxWidth: 18 }]
              };
              try { chart.setOption(option as any, true); } catch { chart.setOption(option as any); }
              this.updatePager();
          },
          updatePager() {
            try { if (pageText) pageText.textContent = `${this.page + 1}/${totalPages}`; } catch {}
            try { if (prevBtn) prevBtn.disabled = (this.page <= 0); } catch {}
            try { if (nextBtn) nextBtn.disabled = ((this.page + 1) >= totalPages); } catch {}
          }
        };
        (W as any).__HOME_CHARTS__.__tagsTopPager = ctrl;
        const renderTask = scheduleHomeChartRender(() => {
          if (canRender()) ctrl.render();
        });
        (W as any).__HOME_CHARTS__.__tagsTopRenderTask = renderTask;

        if (pager) {
          if (prevBtn && !(prevBtn as any)._bound) {
            prevBtn.onclick = () => {
              const P = (W as any).__HOME_CHARTS__?.__tagsTopPager; if (!P) return;
              if (P.page > 0) { P.page--; P.render(); }
            };
            (prevBtn as any)._bound = true;
          }
          if (nextBtn && !(nextBtn as any)._bound) {
            nextBtn.onclick = () => {
              const P = (W as any).__HOME_CHARTS__?.__tagsTopPager; if (!P) return;
              if ((P.page + 1) < totalPages) { P.page++; P.render(); }
            };
            (nextBtn as any)._bound = true;
          }
        }
      }
    } catch {}

    try {
      if (changeEl) {
        if (!canRender()) return;
        const c = getChart(changeEl, 'tagsChange');
        if (c) {
          const rising = Array.isArray((insRange as any)?.changes?.risingDetailed) ? (insRange as any).changes.risingDetailed : [];
          const falling = Array.isArray((insRange as any)?.changes?.fallingDetailed) ? (insRange as any).changes.fallingDetailed : [];
          const changes = ([] as any[])
            .concat(rising.map((d: any) => ({ name: d.name, change: Number((d.diffRatio || 0) * 100) })))
            .concat(falling.map((d: any) => ({ name: d.name, change: Number((d.diffRatio || 0) * 100) })))
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
            .slice(0, 10);
          const cats = changes.map((r: any) => r.name);
          const vals = changes.map((r: any) => Number(r.change || 0));
          c.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: any) => {
              const v = Array.isArray(p) ? (p[0]?.value ?? 0) : (p?.value ?? 0);
              const sign = v > 0 ? '+' : '';
              return `${sign}${v.toFixed ? v.toFixed(2) : v}%`;
            } },
            grid: { left: 80, right: 12, top: 10, bottom: 10 },
            xAxis: { type: 'value', axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: COLORS.border } } },
            yAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted } },
            series: [{
              type: 'bar', data: vals.map((v: number) => ({ value: v, itemStyle: { color: v >= 0 ? '#16a34a' : '#ef4444', borderRadius: [0,6,6,0] } })),
              barMaxWidth: 18, label: { show: true, position: 'right', color: COLORS.text, formatter: (p: any) => `${p.value > 0 ? '+' : ''}${(p.value as number).toFixed ? (p.value as number).toFixed(2) : p.value}%` }
            }]
          });
        }
      }
    } catch {}

    // 新增标签 Top 5（ECharts）
    try {
      if (newTagsEl) {
        if (!canRender()) return;
        const c = getChart(newTagsEl, 'newTagsTop');
        if (c) {
          const list = Array.isArray((insRange as any)?.changes?.newTagsDetailed) ? (insRange as any).changes.newTagsDetailed : [];
          const top = list.slice(0, 5);
          c.setOption({
            dataset: [{ source: top.map((d: any, i: number) => ({ label: d.name, value: Number(d.count || 0), color: ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa'][i % 5] })) }],
            grid: { left: 80, right: 12, top: 10, bottom: 10 },
            xAxis: { type: 'value', axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted } },
            yAxis: { type: 'category', axisTick: { show: false }, axisLine: { lineStyle: { color: COLORS.border } }, axisLabel: { color: COLORS.muted } },
            series: [{ type: 'bar', encode: { x: 'value', y: 'label' }, label: { show: true, position: 'right', color: COLORS.text }, itemStyle: { color: (p: any) => p.data.color, borderRadius: [0,6,6,0] }, barMaxWidth: 18 }]
          });
        }
      }
    } catch {}
  } catch {}
}

function getHomeOverviewStages(
  range: { start: string; end: string },
  needs: {
    statusStats: boolean;
    newWorksStats: boolean;
    tagsTop: boolean;
    trends: boolean;
    insights: boolean;
  } = {
    statusStats: true,
    newWorksStats: true,
    tagsTop: true,
    trends: true,
    insights: true,
  },
) {
  const emptyViews = () => Promise.resolve([]);
  const emptyStats = () => Promise.resolve({});
  const emptyTags = () => Promise.resolve([] as Array<{ name: string; count: number }>);
  return loadHomeOverviewStages(range, {
    viewedStats: needs.statusStats
      ? () => loadHomeStatsSnapshot().then((stats) => stats.viewedStats)
      : emptyStats,
    newWorksStats: needs.newWorksStats
      ? () => loadHomeStatsSnapshot().then((stats) => stats.newWorksStats)
      : emptyStats,
    previousViews: needs.insights
      ? (startDate, endDate) => dbInsViewsRange(startDate, endDate).catch(() => [])
      : emptyViews,
    currentViews: needs.insights
      ? (startDate, endDate) => dbInsViewsRange(startDate, endDate).catch(() => [])
      : emptyViews,
    tagsTop: needs.tagsTop
      ? (limit) => getTagsTopFromRecords(limit)
      : emptyTags,
    recordsTrend: needs.trends
      ? (startDate, endDate, mode) => dbTrendsRecordsRange(startDate, endDate, mode).catch(() => [])
      : emptyViews,
    actorsTrend: needs.trends
      ? (startDate, endDate, mode) => dbTrendsActorsRange(startDate, endDate, mode).catch(() => [])
      : emptyViews,
    newWorksTrend: needs.trends
      ? (startDate, endDate, mode) => dbTrendsNewWorksRange(startDate, endDate, mode).catch(() => [])
      : emptyViews,
  });

}

async function renderHomeCharts(): Promise<void> {
  try {
    if (!isHomeTabActive()) return;
    const session = homeChartLifecycle.begin();
    const plan = getHomeChartRenderPlan(readHomeChartDiagnosticConfig());
    if (!Object.values(plan.enabled).some(Boolean)) {
      if (isHomeChartSessionActive(session)) homeOverviewHasRendered = true;
      return;
    }
    bindHomeChartsPageLifecycle();
    installCanvasDirectionGuard();
    bindHomeChartsThemeListener();
    try { await ensureBackgroundReady(); } catch {}
    if (!isHomeChartSessionActive(session)) return;
    const statusShell = getChartShell('homeStatusDonut') as HTMLDivElement | null;
    const barsShell = getChartShell('homeNewWorksBars') as HTMLDivElement | null;
    const trendShell = getChartShell('homeActivityTrend') as HTMLDivElement | null;
    const tagsShell = getChartShell('homeTagsTop') as HTMLDivElement | null;
    const changeShell = getChartShell('homeTagsChange') as HTMLDivElement | null;
    const newTagsShell = getChartShell('homeNewTagsTop') as HTMLDivElement | null;
    const recordsTrendShell = getChartShell('homeRecordsTrend') as HTMLDivElement | null;
    const actorsTrendShell = getChartShell('homeActorsTrend') as HTMLDivElement | null;
    const newWorksTrendShell = getChartShell('homeNewWorksTrend') as HTMLDivElement | null;
    const statusEl = plan.enabled.status ? getChartBody(statusShell) : null;
    const barsEl = plan.enabled.bars ? getChartBody(barsShell) : null;
    const trendEl = null;
    const tagsEl = plan.enabled.tags ? getChartBody(tagsShell) : null;
    const changeEl = plan.enabled.change ? getChartBody(changeShell) : null;
    const newTagsEl = plan.enabled.newTags ? getChartBody(newTagsShell) : null;
    const recordsTrendEl = plan.enabled.recordsTrend ? getChartBody(recordsTrendShell) : null;
    const actorsTrendEl = plan.enabled.actorsTrend ? getChartBody(actorsTrendShell) : null;
    const newWorksTrendEl = plan.enabled.newWorksTrend ? getChartBody(newWorksTrendShell) : null;
    if (!statusEl && !barsEl && !trendEl && !tagsEl && !changeEl && !newTagsEl && !recordsTrendEl && !actorsTrendEl && !newWorksTrendEl) return;
    if (newWorksTrendEl && !homeNewWorksDailyStatRefreshed) {
      try { await dbNewWorksDailyStatRefresh(); } catch {}
      homeNewWorksDailyStatRefreshed = true;
    }
    
    // 显示加载动画（使用绝对定位覆盖层，不清空容器）
    const showLoading = (el: HTMLElement) => {
      // 移除旧的加载层
      const oldLoading = el.querySelector('.chart-loading-overlay');
      if (oldLoading) oldLoading.remove();
      
      // 添加新的加载层
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'chart-loading-overlay';
      loadingDiv.innerHTML = '<div class="chart-loading"><div class="chart-spinner"></div><div class="chart-loading-text">加载中...</div></div>';
      el.style.position = 'relative';
      el.appendChild(loadingDiv);
    };
    
    // 隐藏加载动画
    const hideLoading = (el: HTMLElement) => {
      const loadingDiv = el.querySelector('.chart-loading-overlay');
      if (loadingDiv) loadingDiv.remove();
    };
    
    const chartElements = [statusEl, barsEl, tagsEl, changeEl, newTagsEl, recordsTrendEl, actorsTrendEl, newWorksTrendEl].filter(Boolean) as HTMLElement[];
    chartElements.forEach(showLoading);
    if (plan.renderer === 'echarts') {
      await renderHomeChartsWithEcharts(session, plan);
      if (isHomeChartSessionActive(session)) homeOverviewHasRendered = true;
      return;
    }
    const G2P: any = await ensureG2PlotLoaded();
    if (!isHomeChartSessionActive(session)) return;
    if (!G2P) {
      if (plan.renderer === 'g2plot') return;
      await renderHomeChartsWithEcharts(session, plan);
      if (isHomeChartSessionActive(session)) homeOverviewHasRendered = true;
      return;
    }
    const { Column, Line, Bar, Pie } = G2P;
    const W: any = window as any;
    const HC: any = (W.__HOME_CHARTS__ = W.__HOME_CHARTS__ || {});
    const summaryRenderQueue = createHomeChartRenderQueue();
    HC.__summaryRenderQueue = summaryRenderQueue;
    const getVar = (name: string, fallback: string) => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
      } catch { return fallback; }
    };
    const COLORS = {
      primary: getVar('--primary', '#3b82f6'),
      success: getVar('--success', '#22c55e'),
      info: getVar('--info', '#14b8a6'),
      warning: getVar('--warning', '#f59e0b'),
      danger: getVar('--danger', '#ef4444'),
      text: getVar('--text', '#111827'),
      muted: getVar('--muted', '#6b7280'),
      border: getVar('--border', '#e5e7eb'),
      surface: getVar('--surface', '#ffffff'),
      pieBorder: getVar('--bg-primary', '#f5f7fb')
    } as any;
    const r = getHomeChartsRange();
    let s: any = null, w: any = null, ins: any = null, homeTagsTop: Array<{ name: string; count: number }> = [];
    let homeTrendRecords: any[] = [], homeTrendActors: any[] = [], homeTrendNewWorks: any[] = [];
    let overviewSummary: Promise<{ viewedStats: any; newWorksStats: any; tagsTop: Array<{ name: string; count: number }> }> = Promise.resolve({ viewedStats: {}, newWorksStats: {}, tagsTop: [] });
    try {
      const overviewStages = getHomeOverviewStages(r, plan.needs);
      const trendData = await overviewStages.trends;
      overviewSummary = overviewStages.summary;
      ins = trendData.insights;
      homeTrendRecords = trendData.trends.records;
      homeTrendActors = trendData.trends.actors;
      homeTrendNewWorks = trendData.trends.newWorks;
      try { console.info('[INSIGHTS] home g2plot range', { start: r.start, end: r.end, trend: Array.isArray(ins?.trend) ? ins.trend.length : 0 }); } catch {}
    } catch {}

    // 趋势图不是首屏交互必需项，延迟到空闲时段，避免阻塞摘要和导航响应。
    try {
      const previousTrendTask = HC.__trendRenderTask as { cancel?: () => void } | undefined;
      previousTrendTask?.cancel?.();
      HC.__trendRenderTask = scheduleHomeChartRender(() => {
        void renderHomeTrendCharts({
          recordsTrendEl,
          actorsTrendEl,
          newWorksTrendEl,
          range: r,
          records: homeTrendRecords,
          actors: homeTrendActors,
          newWorks: homeTrendNewWorks,
          colors: COLORS,
          linePlot: Line,
          charts: HC,
          canRender: () => isHomeChartSessionActive(session),
        });
      }, { timeoutMs: 900 });
    } catch {}

    try {
      const summary = await overviewSummary;
      if (!isHomeChartSessionActive(session)) return;
      s = summary.viewedStats;
      w = summary.newWorksStats;
      homeTagsTop = summary.tagsTop;
      try { console.info('[INSIGHTS] home g2plot summary ready', { tagsTop: homeTagsTop.length }); } catch {}
    } catch {}

    try {
      if (statusEl) {
        await yieldToBrowser();
        if (!isHomeChartSessionActive(session)) return;
        hideLoading(statusEl);
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const data = buildHomeStatusData(s, COLORS, isDark);
        const total = data.reduce((sum, datum) => sum + Number(datum.value || 0), 0);
        updateG2Plot(HC, 'statusDonut', Pie, statusEl, {
          angleField: 'value',
          colorField: 'name',
          radius: 0.72,
          innerRadius: 0.46,
          legend: { position: 'bottom', itemName: { style: { fill: COLORS.muted, fontSize: 12 } } },
          label: { type: 'inner', offset: '-50%', content: 'value', style: { fill: '#fff', fontWeight: 700 } },
          statistic: {
            title: { content: '总数', style: { fill: COLORS.muted, fontSize: 12 } },
            content: { content: String(total), style: { fill: COLORS.text, fontSize: 16, fontWeight: 700 } },
          },
          tooltip: { showTitle: false },
          color: data.map((datum) => datum.color),
        }, data);
      }
    } catch {}

    try {
      if (barsEl) {
        await yieldToBrowser();
        if (!isHomeChartSessionActive(session)) return;
        hideLoading(barsEl);
        const data = [
          { type: '今日发现', value: w?.today ?? 0 },
          { type: '本周发现', value: w?.week ?? 0 },
          { type: '未读', value: w?.unread ?? 0 },
        ];
        updateG2Plot(HC, 'newWorksBars', Column, barsEl, {
          xField: 'type',
          yField: 'value',
          columnStyle: { radius: [6,6,0,0] },
          color: COLORS.primary,
          label: { position: 'top' },
    autoFit: true,
    animation: false,
        }, data);
      }
    } catch {}

    try {
      if (tagsEl) {
        await yieldToBrowser();
        if (!isHomeChartSessionActive(session)) return;
        const full = homeTagsTop;
        const pageSize = 10;
        const totalPages = Math.max(1, Math.ceil(full.length / pageSize));
        const pageText = document.getElementById('homeTagsPageText') as HTMLSpanElement | null;
        const pager = document.getElementById('homeTagsPager') as HTMLDivElement | null;
        const prevBtn = document.getElementById('homeTagsPrevBtn') as HTMLButtonElement | null;
        const nextBtn = document.getElementById('homeTagsNextBtn') as HTMLButtonElement | null;
        const tagTheme = { text: COLORS.text, muted: COLORS.muted, border: COLORS.border };

        const ctrl: any = {
          page: 0,
          isFirstRender: true,
          render() {
            const list = buildHomeTagsBarData(full, this.page, pageSize);
            try {
              if (list.length === 0) {
                if (HC['tagsTop']?.destroy) { try { HC['tagsTop'].destroy(); } catch {} }
                HC['tagsTop'] = null;
                hideLoading(tagsEl);
                renderChartEmptyState(tagsEl, '暂无标签数据');
                this.updatePager();
                return;
              }
              clearChartEmptyState(tagsEl);
              if (HC['tagsTop'] && typeof HC['tagsTop'].changeData === 'function') {
                HC['tagsTop'].changeData(list);
              } else {
                if (HC['tagsTop']?.destroy) { try { HC['tagsTop'].destroy(); } catch {} }
                
                // 首次渲染时先移除加载动画
                if (this.isFirstRender) {
                  hideLoading(tagsEl);
                  this.isFirstRender = false;
                }
                
                 const plot = new Bar(tagsEl, withHomeChartRenderPolicy(buildHomeTagsBarOptions(list, tagTheme)));
                plot.render();
                HC['tagsTop'] = plot;
              }
            } catch {
              try { if (HC['tagsTop']?.destroy) { HC['tagsTop'].destroy(); } } catch {}
              
              // 首次渲染时先移除加载动画
              if (this.isFirstRender) {
                hideLoading(tagsEl);
                this.isFirstRender = false;
              }
              
               const plot = new Bar(tagsEl, withHomeChartRenderPolicy(buildHomeTagsBarOptions(list, tagTheme)));
              plot.render();
              HC['tagsTop'] = plot;
            }
            this.updatePager();
          },
          updatePager() {
            try { if (pageText) pageText.textContent = `${this.page + 1}/${totalPages}`; } catch {}
            try { if (prevBtn) prevBtn.disabled = (this.page <= 0); } catch {}
            try { if (nextBtn) nextBtn.disabled = ((this.page + 1) >= totalPages); } catch {}
          }
        };
        HC.__tagsTopPager = ctrl;
        const renderTask = scheduleHomeChartRender(() => {
          if (isHomeChartSessionActive(session)) ctrl.render();
        });
        HC.__tagsTopRenderTask = renderTask;

        if (pager) {
          if (prevBtn && !(prevBtn as any)._bound) {
            prevBtn.onclick = () => {
              const P = HC.__tagsTopPager; if (!P) return;
              if (P.page > 0) { P.page--; P.render(); }
            };
            (prevBtn as any)._bound = true;
          }
          if (nextBtn && !(nextBtn as any)._bound) {
            nextBtn.onclick = () => {
              const P = HC.__tagsTopPager; if (!P) return;
              if ((P.page + 1) < totalPages) { P.page++; P.render(); }
            };
            (nextBtn as any)._bound = true;
          }
        }
      }
    } catch {}

    try {
      if (changeEl) {
        const rising = Array.isArray((ins as any)?.changes?.risingDetailed) ? (ins as any).changes.risingDetailed : [];
        const falling = Array.isArray((ins as any)?.changes?.fallingDetailed) ? (ins as any).changes.fallingDetailed : [];
        const changes = ([] as any[])
          .concat(rising.map((d: any) => ({ name: d.name, value: Number((d.diffRatio || 0) * 100) })))
          .concat(falling.map((d: any) => ({ name: d.name, value: Number((d.diffRatio || 0) * 100) })))
          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
          .slice(0, 10);
        const renderChange = () => {
          if (!isHomeChartSessionActive(session)) return;
          hideLoading(changeEl);
          updateG2Plot(HC, 'tagsChange', Bar, changeEl, {
          xField: 'value', yField: 'name', legend: false, autoFit: true,
          barStyle: { radius: [0, 6, 6, 0] }, label: { position: 'right', formatter: (d: any) => `${d.value > 0 ? '+' : ''}${(d.value as number).toFixed ? (d.value as number).toFixed(2) : d.value}%` }, tooltip: { showTitle: false },
          xAxis: { nice: true }, yAxis: { label: { autoHide: true, autoEllipsis: true } },
          color: (d: any) => d.value >= 0 ? '#16a34a' : '#ef4444',
          }, changes);
        };
        summaryRenderQueue.enqueue(renderChange);
      }
    } catch {}

    // 新增标签 Top 5（G2Plot）
    try {
      if (newTagsEl) {
        const list = Array.isArray((ins as any)?.changes?.newTagsDetailed) ? (ins as any).changes.newTagsDetailed : [];
        const top = list.slice(0, 5).map((d: any, i: number) => ({ name: d.name, value: Number(d.count || 0), color: ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa'][i % 5] }));
        const renderNewTags = () => {
          if (!isHomeChartSessionActive(session)) return;
          hideLoading(newTagsEl);
          updateG2Plot(HC, 'newTagsTop', Bar, newTagsEl, {
          xField: 'value', yField: 'name', legend: false, autoFit: true,
          barStyle: { radius: [0, 6, 6, 0] }, label: { position: 'right' }, tooltip: { showTitle: false },
          xAxis: { min: 0, nice: true }, yAxis: { label: { autoHide: true, autoEllipsis: true } },
          color: (d: any) => d.color,
          }, top);
        };
        summaryRenderQueue.enqueue(renderNewTags);
      }
    } catch {}

    if (isHomeChartSessionActive(session)) homeOverviewHasRendered = true;
  } catch {}
}

const requestHomeChartsRefresh = createRefreshCoordinator(renderHomeCharts);

export function initOrUpdateHomeCharts(): Promise<void> {
  return requestHomeChartsRefresh();
}

export async function refreshHomeOverview(options: { force?: boolean } = {}): Promise<void> {
  if (!shouldRefreshHomeOverview({
    initialized: homeOverviewInitialized,
    force: options.force,
    needsRender: homeOverviewNeedsRender,
  })) return;
  if (homeOverviewRefreshPromise) return homeOverviewRefreshPromise;

  if (options.force) {
    invalidateHomeStatsSnapshot();
    homeOverviewInitialized = false;
    homeOverviewNeedsRender = false;
    homeOverviewHasRendered = false;
  }

  if (homeOverviewInitialized) {
    homeOverviewNeedsRender = false;
    homeOverviewRefreshPromise = initOrUpdateHomeCharts();
    try {
      await homeOverviewRefreshPromise;
    } finally {
      homeOverviewRefreshPromise = null;
    }
    return;
  }

  // 先占位，避免快速离开/返回时把同一轮首页查询重复启动。
  homeOverviewInitialized = true;
  homeOverviewRefreshPromise = (async () => {
    try {
      if (options.force) homeNewWorksDailyStatRefreshed = false;
      await initStatsOverview();
      await initHomeSectionsOverview();
      try { await initOrUpdateHomeCharts(); } catch {}
      homeOverviewInitialized = true;
    } finally {
      homeOverviewRefreshPromise = null;
    }
  })();
  return homeOverviewRefreshPromise;
}

export function invalidateHomeOverview(): void {
  invalidateHomeStatsSnapshot();
  homeOverviewInitialized = false;
  homeOverviewNeedsRender = false;
  homeOverviewHasRendered = false;
}

export function bindHomeRefreshButton(): void {
  const btn = document.getElementById('homeRefreshBtn') as HTMLButtonElement | null;
  if (!btn) return;
  if ((btn as any)._bound) return;
  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true;
      btn.classList.add('loading');
      await refreshHomeOverview({ force: true });
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
  (btn as any)._bound = true;
}

export function bindHomeChartsRangeControls(): void {
  try {
    const preset = document.getElementById('homeChartsRangePreset') as HTMLSelectElement | null;
    const start = document.getElementById('homeChartsRangeStart') as HTMLInputElement | null;
    const end = document.getElementById('homeChartsRangeEnd') as HTMLInputElement | null;
    const sep = document.getElementById('homeChartsRangeSep') as HTMLSpanElement | null;
    const apply = document.getElementById('homeChartsRangeApply') as HTMLButtonElement | null;
    if (!preset || !start || !end || !sep) return;
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const setVisible = (custom: boolean) => {
      try { start.style.display = custom ? '' : 'none'; } catch {}
      try { end.style.display = custom ? '' : 'none'; } catch {}
      try { sep.style.display = custom ? '' : 'none'; } catch {}
    };
    const restore = () => {
      preset.value = '30';
      const now = new Date();
      const endStr = fmt(now);
      const startStr = fmt(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
      start.value = startStr;
      end.value = endStr;
      setVisible(false);
    };
    const applyNow = async () => {
      try {
        let s = start.value;
        let e = end.value;
        const pv = preset.value || '30';
        if (pv !== 'custom') {
          const days = Math.max(1, parseInt(pv, 10) || 30);
          const now = new Date();
          e = fmt(now);
          s = fmt(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
        }
        if (s && e && s > e) { const t = s; s = e; e = t; }
        await initOrUpdateHomeCharts();
      } catch {}
    };
    const debounce = (() => {
      let timer: any = null;
      return (fn: () => void, ms = 300) => { try { if (timer) clearTimeout(timer); } catch {}; timer = setTimeout(fn, ms); };
    })();
    if (!(preset as any)._rangeBound) {
      preset.onchange = () => { setVisible(preset.value === 'custom'); applyNow(); };
      const onDateChange = () => debounce(applyNow, 250);
      try { start.oninput = onDateChange; start.onchange = onDateChange; } catch {}
      try { end.oninput = onDateChange; end.onchange = onDateChange; } catch {}
      if (apply) {
        try { apply.onclick = applyNow; } catch {}
        try { (apply.style as any).display = 'none'; } catch {}
      }
      (preset as any)._rangeBound = true;
    }
    restore();
  } catch {}
}

export function getHomeChartsRange(): { start: string; end: string } {
  try {
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    let pv = '30', s = '', e = '';
    const preset = document.getElementById('homeChartsRangePreset') as HTMLSelectElement | null;
    const start = document.getElementById('homeChartsRangeStart') as HTMLInputElement | null;
    const end = document.getElementById('homeChartsRangeEnd') as HTMLInputElement | null;
    if (preset && start && end) {
      pv = preset.value || '30';
      s = start.value || '';
      e = end.value || '';
    }
    if (pv !== 'custom') {
      const days = Math.max(1, parseInt(pv, 10) || 30);
      const now = new Date();
      e = fmt(now);
      s = fmt(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
    }
    if (s && e && s > e) { const t = s; s = e; e = t; }
    if (!(s && e)) {
      const now = new Date();
      e = fmt(now);
      s = fmt(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    }
    return { start: s, end: e };
  } catch {
    const now = new Date();
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const e = fmt(now);
    const s = fmt(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    return { start: s, end: e };
  }
}

export async function getTagsTopFromRecords(limit: number = 10): Promise<Array<{ name: string; count: number }>> {
  // 优化：在后台直接统计标签，只返回统计结果
  // 避免传输大量数据，减少前端计算压力
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: 'DB:GET_ALL_TAGS',
      payload: { limit: Math.max(1, Number(limit || 10)) }
    });
    
    if (response?.success && Array.isArray(response?.tags)) {
      return response.tags;
    }
    
    return [];
  } catch (e) {
    console.error('[getTagsTopFromRecords] 查询失败:', e);
    return [];
  }
}
