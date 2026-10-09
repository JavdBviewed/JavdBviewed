/**
 * @file recordsRenderCoordinatorLocal.test.ts
 * @description 10-08 扩项（288）：renderCoordinator 全量滤分支接线——
 * 先加载中占位 → await 数据源回填 → 滤/渲染/分页/横幅/统计 顺序；
 * IDB 分支零回归；未注入回填时保持旧同步语义。
 * @module tests/dom
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordsRenderCoordinator } from '../../apps/extension/src/dashboard/tabs/records/renderCoordinator';

function harness(overrides: Record<string, unknown> = {}) {
  const videoList = document.createElement('ul');
  videoList.id = 'videoList';
  document.body.appendChild(videoList);

  const calls: string[] = [];
  const opts = {
    videoList,
    shouldUseIDB: () => false,
    setServerModeActive: vi.fn(),
    renderServerPage: vi.fn(async () => undefined),
    updateFilteredRecords: vi.fn(() => { calls.push('filter'); }),
    renderVideoList: vi.fn(() => {
      calls.push('list');
      // 模拟真实渲染器：重绘时替换列表内容（含清掉回填占位）
      if (videoList.innerHTML.includes('加载中')) videoList.innerHTML = '<li>item</li>';
    }),
    renderPagination: vi.fn(() => { calls.push('page'); }),
    updateSearchResultCount: vi.fn(() => { calls.push('banner'); }),
    updateStats: vi.fn(async () => { calls.push('stats'); }),
    isActive: () => true,
    ...overrides,
  };
  const coord = createRecordsRenderCoordinator(opts as any);
  return { videoList, calls, opts, coord };
}

describe('records render coordinator 全量滤分支（10-08 扩项：数据源回填接线，288）', () => {
  it('全量滤分支：先占位 → 回填完成前不滤不渲染 → 完成后按 滤/列表/分页/横幅/统计 顺序执行', async () => {
    const { videoList, calls, opts, coord } = harness({
      ensureLocalRecordsLoaded: vi.fn(),
    });
    let resolveEnsure: () => void;
    (opts.ensureLocalRecordsLoaded as any) = vi.fn(
      () => new Promise<void>((resolve) => { resolveEnsure = resolve; }),
    );

    coord.render();

    expect(videoList.innerHTML).toContain('加载中');
    expect(opts.updateFilteredRecords).not.toHaveBeenCalled();
    expect(opts.renderVideoList).not.toHaveBeenCalled();
    expect(opts.renderServerPage).not.toHaveBeenCalled();

    resolveEnsure!();
    await vi.waitFor(() => expect(opts.updateFilteredRecords).toHaveBeenCalledTimes(1));

    expect(calls).toEqual(['filter', 'list', 'page', 'banner', 'stats']);
    expect(opts.setServerModeActive).toHaveBeenCalledWith(false);
    expect(videoList.innerHTML).not.toContain('加载中');
  });

  it('回填完成前连续 render：每次进入都先占位且都 await 自己的回填（不串渲染）', async () => {
    const { calls, opts, coord } = harness();
    let resolve1: () => void;
    let resolve2: () => void;
    let n = 0;
    (opts.ensureLocalRecordsLoaded as any) = vi.fn(() => {
      n += 1;
      return new Promise<void>((resolve) => {
        if (n === 1) resolve1 = resolve;
        else resolve2 = resolve;
      });
    });

    coord.render();
    coord.render();

    expect(calls).toHaveLength(0);
    resolve1!();
    await vi.waitFor(() => expect(calls).toHaveLength(5));
    resolve2!();
    await vi.waitFor(() => expect(calls).toHaveLength(10));
    expect((opts.ensureLocalRecordsLoaded as any)).toHaveBeenCalledTimes(2);
  });

  it('回填完成后页签已切走（isActive=false）→ 不装配列表/横幅/统计', async () => {
    const { calls, opts, coord } = harness({ isActive: () => false });
    let resolveEnsure: () => void;
    (opts.ensureLocalRecordsLoaded as any) = vi.fn(
      () => new Promise<void>((resolve) => { resolveEnsure = resolve; }),
    );

    coord.render();
    resolveEnsure!();
    await vi.waitFor(() => expect(opts.updateFilteredRecords).toHaveBeenCalledTimes(1));

    expect(calls).toEqual(['filter']);
  });

  it('IDB 分支零回归：不调用回填、走 renderServerPage、完成后统计', async () => {
    const { calls, opts, coord } = harness({
      shouldUseIDB: () => true,
      ensureLocalRecordsLoaded: vi.fn(),
    });

    coord.render();

    expect(opts.ensureLocalRecordsLoaded).not.toHaveBeenCalled();
    expect(opts.renderServerPage).toHaveBeenCalledTimes(1);
    expect(opts.updateFilteredRecords).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(calls).toContain('stats'));
    expect(calls).toEqual(['stats']);
    expect(opts.setServerModeActive).toHaveBeenCalledWith(true);
  });

  it('全量滤分支：prepareMediaState 在回填完成后、过滤前调用（媒体索引竞态修复，288）', async () => {
    const { calls, opts, coord } = harness({
      ensureLocalRecordsLoaded: vi.fn(),
      prepareMediaState: vi.fn(() => { calls.push('prepare'); }),
    });
    let resolveEnsure: () => void;
    (opts.ensureLocalRecordsLoaded as any) = vi.fn(
      () => new Promise<void>((resolve) => { resolveEnsure = resolve; }),
    );

    coord.render();
    expect(opts.prepareMediaState).not.toHaveBeenCalled();
    expect(opts.updateFilteredRecords).not.toHaveBeenCalled();

    resolveEnsure!();
    await vi.waitFor(() => expect(opts.updateFilteredRecords).toHaveBeenCalledTimes(1));

    expect(opts.prepareMediaState).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['prepare', 'filter', 'list', 'page', 'banner', 'stats']);
  });

  it('IDB 分支：不调用 prepareMediaState（索引懒载只属本地路径）', async () => {
    const { calls, opts, coord } = harness({
      shouldUseIDB: () => true,
      ensureLocalRecordsLoaded: vi.fn(),
      prepareMediaState: vi.fn(() => { calls.push('prepare'); }),
    });

    coord.render();
    expect(opts.prepareMediaState).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(calls).toContain('stats'));
    expect(calls).toEqual(['stats']);
  });

  it('未注入 ensureLocalRecordsLoaded（旧接线兼容）→ 保持同步 滤/列表/分页/横幅/统计，无占位', async () => {
    const { videoList, calls, coord } = harness();
    const prev = videoList.innerHTML;

    coord.render();

    expect(calls).toEqual(['filter', 'list', 'page', 'banner', 'stats']);
    expect(videoList.innerHTML).toBe(prev);
  });
});
