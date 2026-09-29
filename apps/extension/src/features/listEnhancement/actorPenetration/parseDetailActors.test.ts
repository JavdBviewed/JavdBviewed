/**
 * @vitest-environment jsdom
 * @file parseDetailActors.test.ts
 * @description 详情演员解析离线 fixture 测试
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it } from 'vitest';
import {
  actorsFromRawPanels,
  extractFemaleActors,
  hasFemaleLinkClass,
  panelHasLegacyGenderMarkers,
  parseDetailActors,
  type RawActorPanel,
} from './parseDetailActors';

function makeDoc(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

// 09-29 起源站新标记详情页（12/12 采样形状）：单一「演員」混排面板，
// 女演员链接带 class="actor-female"、男演员链接无任何 class，全页无 ♀/♂ 与 .symbol 图标。
const DETAIL_HTML = `
<html><body>
  <div class="panel-block">
    <strong>演員</strong>
    <div class="value">
      <a class="actor-female" href="/actors/a1001">佐藤美和</a>
      <a class="actor-female" href="/actors/a1002">李美淑</a>
      <a class="actor-female" href="/actors/a1003">王雪</a>
      <a class="actor-female" href="/actors/a1004">陈可</a>
    </div>
  </div>
  <div class="panel-block">
    <strong>男優</strong>
    <div class="value">
      <a href="/actors/m2001">山本健</a>
    </div>
  </div>
  <div class="panel-block">
    <strong>發行</strong>
    <div class="value">某厂牌</div>
  </div>
</body></html>`;

// legacy 标记镜像（去图标前的旧版式）：链接相邻 .symbol 图标 + ♀/♂ 文本，
// 且面板内含「无标记链接」→ 必须仍按面板标签默认（演員=female / 男優=male）。
const LEGACY_HTML = `
<html><body>
  <div class="panel-block">
    <strong>演員</strong>
    <div class="value">
      <a href="/actors/l1">旧标记女演员</a><span class="symbol female">♀</span>
      <a href="/actors/l2">同面板无标记女演员</a>
    </div>
  </div>
  <div class="panel-block">
    <strong>男優</strong>
    <div class="value">
      <a href="/actors/l3">旧标记男演员</a><span>♂</span>
      <a href="/actors/l4">同面板无标记男演员</a>
    </div>
  </div>
</body></html>`;

describe('parseDetailActors', () => {
  it('保留女性演员原始顺序并携带演员页 URL', () => {
    const female = extractFemaleActors(parseDetailActors(makeDoc(DETAIL_HTML)));
    expect(female.map(a => a.name)).toEqual(['佐藤美和', '李美淑', '王雪', '陈可']);
    expect(female.map(a => a.id)).toEqual(['a1001', 'a1002', 'a1003', 'a1004']);
    // jsdom 默认 baseURI 带端口；断言路径段而非硬编码 host
    expect(female.map(a => a.href)).toEqual([
      '/actors/a1001',
      '/actors/a1002',
      '/actors/a1003',
      '/actors/a1004',
    ].map(h => new URL(h, window.location.href).href));
  });

  it('排除男优面板中的男演员', () => {
    const all = parseDetailActors(makeDoc(DETAIL_HTML));
    const female = extractFemaleActors(all);
    expect(female.some(a => a.id === 'm2001')).toBe(false);
    const male = all.filter(a => a.gender === 'male');
    expect(male.map(a => a.name)).toEqual(['山本健']);
  });

  it('跳过非演员面板（发行）', () => {
    const all = parseDetailActors(makeDoc(DETAIL_HTML));
    expect(all.some(a => a.name === '某厂牌')).toBe(false);
  });

  it('读取链接相邻的 ♀/♂ 符号覆盖面板默认性别', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>演員</strong>
    <div class="value">
      <a href="/actors/f1">女一</a><span>♀</span>
      <a href="/actors/m1">男一</a><span>♂</span>
    </div>
  </div>
</body></html>`;
    const female = extractFemaleActors(parseDetailActors(makeDoc(html)));
    expect(female.map(a => a.id)).toEqual(['f1']);
  });

  it('legacy 链路不变：面板带旧标记时，同面板无标记链接仍按面板默认性别（演員=female）', () => {
    const all = parseDetailActors(makeDoc(LEGACY_HTML));
    expect(all.find(a => a.id === 'l1')?.gender).toBe('female');
    expect(all.find(a => a.id === 'l2')?.gender).toBe('female');
    expect(extractFemaleActors(parseDetailActors(makeDoc(LEGACY_HTML))).map(a => a.id)).toEqual(['l1', 'l2']);
  });

  it('legacy 链路不变：男優面板旧标记下无标记链接按标签默认 male', () => {
    const all = parseDetailActors(makeDoc(LEGACY_HTML));
    expect(all.filter(a => a.gender === 'male').map(a => a.id)).toEqual(['l3', 'l4']);
  });

  it('新链路：面板全无旧标记时，无 class 链接判 male（不再沿用默认 female 兜底）', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>演員</strong>
    <div class="value">
      <a href="/actors/x1">无标记演员</a>
      <a class="actor-female" href="/actors/x2">class 女演员</a>
    </div>
  </div>
</body></html>`;
    const all = parseDetailActors(makeDoc(html));
    expect(all.find(a => a.id === 'x1')?.gender).toBe('male');
    expect(extractFemaleActors(parseDetailActors(makeDoc(html))).map(a => a.id)).toEqual(['x2']);
  });

  it('新链路：导演面板（無 class）不参与演员识别', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>導演</strong>
    <div class="value"><a href="/directors/d1">导演甲</a></div>
  </div>
  <div class="panel-block">
    <strong>演員</strong>
    <div class="value"><a class="actor-female" href="/actors/f1">女演员甲</a><a href="/actors/m1">男演员甲</a></div>
  </div>
</body></html>`;
    const all = parseDetailActors(makeDoc(html));
    // 导演面板标签非演员标签且链接非 /actors/ → 整面板跳过（不因「无标记=male」把导演塞进演员列表）
    expect(all.map(a => a.id)).toEqual(['f1', 'm1']);
  });

  it('空文档返回空数组且不抛错', () => {
    expect(parseDetailActors(makeDoc('<html><body></body></html>'))).toEqual([]);
    expect(extractFemaleActors(parseDetailActors(makeDoc('')))).toEqual([]);
  });
});

describe('parseDetailActors 英文标签兼容（B7：镜像按 Accept-Language 返回英文页）', () => {
  it('识别 Actor(s): 为女性面板', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>Actor(s):</strong>
    <div class="value"><a class="actor-female" href="/actors/e1">Actress One</a></div>
  </div>
</body></html>`;
    const female = extractFemaleActors(parseDetailActors(makeDoc(html)));
    expect(female.map(a => a.id)).toEqual(['e1']);
  });

  it('识别 Male Actor(s): 为男性面板（须先于女性 Actor 子串判断，顺序颠倒会误判性别）', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>Male Actor(s):</strong>
    <div class="value"><a href="/actors/m3001">Male One</a><span>♂</span><a href="/actors/m3002">Male Two</a></div>
  </div>
  <div class="panel-block">
    <strong>Actor(s):</strong>
    <div class="value"><a href="/actors/f3001">Female One</a><span>♀</span><a href="/actors/f3002">Female Two</a></div>
  </div>
</body></html>`;
    // legacy 面板（带 ♀/♂ 文本）→ 标签默认性别仍为唯一裁决（Male Actor(s) 含 Actor 子串陷阱）
    const all = parseDetailActors(makeDoc(html));
    expect(all.filter(a => a.gender === 'male').map(a => a.id)).toEqual(['m3001', 'm3002']);
    expect(extractFemaleActors(all).map(a => a.id)).toEqual(['f3001', 'f3002']);
  });

  it('识别 Actress: 为女性面板（单数变体）', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>Actress:</strong>
    <div class="value"><a class="actor-female" href="/actors/a5001">Actress Two</a></div>
  </div>
</body></html>`;
    const female = extractFemaleActors(parseDetailActors(makeDoc(html)));
    expect(female.map(a => a.id)).toEqual(['a5001']);
  });

  it('非演员英文面板（Release:）继续跳过', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>Release:</strong>
    <div class="value">Some Studio</div>
  </div>
</body></html>`;
    expect(parseDetailActors(makeDoc(html))).toEqual([]);
  });
});

describe('actorsFromRawPanels（无 DOM 环境消费页内采集数据）', () => {
  const femalePanel: RawActorPanel = {
    label: 'Actor(s):',
    actorLinks: [
      { href: '/actors/a1001', text: '佐藤美和', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
      { href: '/actors/a1002', text: '李美淑 ♀', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
    ],
    hasAnyLink: true,
    valueText: null,
  };
  const malePanel: RawActorPanel = {
    label: 'Male Actor(s):',
    actorLinks: [{ href: '/actors/m2001', text: '山本健', nextText: null, symbolClass: null, symbolText: null, linkClass: null }],
    hasAnyLink: true,
    valueText: null,
  };
  const nonActorPanel: RawActorPanel = {
    label: 'Release:',
    actorLinks: [{ href: '/studio/s1', text: '某厂牌', nextText: null, symbolClass: null, symbolText: null, linkClass: null }],
    hasAnyLink: true,
    valueText: null,
  };

  it('演员面板识别 + 性别符号 + 顺序保持（href 按 baseUrl 归一）', () => {
    const all = actorsFromRawPanels([femalePanel, malePanel, nonActorPanel], 'https://javdb.com');
    expect(all.map(a => a.id)).toEqual(['a1001', 'a1002', 'm2001']);
    const female = extractFemaleActors(all);
    expect(female.map(a => a.name)).toEqual(['佐藤美和', '李美淑']);
    expect(female.map(a => a.gender)).toEqual(['female', 'female']);
    expect(female[0].href).toBe('https://javdb.com/actors/a1001');
    expect(all.filter(a => a.gender === 'male').map(a => a.name)).toEqual(['山本健']);
  });

  it('男性默认面板不误判为女性（Male Actor(s) 含 Actor 子串陷阱）', () => {
    const all = actorsFromRawPanels([malePanel], 'https://javdb.com');
    expect(extractFemaleActors(all)).toEqual([]);
  });

  it('紧邻兄弟节点性别符号生效', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/x1', text: '甲', nextText: '♂', symbolClass: null, symbolText: null, linkClass: null },
        { href: '/actors/x2', text: '乙', nextText: null, symbolClass: 'symbol female', symbolText: '♀', linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([panel]);
    expect(all.find(a => a.id === 'x1')?.gender).toBe('male');
    expect(all.find(a => a.id === 'x2')?.gender).toBe('female');
  });

  it('非演员面板跳过；空演员名跳过', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/blank', text: '   ', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
        { href: '/actors/ok', text: '丙', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([nonActorPanel, panel]);
    expect(all.map(a => a.id)).toEqual(['ok']);
  });

  it('面板含非演员链接时不走 .value 兜底（对齐 DOM 路径语义）', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [],
      hasAnyLink: true, // 面板内有 <a>（全被 /actors/ 过滤）
      valueText: '不该被当成演员的文本',
    };
    expect(actorsFromRawPanels([panel])).toEqual([]);
  });

  it('完全无链接 → .value 文本兜底（按面板性别）', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [],
      hasAnyLink: false,
      valueText: '佐藤美和, 李美淑',
    };
    const all = actorsFromRawPanels([panel]);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('佐藤美和, 李美淑');
    expect(all[0].gender).toBe('female');
    expect(all[0].id).toBeNull();
  });

  it('脏输入安全', () => {
    expect(actorsFromRawPanels([])).toEqual([]);
    expect(actorsFromRawPanels(null as any)).toEqual([]);
  });
});

describe('actorsFromRawPanels 新标记链路（09-29 源站去性别图标 → class="actor-female"）', () => {
  /** 混排面板：1 个 actor-female + 2 个无标记（recon 0eE3EX 形状：1 女 class + 3 无 class）。 */
  it('a. 新标记混排面板 → 1 女 2 男', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/f1', text: '女一', nextText: ',', symbolClass: null, symbolText: null, linkClass: 'actor-female' },
        { href: '/actors/m1', text: '男一', nextText: ', ', symbolClass: null, symbolText: null, linkClass: null },
        { href: '/actors/m2', text: '男二', nextText: ' ', symbolClass: null, symbolText: null, linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([panel]);
    expect(all.map(a => a.gender)).toEqual(['female', 'male', 'male']);
    expect(extractFemaleActors(all).map(a => a.id)).toEqual(['f1']);
  });

  /** 纯男面板：全部链接无旧标记且无 class → 全 male（禁止沿用「默认 female」兜底）。 */
  it('b. 新标记纯男面板 → 全 male', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/m1', text: '男一', nextText: ',', symbolClass: null, symbolText: null, linkClass: null },
        { href: '/actors/m2', text: '男二', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([panel]);
    expect(all.map(a => a.gender)).toEqual(['male', 'male']);
    expect(extractFemaleActors(all)).toEqual([]);
  });

  /** 全女面板（recon MKMP-757 形状：11 链接全带 actor-female）。 */
  it('c. 新标记全女面板 → 全 female', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: Array.from({ length: 11 }, (_, i) => ({
        href: `/actors/f${i + 1}`,
        text: `女${i + 1}`,
        nextText: ',',
        symbolClass: null,
        symbolText: null,
        linkClass: 'actor-female',
      })),
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([panel]);
    expect(all).toHaveLength(11);
    expect(all.every(a => a.gender === 'female')).toBe(true);
    expect(extractFemaleActors(all).map(a => a.id)).toEqual(
      Array.from({ length: 11 }, (_, i) => `f${i + 1}`),
    );
  });

  /** legacy 面板：.symbol 图标 或 ♀ 文本 → 旧链完全不变，含无标记链接走标签默认。 */
  it('d. legacy 标记面板 → 旧链路零变化（无标记链接按标签默认 female/male）', () => {
    const actressPanel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/l1', text: '旧标记女', nextText: null, symbolClass: 'symbol female', symbolText: '♀', linkClass: null },
        { href: '/actors/l2', text: '同面板无标记', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const malePanel: RawActorPanel = {
      label: '男優:',
      actorLinks: [
        { href: '/actors/l3', text: '旧标记男', nextText: '♂', symbolClass: null, symbolText: null, linkClass: null },
        { href: '/actors/l4', text: '同面板无标记', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([actressPanel, malePanel]);
    expect(all.map(a => a.gender)).toEqual(['female', 'female', 'male', 'male']);
    // class 缺失不影响 legacy 链路（旧镜像根本没有 actor-female class）
    expect(extractFemaleActors(all).map(a => a.id)).toEqual(['l1', 'l2']);
  });

  /** legacy 面板里 class 与旧标记冲突：旧标记优先（行为零变化）。 */
  it('d2. legacy 面板优先：无旧标记语义时 class 不参与（male 链接带 actor-female 仍走旧链默认）', () => {
    const panel: RawActorPanel = {
      label: '男優:',
      actorLinks: [
        { href: '/actors/l5', text: '男一', nextText: null, symbolClass: 'symbol male', symbolText: '♂', linkClass: 'actor-female' },
        { href: '/actors/l6', text: '男二', nextText: null, symbolClass: null, symbolText: null, linkClass: 'actor-female' },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([panel]);
    expect(all.map(a => a.gender)).toEqual(['male', 'male']);
  });

  /** 同页双面板混合：一个带 legacy 标记 + 一个不带 → 各自按面板独立判定。 */
  it('e. 同页双面板混合 → 面板级预检互不影响', () => {
    const legacyPanel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/L1', text: 'legacy 女', nextText: null, symbolClass: 'symbol female', symbolText: '♀', linkClass: null },
        { href: '/actors/L2', text: 'legacy 无标记', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const newPanel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/N1', text: '新标记女', nextText: ',', symbolClass: null, symbolText: null, linkClass: 'actor-female' },
        { href: '/actors/N2', text: '新标记男', nextText: null, symbolClass: null, symbolText: null, linkClass: null },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([legacyPanel, newPanel]);
    expect(all.map(a => [a.id, a.gender])).toEqual([
      ['L1', 'female'],
      ['L2', 'female'],
      ['N1', 'female'],
      ['N2', 'male'],
    ]);
    expect(extractFemaleActors(all).map(a => a.id)).toEqual(['L1', 'L2', 'N1']);
  });

  /** 附加 class（class="actor-female is-active"）仍识别为 female。 */
  it('f. class="actor-female xxx" 附加 class → female', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [
        { href: '/actors/f1', text: '女一', nextText: ',', symbolClass: null, symbolText: null, linkClass: 'actor-female is-active' },
        { href: '/actors/m1', text: '男一', nextText: null, symbolClass: null, symbolText: null, linkClass: 'button is-small' },
      ],
      hasAnyLink: true,
      valueText: null,
    };
    const all = actorsFromRawPanels([panel]);
    expect(all.map(a => a.gender)).toEqual(['female', 'male']);
  });

  it('class 词元匹配：不误命中 actor-female-x / xactor-female 子串', () => {
    expect(hasFemaleLinkClass('actor-female')).toBe(true);
    expect(hasFemaleLinkClass('actor-female btn')).toBe(true);
    expect(hasFemaleLinkClass('btn actor-female')).toBe(true);
    expect(hasFemaleLinkClass('not-actor-female')).toBe(false);
    expect(hasFemaleLinkClass('actor-male')).toBe(false);
    expect(hasFemaleLinkClass('')).toBe(false);
    expect(hasFemaleLinkClass(null)).toBe(false);
    expect(hasFemaleLinkClass(undefined)).toBe(false);
  });

  it('面板级 legacy 预检纯函数：仅看面板内演员链接的旧标记', () => {
    expect(panelHasLegacyGenderMarkers([])).toBe(false);
    expect(panelHasLegacyGenderMarkers([
      { text: '甲', nextText: ',', symbolClass: null, symbolText: null },
    ])).toBe(false);
    expect(panelHasLegacyGenderMarkers([
      { text: '乙', nextText: '♂', symbolClass: null, symbolText: null },
    ])).toBe(true);
    expect(panelHasLegacyGenderMarkers([
      { text: '丙', nextText: null, symbolClass: 'symbol', symbolText: '' },
    ])).toBe(true);
  });

  /** 面板内完全无链接 → 走 .value 兜底分支，维持标签默认（不受本次改动影响）。 */
  it('无链接面板 .value 兜底维持标签默认 female', () => {
    const panel: RawActorPanel = {
      label: '演員:',
      actorLinks: [],
      hasAnyLink: false,
      valueText: '无名演员',
    };
    const all = actorsFromRawPanels([panel]);
    expect(all).toEqual([{ id: null, name: '无名演员', href: null, gender: 'female' }]);
  });

  /** DOM 路径同规则：真实线上形状（class 女 + 逗号文本 + 无 class 男，无 .symbol）。 */
  it('DOM 路径新标记混排面板 → 只出女演员', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>演員:</strong> &nbsp;<span class="value"> <a class="actor-female" href="/actors/f1">女一</a>, <a href="/actors/m1">男一</a> </span>
  </div>
</body></html>`;
    const all = parseDetailActors(makeDoc(html));
    expect(all.map(a => [a.id, a.gender])).toEqual([['f1', 'female'], ['m1', 'male']]);
    expect(extractFemaleActors(all).map(a => a.id)).toEqual(['f1']);
  });
});

