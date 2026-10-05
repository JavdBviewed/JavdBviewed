/**
 * @file listsTabLifecycle.test.ts
 * @description 收藏中心（lists tab）生命周期测试（S1-3 修复配套）：
 *   - 隐藏 tab 后不再清空容器 DOM（二次激活避免整片重绘）
 *   - 数据未变化：重新激活跳过渲染（容器内节点身份保持）
 *   - 数据变化（updatedAt/moviesCount）：重新激活触发重渲染（节点被重建）
 *   - dispose 仍清空工作集（语义保持）
 * 激活时序复刻 navigation.ts 真实流程：先 tab:show（notify active）再 initializeTabById。
 * @module tests/dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbListsGetAllNormalizedMock } = vi.hoisted(() => ({
  dbListsGetAllNormalizedMock: vi.fn(),
}));

vi.mock('../../apps/extension/src/dashboard/dbClient', () => ({
  dbListsGetAllNormalized: (...a: unknown[]) => dbListsGetAllNormalizedMock(...a),
  dbListsPut: vi.fn().mockResolvedValue(undefined),
  dbListsDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../apps/extension/src/dashboard/state', () => ({
  STATE: {
    settings: {},
    records: [],
    logs: [],
    isInitialized: true,
  },
}));

vi.mock('../../apps/extension/src/dashboard/ui/toast', () => ({
  showMessage: vi.fn(),
}));

vi.mock('../../apps/extension/src/dashboard/components/confirmModal', () => ({
  showConfirm: vi.fn().mockResolvedValue(false),
}));

import { ListsTab } from '../../apps/extension/src/dashboard/tabs/lists';
import { dashboardTabLifecycle } from '../../apps/extension/src/dashboard/tabs/tabLifecycle';

const TAB = 'tab-lists';

function sampleLists(): Array<Record<string, unknown>> {
  return [
    { id: 'l1', source: 'local', type: 'mine', name: '本地清单A', externalId: 'ext-a', url: 'https://javdb.com/list/a', moviesCount: 3, updatedAt: 1000 },
    { id: 'l2', source: 'local', type: 'mine', name: '本地清单B', externalId: 'ext-b', url: 'https://javdb.com/list/b', moviesCount: 7, updatedAt: 2000 },
    { id: 'f1', source: 'javdb', type: 'favorite', name: '收藏清单C', externalId: 'ext-c', url: 'https://javdb.com/list/c', moviesCount: 1, updatedAt: 3000 },
    { id: 'maker:AEO', source: 'javdb', type: 'maker', name: '片商AEO', externalId: 'AEO', url: 'https://javdb.com/makers/AEO', moviesCount: 2, updatedAt: 4000 },
    { id: 'director:dekM', source: 'javdb', type: 'director', name: '導演dekM', externalId: 'dekM', url: 'https://javdb.com/directors/dekM', moviesCount: 1, updatedAt: 5000 },
  ];
}

function mountFixture(): void {
  document.body.innerHTML = `
    <div id="tab-lists" class="tab-content active">
      <input id="listsSearchInput" type="text" />
      <button id="listsRefreshBtn" type="button"></button>
      <button id="listsGoSyncBtn" type="button"></button>
      <button id="listsCreateBtn" type="button"></button>
      <div id="listsLocalCount"></div>
      <div id="listsMineCount"></div>
      <div id="listsFavCount"></div>
      <div id="listsSeriesCount"></div>
      <div id="listsMakersCount"></div>
      <div id="listsDirectorsCount"></div>
      <div id="listsLocalContainer"></div>
      <div id="listsMineContainer"></div>
      <div id="listsFavContainer"></div>
      <div id="listsSeriesContainer"></div>
      <div id="listsLabelsContainer"></div>
      <div id="listsMakersContainer"></div>
      <div id="listsDirectorsContainer"></div>
      <div id="listsEmptyTip"></div>
    </div>`;
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** 复刻真实激活顺序：navigation 先 dispatch tab:show（notify active），再 initializeTabById */
async function initActiveTab(): Promise<ListsTab> {
  dashboardTabLifecycle.notify('active', TAB);
  const tab = new ListsTab();
  await tab.initialize();
  await flush();
  return tab;
}

function firstLocal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#listsLocalContainer > *');
}

describe('ListsTab 生命周期（S1-3）', () => {
  beforeEach(() => {
    dashboardTabLifecycle.disposeAll();
    dbListsGetAllNormalizedMock.mockReset();
    dbListsGetAllNormalizedMock.mockResolvedValue(sampleLists());
    mountFixture();
  });

  it('隐藏 tab 后保留 DOM，不清空容器', async () => {
    await initActiveTab();

    const before = firstLocal();
    expect(before).not.toBeNull();
    expect(before?.textContent).toContain('本地清单A');

    dashboardTabLifecycle.notify('hidden', TAB);

    // 隐藏后容器不应被清空
    expect(firstLocal()).toBe(before);
    expect(document.querySelector('#listsLocalContainer')?.childElementCount).toBeGreaterThan(0);
  });

  it('数据未变化时重新激活跳过渲染（节点身份保持）', async () => {
    await initActiveTab();

    const before = firstLocal();
    expect(before).not.toBeNull();

    dashboardTabLifecycle.notify('hidden', TAB);
    dashboardTabLifecycle.notify('active', TAB);
    await flush();

    // 数据未变 → 不重渲染 → 原节点仍在 DOM 中
    expect(document.querySelector('#listsLocalContainer')?.firstElementChild).toBe(before);
    expect(before?.isConnected).toBe(true);
  });

  it('数据变化（updatedAt/moviesCount）时重新激活触发重渲染', async () => {
    await initActiveTab();

    const before = firstLocal();
    expect(before).not.toBeNull();

    // 模拟数据更新：bump updatedAt + moviesCount
    const changed = sampleLists().map((l) => ({
      ...l,
      updatedAt: Number(l.updatedAt) + 1,
      moviesCount: Number(l.moviesCount) + 1,
    }));
    dbListsGetAllNormalizedMock.mockResolvedValue(changed);

    dashboardTabLifecycle.notify('hidden', TAB);
    dashboardTabLifecycle.notify('active', TAB);
    await flush();

    const after = firstLocal();
    // 重渲染 → 节点被重建（身份变化），且展示新数据
    expect(after).not.toBe(before);
    expect(after?.isConnected).toBe(true);
    expect(document.querySelector('#listsLocalContainer')?.textContent).toContain('本地清单A');
  });

  it('片商/導演 子 tab 切换渲染收藏条目（data-filter-id 对齐搜索令牌）', async () => {
    const wrap = document.querySelector('#tab-lists') as HTMLElement;
    const track = document.createElement('div');
    track.className = 'lists-subtabs';
    track.innerHTML = [
      '<button class="lists-subtab active" data-subtab="lists"></button>',
      '<button class="lists-subtab" data-subtab="series"></button>',
      '<button class="lists-subtab" data-subtab="labels"></button>',
      '<button class="lists-subtab" data-subtab="makers"></button>',
      '<button class="lists-subtab" data-subtab="directors"></button>',
    ].join('');
    wrap.insertBefore(track, wrap.firstChild);

    await initActiveTab();

    (document.querySelector('.lists-subtab[data-subtab="makers"]') as HTMLButtonElement).click();
    await flush(2);

    const makers = document.querySelector('#listsMakersContainer');
    expect(makers?.textContent).toContain('片商AEO');
    expect(makers?.querySelector('.lists-item')?.getAttribute('data-filter-id')).toBe('AEO');
    expect(document.querySelector('#listsMakersCount')?.textContent).toBe('1');

    (document.querySelector('.lists-subtab[data-subtab="directors"]') as HTMLButtonElement).click();
    await flush(2);

    const directors = document.querySelector('#listsDirectorsContainer');
    expect(directors?.textContent).toContain('導演dekM');
    expect(directors?.querySelector('.lists-item')?.getAttribute('data-filter-id')).toBe('dekM');
    expect(document.querySelector('#listsDirectorsCount')?.textContent).toBe('1');
  });

  it('dispose 清空工作集（语义保持）', async () => {
    await initActiveTab();

    expect(firstLocal()).not.toBeNull();
    dashboardTabLifecycle.notify('dispose', TAB);

    expect(document.querySelector('#listsLocalContainer')?.childElementCount).toBe(0);
    expect(document.querySelector('#listsMakersContainer')?.childElementCount).toBe(0);
    expect(document.querySelector('#listsDirectorsContainer')?.childElementCount).toBe(0);
  });
});
