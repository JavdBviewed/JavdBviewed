/**
 * @vitest-environment jsdom
 * @file parseDetailActors.test.ts
 * @description 详情演员解析离线 fixture 测试
 * @module features/listEnhancement/actorPenetration
 */
import { describe, expect, it } from 'vitest';
import { extractFemaleActors, parseDetailActors } from './parseDetailActors';

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
