/**
 * @file categoryFilterGateReplay.test.ts
 * @description 类别黑名单 live 重放的可见性门控回归（08-29-actor-passthrough-category-filter D 修复）。
 *
 * 背景：settings-updated 路径（contentMessageRouter）先 updateConfig（触发
 * reapplyCategoryFilterForAll → 视口外卡片经 actorVisibilityGate 挂起穿透重放），
 * 随后 reapplyActorHidingForAll 的 cancelAll 曾把「演员穿透」concern 的挂起任务
 * 一并误杀 → 视口外卡片滚入视口后无任何重触发 → 缓存命中的类别黑名单决策
 * 永久丢失，直到 reload。本测试编码该场景：挂起 → 强制演员重放 → 卡片可见 →
 * 缓存（此处为 fetch 桩）命中重放 → 类别命中隐藏，且只影响命中卡。
 * @module tests/dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSharedIntersectionObserversForTest } from '../../apps/extension/src/ui/lib/sharedIntersectionObserver';
import { listEnhancementManager } from '../../apps/extension/src/features/listEnhancement/listEnhancementManager';
import { createDefaultListEnhancementConfig } from '../../apps/extension/src/features/listEnhancement/domain/config';
import { STATE } from '../../apps/extension/src/features/contentState';

type FakeEntry = { target: Element; isIntersecting: boolean; intersectionRatio: number };

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly callback: (entries: FakeEntry[]) => void;
  readonly observed = new Set<Element>();

  constructor(callback: (entries: FakeEntry[]) => void) {
    this.callback = FakeIntersectionObserver.wrap(callback);
    FakeIntersectionObserver.instances.push(this);
  }

  // 共享桶的回调签名是 (entries) => void；保持与 gate 使用一致
  static wrap(callback: (entries: FakeEntry[]) => void) {
    return callback;
  }

  observe(node: Element): void {
    this.observed.add(node);
  }

  unobserve(node: Element): void {
    this.observed.delete(node);
  }

  disconnect(): void {
    this.observed.clear();
  }
}

/** 最小 zh 详情页 fixture：1 名女演员 + 類別面板（c6=93 拘束 / c2=20 OL，均在内置字典）。 */
const FIXTURE_DETAIL_HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>AAA-001 测试作品</title></head>
<body>
<div class="movie-panel-info">
  <div class="panel-block"><strong>演員:</strong><span class="value"><a href="/actors/B8gBr">宮西ひかる</a></span></div>
  <div class="panel-block"><strong>類別:</strong><span class="value">
    <a href="/tags?c6=93">拘束</a>
    <a href="/tags?c2=20">OL</a>
  </span></div>
</div>
</body>
</html>`;

function mountTwoCardList(): { cardA: HTMLElement; cardB: HTMLElement } {
  document.body.innerHTML = `
    <div class="movie-list">
      <div class="item" data-code="AAA-001">
        <div class="video-title"><strong>AAA-001</strong> 测试作品甲</div>
        <a class="cover" href="/v/AAA-001"></a>
      </div>
      <div class="item" data-code="BBB-002">
        <div class="video-title"><strong>BBB-002</strong> 测试作品乙</div>
        <a class="cover" href="/v/BBB-002"></a>
      </div>
    </div>
  `;
  return {
    cardA: document.querySelector<HTMLElement>('.item[data-code="AAA-001"]')!,
    cardB: document.querySelector<HTMLElement>('.item[data-code="BBB-002"]')!,
  };
}

function fireVisible(item: Element): void {
  for (const observer of FakeIntersectionObserver.instances) {
    if (observer.observed.has(item)) {
      observer.callback([{ target: item, isIntersecting: true, intersectionRatio: 1 }]);
    }
  }
}

function resetSingleton(): void {
  listEnhancementManager.updateConfig({ ...createDefaultListEnhancementConfig() });
  document.body.innerHTML = '';
}

afterEach(() => {
  resetSingleton();
  clearSharedIntersectionObserversForTest();
  FakeIntersectionObserver.instances = [];
  vi.unstubAllGlobals();
  STATE.settings = null;
});

describe('类别黑名单 live 重放 vs reapplyActorHidingForAll（08-29 D 修复）', () => {
  it('reapplyActorHidingForAll 不再误杀视口外卡片的穿透重放：可见后缓存重放并按黑名单隐藏', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const fetchStub = vi.fn(async (input: unknown) => ({
      url: `https://javdb575.com${String(input)}`,
      text: async () => FIXTURE_DETAIL_HTML,
    }));
    vi.stubGlobal('fetch', fetchStub);

    const { cardA, cardB } = mountTwoCardList();

    // 模拟 bootstrap 已载入设置（与 LEM 配置同源的初始值：black=c4=91）
    STATE.settings = {
      display: { hideViewed: false, hideBrowsed: false, hideWant: false, hideVR: false },
      listEnhancement: {
        enableActorPenetration: true,
        enableCategoryFilter: true,
        categoryFilter: { black: ['c4=91'] },
      },
    } as never;

    listEnhancementManager.updateConfig({
      enabled: true,
      enableClickEnhancement: false,
      enableVideoPreview: false,
      enableListOptimization: false,
      enableScrollPaging: false,
      enableActorWatermark: false,
      enableActorNameMarks: false,
      hideBlacklistedActorsInList: false,
      hideNonFavoritedActorsInList: false,
      hideUnrecognizedActorsInList: false,
      enableActorPenetration: true,
      enableCategoryFilter: true,
      categoryFilter: { black: ['c4=91'] },
    });
    listEnhancementManager.initialize();

    // 两张卡都在视口外（FakeIO 不交叠）→ 穿透延迟挂起
    await vi.waitFor(() => {
      expect(FakeIntersectionObserver.instances.length).toBeGreaterThan(0);
      expect(FakeIntersectionObserver.instances[0].observed.has(cardA)).toBe(true);
    });
    expect(fetchStub).not.toHaveBeenCalled();

    // 模拟 settings-updated 路由序列：updateConfig（类别黑名单 c4=91→c6=93，
    // 触发 reapplyCategoryFilterForAll 全量重放入队）→ reapplyActorHidingForAll
    STATE.settings = {
      display: { hideViewed: false, hideBrowsed: false, hideWant: false, hideVR: false },
      listEnhancement: {
        enableActorPenetration: true,
        enableCategoryFilter: true,
        categoryFilter: { black: ['c6=93'] },
      },
    } as never;
    listEnhancementManager.updateConfig({ categoryFilter: { black: ['c6=93'] } });
    listEnhancementManager.reapplyActorHidingForAll();

    // 卡片 A 滚入视口（用户滚动）→ 挂起的穿透重放应执行
    fireVisible(cardA);

    await vi.waitFor(() => {
      expect(cardA.getAttribute('data-hide-src-category')).toBe('true');
    }, { timeout: 5000 });

    // 命中 c6=93 → 类别来源标记 + 按开关裁定隐藏
    expect(cardA.getAttribute('data-hidden-by-default')).toBe('true');
    expect(cardA.getAttribute('data-hide-reason')).toContain('CATEGORY_BLACKLIST');
    expect(cardA.style.display).toBe('none');
    // 演员行已渲染（重放走通了穿透 process）
    expect(cardA.querySelector('[data-actor-id="B8gBr"]')).not.toBeNull();

    // 卡片 B 未进入视口：不受影响（无类别标记、可见、无穿透行）
    expect(cardB.getAttribute('data-hide-src-category')).toBeNull();
    expect(cardB.getAttribute('data-hidden-by-default')).toBeNull();
    expect(cardB.style.display).toBe('');
    expect(cardB.querySelector('[data-actor-id]')).toBeNull();
  });

  it('穿透重放在 reapplyActorHidingForAll 后仍保留：未开类别过滤时也正常渲染演员行', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const fetchStub = vi.fn(async (input: unknown) => ({
      url: `https://javdb575.com${String(input)}`,
      text: async () => FIXTURE_DETAIL_HTML,
    }));
    vi.stubGlobal('fetch', fetchStub);

    const { cardA } = mountTwoCardList();

    STATE.settings = {
      display: { hideViewed: false, hideBrowsed: false, hideWant: false, hideVR: false },
      listEnhancement: {
        enableActorPenetration: true,
        enableCategoryFilter: false,
        categoryFilter: { black: [] },
      },
    } as never;

    listEnhancementManager.updateConfig({
      enabled: true,
      enableClickEnhancement: false,
      enableVideoPreview: false,
      enableListOptimization: false,
      enableScrollPaging: false,
      enableActorWatermark: false,
      enableActorNameMarks: false,
      enableActorPenetration: true,
      enableCategoryFilter: false,
      categoryFilter: { black: [] },
    });
    listEnhancementManager.initialize();

    listEnhancementManager.reapplyActorHidingForAll();

    fireVisible(cardA);

    await vi.waitFor(() => {
      expect(cardA.querySelector('[data-actor-id="B8gBr"]')).not.toBeNull();
    }, { timeout: 5000 });

    // 类别过滤未启用：无类别标记
    expect(cardA.getAttribute('data-hide-src-category')).toBeNull();
    expect(cardA.style.display).toBe('');
  });
});
