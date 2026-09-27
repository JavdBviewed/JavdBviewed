/**
 * @vitest-environment jsdom
 * @file parse.test.ts
 * @description 离线 HTML fixture 解析测试：parseDetailCategories（详情页類別面板）
 * 与 parseTagsPageCategories（tags 页维度表，结构取自用户提供的 /tags?c10=1 片段）。
 * @module @javdb/video-category-dict
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_CATEGORY_DICTIONARY } from './builtin';
import { parseDetailCategories, parseTagsPageCategories } from './parse';
import { validateCategoryDictionary } from './validate';

function makeDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 详情页片段：類別面板（繁）+ 演员面板（应忽略）+ 无類別面板的影片（空数组路径）。 */
const DETAIL_HTML = `
<html><body>
  <div class="panel-block">
    <strong>類別:</strong>
    &nbsp;<span class="value"><a href="/tags?c3=216">兔女郎</a>,&nbsp;<a href="/tags?c2=48">蕩婦</a>,&nbsp;<a href="/tags?c2=190">禮儀小姐</a>,&nbsp;<a href="/tags?c1=157">白天出軌</a>,&nbsp;<a href="/tags?c4=65">苗條</a>,&nbsp;<a href="/tags?c7=330">素人作品</a>,&nbsp;<a href="/tags?c7=28">單體作品</a>,&nbsp;<a href="/tags?c7=347">4K</a></span>
  </div>
  <div class="panel-block">
    <strong>演員:</strong>
    &nbsp;<span class="value"><a class="actor-female" href="/actors/prXZ">宮島めい</a></span>
  </div>
  <div class="panel-block">
    <strong>發行:</strong>
    &nbsp;<span class="value">某厂牌</span>
  </div>
</body></html>`;

/** 简体「类别」标签变体（镜像 Accept-Language）。 */
const DETAIL_HTML_SIMP = `
<html><body>
  <div class="panel-block"><strong>类别:</strong>
    <span class="value"><a href="/tags?c4=17">巨乳</a>, <a href="/tags?c9=gt-120">120分鍾以上</a></span>
  </div>
</body></html>`;

/** 英文「Tags」标签变体（镜像 Accept-Language 英文详情页；2026-09-28 真机 javdb575 留证 live2/Mb0WXv.html）。 */
const DETAIL_HTML_EN = `
<html><body>
  <div class="panel-block"><strong>Tags:</strong>
    &nbsp;<span class="value"><a href="/tags?c6=93">Restraint</a>,&nbsp;<a href="/tags?c2=20">Married Woman</a>,&nbsp;<a href="/tags?c6=60">SM</a>,&nbsp;<a href="/tags?c7=28">Solowork</a></span>
  </div>
  <div class="panel-block"><strong>Actor(s):</strong>
    &nbsp;<span class="value"><a class="actor-female" href="/actors/B8gBr">宮西ひかる</a></span>
  </div>
</body></html>`;

/** 未知 id 应丢弃（不在字典内）。 */
const DETAIL_HTML_UNKNOWN = `
<html><body>
  <div class="panel-block"><strong>類別:</strong>
    <span class="value"><a href="/tags?c7=28">單體作品</a>, <a href="/tags?c7=99999">不存在</a>, <a href="/tags?c1=157">白天出軌</a></span>
  </div>
</body></html>`;

/** tags 页片段：结构对齐用户提供的 /tags?c10=1 留证（含 c10 基本/c11 年份保留位、全部链接、更多按钮）。 */
const TAGS_PAGE_HTML = `
<html><body>
  <div id="tags">
    <dl>
      <dt class="tag-category" id="tag-category-10" data-cid="10">
        <a href="javascript:void(0)" class="button is-small is-info tag-expand" data-active="true" data-cid="10">
          <span class="text">更多</span>
        </a>
        <strong>基本</strong>:
        <a class="tag is-info is-outlined" href="/tags?c10=1">全部</a>
        <span class="tag_labels">
          <a class="tag is-outlined" href="/tags?c10=1,6">可播放</a>
        </span>
      </dt>
      <dt class="collapse tag-category" id="tag-category-1" data-cid="1">
        <a href="javascript:void(0)" class="button is-small is-info is-outlined tag-expand" data-active="false" data-cid="1">
          <span class="text">更多</span>
        </a>
        <strong>主題</strong>:
        <a class="tag is-info is-outlined" href="/tags?c10=1">全部</a>
        <span class="tag_labels">
          <a class="tag is-outlined" href="/tags?c1=23&amp;c10=1">淫亂真實</a>
          <a class="tag is-outlined" href="/tags?c1=51&amp;c10=1">出軌</a>
          <a class="tag is-outlined" href="/tags?c1=157&amp;c10=1">白天出軌</a>
        </span>
      </dt>
      <dt class="collapse tag-category" id="tag-category-4" data-cid="4">
        <a href="javascript:void(0)" class="button is-small is-info is-outlined tag-expand" data-active="false" data-cid="4">
          <span class="text">更多</span>
        </a>
        <strong>體型</strong>:
        <a class="tag is-info is-outlined" href="/tags?c10=1">全部</a>
        <span class="tag_labels">
          <a class="tag is-outlined" href="/tags?c4=17&amp;c10=1">巨乳</a>
          <a class="tag is-outlined" href="/tags?c4=65&amp;c10=1">苗條</a>
        </span>
      </dt>
      <dt class="collapse tag-category" id="tag-category-9" data-cid="9">
        <a href="javascript:void(0)" class="button is-small is-info is-outlined tag-expand" data-active="false" data-cid="9">
          <span class="text">更多</span>
        </a>
        <strong>時長</strong>:
        <a class="tag is-info is-outlined" href="/tags?c10=1">全部</a>
        <span class="tag_labels">
          <a class="tag is-outlined" href="/tags?c9=lt-45&amp;c10=1">45分鍾以內</a>
          <a class="tag is-outlined" href="/tags?c9=gt-120&amp;c10=1">120分鍾以上</a>
        </span>
      </dt>
      <dt class="collapse tag-category" id="tag-category-11" data-cid="11">
        <a href="javascript:void(0)" class="button is-small is-info is-outlined tag-expand" data-active="false" data-cid="11">
          <span class="text">更多</span>
        </a>
        <strong>年份</strong>:
        <span class="tag_labels">
          <a class="tag is-outlined" href="/tags?c10=1&amp;c11=2026">2026</a>
        </span>
      </dt>
    </dl>
  </div>
</body></html>`;

describe('parseDetailCategories', () => {
  it('繁体「類別」面板：entryKey 顺序与去重', () => {
    const keys = parseDetailCategories(makeDoc(DETAIL_HTML), 'javdb');
    expect(keys).toEqual(['c3=216', 'c2=48', 'c2=190', 'c1=157', 'c4=65', 'c7=330', 'c7=28', 'c7=347']);
  });

  it('简体「类别」面板同样识别，含 c9 区间码', () => {
    const keys = parseDetailCategories(makeDoc(DETAIL_HTML_SIMP), 'javdb');
    expect(keys).toEqual(['c4=17', 'c9=gt-120']);
  });

  it('英文「Tags」面板同样识别（镜像英文变体，09-28 真机根因回归）', () => {
    const keys = parseDetailCategories(makeDoc(DETAIL_HTML_EN), 'javdb');
    expect(keys).toEqual(['c6=93', 'c2=20', 'c6=60', 'c7=28']);
  });

  it('未知 id 丢弃（不隐藏依据）', () => {
    const keys = parseDetailCategories(makeDoc(DETAIL_HTML_UNKNOWN), 'javdb');
    expect(keys).toEqual(['c7=28', 'c1=157']);
  });

  it('无類別面板的影片返回空数组', () => {
    const html = '<html><body><div class="panel-block"><strong>演員:</strong><span class="value"><a href="/actors/x1">某演员</a></span></div></body></html>';
    expect(parseDetailCategories(makeDoc(html), 'javdb')).toEqual([]);
  });

  it('忽略 c10= 等保留位参数', () => {
    const html = '<html><body><div class="panel-block"><strong>類別:</strong><span class="value"><a href="/tags?c10=1">全部</a>, <a href="/tags?c7=28">單體作品</a></span></div></body></html>';
    expect(parseDetailCategories(makeDoc(html), 'javdb')).toEqual(['c7=28']);
  });

  it('重复链接去重', () => {
    const html = '<html><body><div class="panel-block"><strong>類別:</strong><span class="value"><a href="/tags?c7=28">單體作品</a>, <a href="/tags?c7=28&amp;c10=1">單體作品</a></span></div></body></html>';
    expect(parseDetailCategories(makeDoc(html), 'javdb')).toEqual(['c7=28']);
  });

  it('年龄验证面板（英文页顶部）含 c10 快速链接 → 排除，不产出类别（09-28 统筹裁决负例）', () => {
    const html = `
<html><body>
  <div class="panel-block"><strong>Are you at least 18 years old?</strong>
    &nbsp;<span class="value">
      <a href="/tags?c10=1">Censored</a>,&nbsp;<a href="/tags?c10=1">Uncensored</a>,&nbsp;<a href="/tags?c10=1">Western</a>,&nbsp;<a href="/tags?c10=1">FC2</a>,&nbsp;<a href="/tags?c10=1">Anime</a>
    </span>
  </div>
</body></html>`;
    expect(parseDetailCategories(makeDoc(html), 'javdb')).toEqual([]);
  });

  it('导航栏「Tags」下拉链接（panel-block 之外）→ 排除', () => {
    const html = `
<html><body>
  <nav><a class="navbar-link" href="/tags?c10=1">Tags</a>
    <a class="navbar-item" href="/tags?c10=1">Censored</a>
    <a class="navbar-item" href="/tags?c10=1">Uncensored</a>
  </nav>
  <div class="panel-block"><strong>Tags:</strong>
    <span class="value"><a href="/tags?c6=93">Restraint</a></span>
  </div>
</body></html>`;
    expect(parseDetailCategories(makeDoc(html), 'javdb')).toEqual(['c6=93']);
  });

  it('含 tag 子串的非类别标签（Tagged/Tagline）→ 不误判', () => {
    const html = `
<html><body>
  <div class="panel-block"><strong>Tagged:</strong><span class="value"><a href="/tags?c7=28">單體作品</a></span></div>
  <div class="panel-block"><strong>Tagline:</strong><span class="value"><a href="/tags?c7=28">單體作品</a></span></div>
</body></html>`;
    expect(parseDetailCategories(makeDoc(html), 'javdb')).toEqual([]);
  });

  it('英文「Category」标签变体同样识别', () => {
    const html = '<html><body><div class="panel-block"><strong>Category:</strong><span class="value"><a href="/tags?c4=17">Large Breasts</a></span></div></body></html>';
    expect(parseDetailCategories(makeDoc(html), 'javdb')).toEqual(['c4=17']);
  });
});

describe('parseTagsPageCategories', () => {
  it('解析维度表：跳过 c10/c11 保留位与“全部”链接', () => {
    const dict = parseTagsPageCategories(makeDoc(TAGS_PAGE_HTML), 'javdb');
    expect(dict.activeSite).toBe('javdb');
    expect(dict.version).toBe(BUILTIN_CATEGORY_DICTIONARY.version);
    const source = dict.sources.javdb;
    expect(source.dimensionOrder).toEqual(['c1', 'c4', 'c9']);
    expect(source.dimensions.c1?.label).toBe('主題');
    expect(source.dimensions.c1?.entries.map(e => [e.id, e.label])).toEqual([
      ['23', '淫亂真實'],
      ['51', '出軌'],
      ['157', '白天出軌'],
    ]);
    expect(source.dimensions.c4?.entries.map(e => e.id)).toEqual(['17', '65']);
    expect(source.dimensions.c9?.entries.map(e => e.id)).toEqual(['lt-45', 'gt-120']);
    expect(source.dimensions).not.toHaveProperty('c10');
    expect(source.dimensions).not.toHaveProperty('c11');
  });

  it('appliesToUrl 保守默认：c1/c4 true，c9 false', () => {
    const dict = parseTagsPageCategories(makeDoc(TAGS_PAGE_HTML), 'javdb');
    expect(dict.sources.javdb.dimensions.c1?.entries.every(e => e.appliesToUrl === true)).toBe(true);
    expect(dict.sources.javdb.dimensions.c4?.entries.every(e => e.appliesToUrl === true)).toBe(true);
    expect(dict.sources.javdb.dimensions.c9?.entries.every(e => e.appliesToUrl === false)).toBe(true);
  });

  it('空 tags 页（无维度）→ 校验不过（刷新拒绝写入）', () => {
    const dict = parseTagsPageCategories(makeDoc('<html><body><div id="tags"><dl></dl></div></body></html>'), 'javdb');
    const v = validateCategoryDictionary(dict);
    expect(v.ok).toBe(false);
    expect(v.issues.length).toBeGreaterThan(0);
  });

  it('正常解析结果通过结构校验', () => {
    const dict = parseTagsPageCategories(makeDoc(TAGS_PAGE_HTML), 'javdb');
    expect(validateCategoryDictionary(dict).ok).toBe(true);
  });
});
