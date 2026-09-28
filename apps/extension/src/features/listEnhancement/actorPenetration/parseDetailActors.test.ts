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
  parseDetailActors,
  type RawActorPanel,
} from './parseDetailActors';

function makeDoc(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

// 模拟 JAVDB 详情页演员面板：女性演员面板（默认 female）+ 男优面板（默认 male），
// 链接用相邻 <span> 携带性别符号。
const DETAIL_HTML = `
<html><body>
  <div class="panel-block">
    <strong>演員</strong>
    <div class="value">
      <a href="/actors/a1001">佐藤美和</a>
      <a href="/actors/a1002">李美淑</a>
      <a href="/actors/a1003">王雪</a>
      <a href="/actors/a1004">陈可</a>
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

  it('无性别标记时按面板默认性别（演员=female）处理', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>演員</strong>
    <div class="value"><a href="/actors/x1">无标记演员</a></div>
  </div>
</body></html>`;
    const female = extractFemaleActors(parseDetailActors(makeDoc(html)));
    expect(female.map(a => a.id)).toEqual(['x1']);
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
    <div class="value"><a href="/actors/e1">Actress One</a></div>
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
    <div class="value"><a href="/actors/m3001">Male One</a></div>
  </div>
  <div class="panel-block">
    <strong>Actor(s):</strong>
    <div class="value"><a href="/actors/f3001">Female One</a></div>
  </div>
</body></html>`;
    const all = parseDetailActors(makeDoc(html));
    expect(all.find(a => a.id === 'm3001')?.gender).toBe('male');
    expect(extractFemaleActors(all).map(a => a.id)).toEqual(['f3001']);
  });

  it('识别 Actress: 为女性面板（单数变体）', () => {
    const html = `
<html><body>
  <div class="panel-block">
    <strong>Actress:</strong>
    <div class="value"><a href="/actors/a5001">Actress Two</a></div>
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
      { href: '/actors/a1001', text: '佐藤美和', nextText: null, symbolClass: null, symbolText: null },
      { href: '/actors/a1002', text: '李美淑 ♀', nextText: null, symbolClass: null, symbolText: null },
    ],
    hasAnyLink: true,
    valueText: null,
  };
  const malePanel: RawActorPanel = {
    label: 'Male Actor(s):',
    actorLinks: [{ href: '/actors/m2001', text: '山本健', nextText: null, symbolClass: null, symbolText: null }],
    hasAnyLink: true,
    valueText: null,
  };
  const nonActorPanel: RawActorPanel = {
    label: 'Release:',
    actorLinks: [{ href: '/studio/s1', text: '某厂牌', nextText: null, symbolClass: null, symbolText: null }],
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
        { href: '/actors/x1', text: '甲', nextText: '♂', symbolClass: null, symbolText: null },
        { href: '/actors/x2', text: '乙', nextText: null, symbolClass: 'symbol female', symbolText: '♀' },
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
        { href: '/actors/blank', text: '   ', nextText: null, symbolClass: null, symbolText: null },
        { href: '/actors/ok', text: '丙', nextText: null, symbolClass: null, symbolText: null },
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
