/**
 * @file magnetCommentQuickSearch.test.ts
 * @description 磁力区「短評」评论区选文快速搜索 DOM 单测（09-29-magnet-comment-quicksearch 线）。
 *   DOM 结构按真机侦察取证还原（javdb575 /v/4VBXZ，2026-09-29，见
 *   .trellis/tasks/09-29-magnet-comment-quicksearch/research/recon-magnet-comment-dom.md）：
 *   短評为 #tabs-container 内与 #magnets 同级的 #reviews 面板，正文在
 *   `dt.review-item > div.content > p`；扩展破解注入的长評为 `dt.review-item.jhs-review-item`。
 *   钉死：开关关闭零开销、库内/注入评论均命中、非评论选区不命中、URL 用当前 origin、
 *   滚动与点击别处即隐藏（不挡后续选择操作）。
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID,
  MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID,
  MagnetCommentQuickSearchManager,
  resolveCommentScope,
  resolveSelectionEndRect,
} from '../../apps/extension/src/features/magnets/ui/magnetCommentQuickSearch';

/** 真机取证还原的详情页 tabs 结构：磁力面板 + 短評面板 + 站点原生评论 + 扩展注入评论 */
const VIDEO_PAGE_HTML = `
  <div id="tabs-container" class="tabs-container">
    <ul class="tabs">
      <li data-movie-tab-target="magnetTab"><a>磁鏈</a></li>
      <li data-movie-tab-target="reviewTab"><a class="review-tab">短評</a></li>
    </ul>
    <div id="magnets" data-movie-tab-target="magnets">
      <div id="magnets-content" class="magnet-links">
        <div class="item odd" data-rank="0">
          <div class="magnet-name">
            <a href="magnet:?xt=urn:btih:abc"><span id="magnetName" class="name">SSNI-409.1080p.MP4-NBQ</span></a>
          </div>
          <div class="date"><span class="time">2026-09-20</span></div>
        </div>
      </div>
    </div>
    <div id="reviews" data-movie-tab-target="reviews">
      <article class="message video-panel">
        <div class="message-body">
          <dl class="review-items">
            <dt class="review-item">
              <div class="content"><p id="nativeReview">這部作品的劇情非常緊湊，演員表現也很到位。</p></div>
            </dt>
            <dt class="review-item jhs-review-item">
              <div class="content jdb-review-content"><p id="jhsReview">破解注入的長評內容同樣可被選中搜尋。</p></div>
            </dt>
            <dt class="review-item">
              <div class="content"><p id="longReview">這部作品的劇情非常緊湊，演員表現也很到位，攝影與配樂同樣在水準之上，值得推薦給所有喜歡該類型的朋友。</p></div>
            </dt>
          </dl>
        </div>
      </article>
    </div>
  </div>
`;

interface FakeRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

function makeRect(partial: Partial<FakeRect> = {}): FakeRect {
  const top = partial.top ?? 200;
  const left = partial.left ?? 120;
  const width = partial.width ?? 160;
  const height = partial.height ?? 20;
  return {
    top,
    left,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height,
    width,
    height,
    x: left,
    y: top,
  };
}

/** jsdom 无布局引擎：selectionchange 判定链路依赖 Range 矩形，这里按用例注入 */
let rangeRects: FakeRect[] = [];

function selectTextIn(elementId: string, text?: string): void {
  const host = document.getElementById(elementId);
  if (!host) throw new Error(`missing #${elementId}`);
  const textNode = host.firstChild as Text;
  const full = textNode.data;
  const start = text ? full.indexOf(text) : 0;
  if (start < 0) throw new Error(`text not found in #${elementId}: ${text}`);
  const end = start + (text ? text.length : full.length);

  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection();
  if (!selection) throw new Error('window.getSelection unavailable');
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

function collapseSelection(): void {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
}

describe('磁力评论区选文快速搜索（运行时）', () => {
  let manager: MagnetCommentQuickSearchManager;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = VIDEO_PAGE_HTML;
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    rangeRects = [makeRect()];

    // jsdom 的 Range 未实现矩形 API（无布局引擎），按用例注入桩实现
    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function getClientRects() {
      return rangeRects as unknown as DOMRectList;
    };
    (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect = function getBoundingClientRect() {
      return (rangeRects[rangeRects.length - 1] ?? makeRect({ width: 0, height: 0 })) as unknown as DOMRect;
    };
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    manager = new MagnetCommentQuickSearchManager();
  });

  afterEach(() => {
    manager.destroy();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('开关关闭（默认）：initialize() 不注册监听、不注入样式、不创建浮标（零开销）', () => {
    manager.initialize();

    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID)).toBeNull();
    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID)).toBeNull();

    selectTextIn('nativeReview', '劇情非常緊湊');

    expect(manager.isFloatVisible()).toBe(false);
    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID)).toBeNull();
    expect(manager.getPendingUrl()).toBe('');
  });

  it('开关开启：选中原生短評正文 → 选区末端右侧出现 🔎 浮标，URL 基于当前 origin', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    selectTextIn('nativeReview', '劇情非常緊湊');

    const float = document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID) as HTMLButtonElement | null;
    expect(float).not.toBeNull();
    expect(manager.isFloatVisible()).toBe(true);
    expect(float!.textContent).toContain('🔎');
    expect(float!.className).toContain('jdb-mcqs-float');
    expect(float!.dataset.jdbMcqsQuery).toBe('劇情非常緊湊');
    expect(float!.title).toContain('劇情非常緊湊');

    const expectedUrl = `${window.location.origin}/search?q=${encodeURIComponent('劇情非常緊湊')}&f=all`;
    expect(manager.getPendingUrl()).toBe(expectedUrl);
    expect(manager.getPendingUrl()).not.toContain('javdb.com');

    // 落在选区末端右侧（gap=8），垂直与末端行居中
    const rect = rangeRects[0];
    expect(parseFloat(float!.style.left)).toBe(Math.round(rect.right + 8));
    expect(parseFloat(float!.style.top)).toBe(Math.round(rect.top + rect.height / 2 - 14));
  });

  it('注入样式：浮标为 fixed + 超高 z-index，并带暗色主题变体（CSS 隔离）', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    const style = document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID);
    expect(style).not.toBeNull();
    const css = style!.textContent || '';
    expect(css).toContain('.jdb-mcqs-float');
    expect(css).toContain('position: fixed');
    expect(css).toContain('z-index: 2147483000');
    expect(css).toContain('html[data-theme="dark"] .jdb-mcqs-float');
    expect(css).toContain('.jdb-mcqs-float[hidden]');
  });

  it('扩展破解注入的长評（dt.review-item.jhs-review-item）同样命中作用域', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    selectTextIn('jhsReview', '破解注入的長評內容');

    expect(manager.isFloatVisible()).toBe(true);
    expect(manager.getPendingUrl()).toContain(encodeURIComponent('破解注入的長評內容'));
  });

  it('非评论区选区（磁力行 .magnet-name）不出浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    selectTextIn('magnetName', 'SSNI-409');

    expect(manager.isFloatVisible()).toBe(false);
    expect(manager.getPendingUrl()).toBe('');
  });

  it('选区超过 30 字（划整段而非检索意图）不出浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    selectTextIn('longReview');
    expect(Array.from(document.getElementById('longReview')!.textContent!).length).toBeGreaterThan(30);

    expect(manager.isFloatVisible()).toBe(false);
    expect(manager.getPendingUrl()).toBe('');
  });

  it('恰好 30 字仍出浮标（端点闭区间）', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    const full = document.getElementById('longReview')!.textContent!;
    const thirty = Array.from(full).slice(0, 30).join('');
    selectTextIn('longReview', thirty);

    expect(Array.from(thirty).length).toBe(30);
    expect(manager.isFloatVisible()).toBe(true);
    expect(manager.getPendingUrl()).toContain(encodeURIComponent(thirty));
  });

  it('折叠选区（点击后无选中文本）不出浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(true);

    collapseSelection();
    expect(manager.isFloatVisible()).toBe(false);
    expect(manager.getPendingUrl()).toBe('');
  });

  it('选区末端在视口外时不出浮标（懒加载评论区常在折叠线以下）', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();
    rangeRects = [makeRect({ top: window.innerHeight + 400, bottom: window.innerHeight + 420 })];

    selectTextIn('nativeReview', '劇情非常緊湊');

    expect(manager.isFloatVisible()).toBe(false);
  });

  it('点击浮标：window.open 以新标签打开站内搜索并隐藏浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    selectTextIn('nativeReview', '劇情非常緊湊');
    const float = document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID) as HTMLButtonElement;
    const expectedUrl = `${window.location.origin}/search?q=${encodeURIComponent('劇情非常緊湊')}&f=all`;

    float.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(expectedUrl, '_blank', 'noopener,noreferrer');
    expect(manager.isFloatVisible()).toBe(false);
  });

  it('滚动 / resize / 点击页面别处 → 隐藏浮标，且不挡后续选择操作', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(true);

    window.dispatchEvent(new Event('scroll'));
    expect(manager.isFloatVisible()).toBe(false);

    selectTextIn('nativeReview', '演員表現');
    expect(manager.isFloatVisible()).toBe(true);

    window.dispatchEvent(new Event('resize'));
    expect(manager.isFloatVisible()).toBe(false);

    selectTextIn('nativeReview', '演員表現');
    expect(manager.isFloatVisible()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(manager.isFloatVisible()).toBe(false);

    // 拖拽期间（pointerdown 未抬起）不复现浮标，避免挡住鼠标继续划选
    selectTextIn('nativeReview', '劇情');
    expect(manager.isFloatVisible()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(true);
  });

  it('拖选抬手即出浮标：mouseup 后无需再等下一次 selectionchange（真机红绿实证）', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    // 静默建立选区（不派发 selectionchange），模拟拖拽过程中被抑制的事件
    const host = document.getElementById('nativeReview')!;
    const textNode = host.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(manager.isFloatVisible()).toBe(false);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(manager.isFloatVisible()).toBe(false);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(manager.isFloatVisible()).toBe(true);
    expect(manager.getPendingUrl()).toContain(encodeURIComponent('這部作品'));
  });

  it('原生文本拖放（dragstart→pointercancel→dragend，无 pointerup）→ 解除闭锁并按仍有效选区复现浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    // 静默建立选区：真机 DnD 路径下选区在拖放前后保持不变，全程不派发 selectionchange
    const host = document.getElementById('nativeReview')!;
    const textNode = host.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    // 在**已有选区内**再次按下并拖动 → Chrome 转原生文本拖放（09-29 真机时序取证）
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(manager.isFloatVisible()).toBe(false);
    document.body.dispatchEvent(new Event('dragstart', { bubbles: true }));
    document.body.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    document.body.dispatchEvent(new Event('drag', { bubbles: true }));
    expect(manager.isFloatVisible()).toBe(false);

    // dragend 后原选区依然有效 → 浮标复现（闭锁未被永久卡死）
    document.body.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(manager.isFloatVisible()).toBe(true);
    expect(manager.getPendingUrl()).toContain(encodeURIComponent('這部作品的劇'));
  });

  it('指针流中断（pointercancel / 窗口失焦）立即释放闭锁：下一次 selectionchange 正常出浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    selectTextIn('nativeReview', '演員表現');
    expect(manager.isFloatVisible()).toBe(true);

    // 鼠标在浏览器窗口外松开（window blur）同样不能让闭锁卡死
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(manager.isFloatVisible()).toBe(false);
    window.dispatchEvent(new Event('blur'));
    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(true);
  });

  it('updateConfig({enabled:false}) → 卸载监听、移除浮标与样式（回到零开销）', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();
    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(true);

    manager.updateConfig({ enabled: false });

    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID)).toBeNull();
    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID)).toBeNull();
    expect(manager.getPendingUrl()).toBe('');

    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(false);
  });

  it('重复 initialize() 幂等：不重复注入样式、不重复挂浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();
    manager.initialize();

    expect(document.querySelectorAll(`#${MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID}`)).toHaveLength(1);
  });

  it('跨行选区取 getClientRects() 的最后一个非空矩形作为末端锚点', () => {
    const first = makeRect({ top: 200, left: 120, right: 400, bottom: 220, width: 280, height: 20 });
    const last = makeRect({ top: 224, left: 60, right: 180, bottom: 244, width: 120, height: 20 });
    rangeRects = [first, last];

    const range = document.createRange();
    range.selectNodeContents(document.getElementById('nativeReview')!);
    const resolved = resolveSelectionEndRect(range);

    expect(resolved).not.toBeNull();
    expect(resolved!.left).toBe(last.left);
    expect(resolved!.top).toBe(last.top);
  });

  it('矩形全空（选区仅含折叠节点）时返回 null，不出浮标', () => {
    manager.updateConfig({ enabled: true });
    manager.initialize();
    rangeRects = [makeRect({ width: 0, height: 0 })];

    selectTextIn('nativeReview', '劇情非常緊湊');

    expect(manager.isFloatVisible()).toBe(false);
  });

  it('resolveCommentScope：评论正文命中，磁力区/页面根不命中', () => {
    const nativeP = document.querySelector('#nativeReview')!;
    const jhsP = document.querySelector('#jhsReview')!;
    const magnetName = document.querySelector('#magnetName')!;

    expect(resolveCommentScope(nativeP)).not.toBeNull();
    expect(resolveCommentScope(nativeP.firstChild)).not.toBeNull();
    expect(resolveCommentScope(jhsP)).not.toBeNull();
    expect(resolveCommentScope(magnetName)).toBeNull();
    expect(resolveCommentScope(document.body)).toBeNull();
    expect(resolveCommentScope(null)).toBeNull();
  });
});

/**
 * settings-updated live reapply 回归（09-29 真机红绿取证）。
 *
 * 缺陷：该开关此前只在 `bootstrap` 首屏读取一次，`contentMessageRouter` 的 live reapply
 * 未覆盖本维度 → 已打开的影片页里开开关不出 🔎 浮标（必须刷新），关开关监听/样式残留。
 * 修复后 router 调用 `reapplyFromSettings(enabled, isVideoPage)`，本组用例锁定其行为契约。
 */
describe('磁力评论区选文快速搜索（settings-updated live reapply）', () => {
  let manager: MagnetCommentQuickSearchManager;

  beforeEach(() => {
    document.body.innerHTML = VIDEO_PAGE_HTML;
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    rangeRects = [makeRect()];

    (Range.prototype as unknown as Record<string, unknown>).getClientRects = function getClientRects() {
      return rangeRects as unknown as DOMRectList;
    };
    (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect = function getBoundingClientRect() {
      return (rangeRects[rangeRects.length - 1] ?? makeRect({ width: 0, height: 0 })) as unknown as DOMRect;
    };

    manager = new MagnetCommentQuickSearchManager();
  });

  afterEach(() => {
    manager.destroy();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('live-on：影片页收到开关开启后无需刷新即挂载，选文立刻出浮标', () => {
    manager.reapplyFromSettings(true, true);

    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID)).not.toBeNull();
    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID)).not.toBeNull();

    selectTextIn('nativeReview', '劇情非常緊湊');

    expect(manager.isFloatVisible()).toBe(true);
    expect(manager.getPendingUrl()).toContain('/search?q=');
  });

  it('live-off：关闭后卸载监听/浮标/样式，再选文不出浮标（回到零开销）', () => {
    manager.reapplyFromSettings(true, true);
    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(true);

    manager.reapplyFromSettings(false, true);

    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID)).toBeNull();
    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID)).toBeNull();

    selectTextIn('nativeReview', '演員表現也很到位');
    expect(manager.isFloatVisible()).toBe(false);
    expect(manager.getPendingUrl()).toBe('');
  });

  it('非影片页即使开关为 true 也不挂载（列表页/演员页零开销）', () => {
    manager.reapplyFromSettings(true, false);

    expect(document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID)).toBeNull();
    selectTextIn('nativeReview', '劇情非常緊湊');
    expect(manager.isFloatVisible()).toBe(false);
  });

  it('脏值容忍：开关非严格 true 时不挂载', () => {
    for (const dirty of ['yes', 1, null, undefined, {}]) {
      manager.reapplyFromSettings(dirty, true);
      expect(
        document.getElementById(MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID),
        `dirty=${String(typeof dirty)}`,
      ).toBeNull();
    }
  });

  it('幂等且可反复开关：重复 live-on 不重复注入；off→on 后功能恢复', () => {
    manager.reapplyFromSettings(true, true);
    manager.reapplyFromSettings(true, true);
    expect(document.querySelectorAll(`#${MAGNET_COMMENT_QUICK_SEARCH_STYLE_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${MAGNET_COMMENT_QUICK_SEARCH_FLOAT_ID}`)).toHaveLength(1);

    manager.reapplyFromSettings(false, true);
    manager.reapplyFromSettings(true, true);

    selectTextIn('jhsReview', '破解注入的長評');
    expect(manager.isFloatVisible()).toBe(true);
  });
});
