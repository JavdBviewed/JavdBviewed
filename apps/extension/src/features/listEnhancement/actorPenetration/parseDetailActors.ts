/**
 * @file parseDetailActors.ts
 * @description 从影片详情页 HTML 解析女性演员（纯函数，可离线测试）。
 * 只在演员面板内读取链接，按「面板级 legacy 标记预检」分两条链路判定性别：
 *  - 面板内任一演员链接带旧标记（.symbol 图标 或 ♀/♂ 文本）→ 旧链路（图标/文本符号优先，
 *    取不到则按面板标签默认：通用「演員」=female、「男優」=male），兼容旧标记镜像，行为零变化；
 *  - 面板内全部链接都无旧标记（09-29 起源站去掉性别图标后的新标记）→ 新链路：
 *    链接 class 含 actor-female → female，否则 → male（不再沿用「默认 female」兜底，
 *    否则男演员会被全员误判为女演员）。
 * 只保留判定为女性的演员，保留原始顺序，携带演员页 URL。
 * @module features/listEnhancement/actorPenetration
 */

export type ActorGender = 'female' | 'male' | 'unknown';

export interface DetailActor {
  id: string | null;
  name: string;
  href: string | null;
  gender: ActorGender;
}

const FEMALE_SYMBOL = /[\u2640♀]/;
const MALE_SYMBOL = /[\u2642♂]/;
const GENDER_SYMBOL_STRIP = /[\u2640\u2642♀♂]/g;

/** 演员链接原始数据（页内采集器产出；性别判定所需的全部周边信息）。 */
export interface RawActorLink {
  href: string;
  /** 链接文本原文（含性别符号） */
  text: string;
  /** 紧邻兄弟节点文本（nextElementSibling ?? nextSibling）；无 → null */
  nextText: string | null;
  /** 相邻 .symbol 图标的 class 属性；无 → null */
  symbolClass: string | null;
  /** 相邻 .symbol 图标文本；无 → null */
  symbolText: string | null;
  /**
   * 链接自身 class 属性原文；无 class 属性 → null。
   * 09-29 起源站去掉 ♀/♂ 图标后，女演员链接带 class="actor-female"，男演员链接无任何 class
   * （不存在 actor-male），故此字段是新标记下唯一的性别来源。
   */
  linkClass: string | null;
}

/** 演员面板原始数据（页内采集器产出；SW/无 DOM 环境可直接消费）。 */
export interface RawActorPanel {
  /** strong 标签原文 */
  label: string;
  actorLinks: RawActorLink[];
  /** 面板内是否存在任意 <a>（决定链接分支 vs .value 兜底分支，对齐 DOM 路径语义） */
  hasAnyLink: boolean;
  /** 面板内 .value 文本（无链接时的兜底）；无 → null */
  valueText: string | null;
}

/** base 是否可作为 URL 解析基址（绝对 http/https）。 */
function isUsableBaseUrl(base: string | null | undefined): base is string {
  if (!base) return false;
  try {
    const u = new URL(base);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 面板标签 → 默认性别（必须先判 male：「Male Actor(s)」含「Actor」子串）。 */
function defaultGenderForLabel(label: string): ActorGender | null {
  if (/男優|男优/i.test(label) || /male\s+actor/i.test(label)) return 'male';
  if (/演員|演员/i.test(label) || /actress/i.test(label) || /actor/i.test(label)) return 'female';
  return null;
}

/** 新标记下女演员链接的 class 词元（男演员链接无 class，源站不存在 actor-male）。 */
const ACTOR_FEMALE_CLASS = 'actor-female';

/** 链接 class 是否含 actor-female 词元（按空白切词，容忍附加 class，不误命中 foo-actor-female 子串）。 */
export function hasFemaleLinkClass(linkClass: string | null | undefined): boolean {
  if (!linkClass) return false;
  return linkClass.toLowerCase().split(/\s+/).some(token => token === ACTOR_FEMALE_CLASS);
}

/**
 * 单个链接是否携带 legacy 性别标记（.symbol 图标的 class/文本非空，或链接文本/紧邻兄弟文本含 ♀/♂）。
 * 纯函数，供面板级预检复用。
 */
export function hasLegacyGenderMarker(
  data: Pick<RawActorLink, 'text' | 'nextText' | 'symbolClass' | 'symbolText'>,
): boolean {
  if ((data.symbolClass || '').trim() || (data.symbolText || '').trim()) return true;
  const text = data.text || '';
  const nextText = data.nextText || '';
  return (
    FEMALE_SYMBOL.test(text) || MALE_SYMBOL.test(text) ||
    FEMALE_SYMBOL.test(nextText) || MALE_SYMBOL.test(nextText)
  );
}

/**
 * 面板级 legacy 标记预检：面板内任一演员链接带旧标记 → 整个面板走旧链路。
 * 按面板独立判定（同页多面板互不影响），纯函数。
 */
export function panelHasLegacyGenderMarkers(
  links: readonly Pick<RawActorLink, 'text' | 'nextText' | 'symbolClass' | 'symbolText'>[],
): boolean {
  return (links ?? []).some(hasLegacyGenderMarker);
}

/** 新标记判定：class 含 actor-female → female，否则一律 male（纯男面板 = 全链接无标记 → 全 male）。 */
function detectGenderFromLinkClass(linkClass: string | null | undefined): ActorGender {
  return hasFemaleLinkClass(linkClass) ? 'female' : 'male';
}

/** 基于原始周边数据判定性别（纯数据，DOM/无 DOM 两条路径共享；仅 legacy 链路使用）。 */
function detectGenderFromData(
  data: Pick<RawActorLink, 'text' | 'nextText' | 'symbolClass' | 'symbolText'>,
  defaultGender: ActorGender,
): ActorGender {
  const text = data.text || '';
  const inTextFemale = FEMALE_SYMBOL.test(text);
  const inTextMale = MALE_SYMBOL.test(text);
  if (inTextFemale || inTextMale) {
    if (inTextFemale && !inTextMale) return 'female';
    if (inTextMale && !inTextFemale) return 'male';
    return defaultGender;
  }

  const nextText = data.nextText || '';
  if (nextText) {
    if (FEMALE_SYMBOL.test(nextText) && !MALE_SYMBOL.test(nextText)) return 'female';
    if (MALE_SYMBOL.test(nextText) && !FEMALE_SYMBOL.test(nextText)) return 'male';
  }

  const symbol = `${data.symbolClass || ''} ${data.symbolText || ''}`;
  if (symbol.trim()) {
    if (/female|♀/.test(symbol)) return 'female';
    if (/male|♂/.test(symbol)) return 'male';
  }

  return defaultGender;
}

function normalizeHrefRaw(href: string, base: string): string | null {
  if (!href) return null;
  try {
    return href.startsWith('http') ? href : new URL(href, base).href;
  } catch {
    return href;
  }
}

/**
 * 从「演员面板原始数据」解析演员列表（含性别；与 parseDetailActors 同一套规则，
 * 供无 Document 的环境（background SW）消费页内采集的 raw panels）。
 * @param baseUrl 相对 actor href 的解析基址（站点基址或详情页 finalUrl origin）。
 */
export function actorsFromRawPanels(
  panels: readonly RawActorPanel[],
  baseUrl: string = 'https://javdb.com',
): DetailActor[] {
  const actors: DetailActor[] = [];
  for (const panel of panels ?? []) {
    const label = panel?.label || '';
    const defaultGender = defaultGenderForLabel(label);
    if (!defaultGender) continue; // 非演员面板

    const links = panel.actorLinks ?? [];
    // 面板级 legacy 标记预检：有旧标记 → 旧链路（行为零变化）；全无旧标记 → 新链路（看 linkClass）
    const legacyPresent = panelHasLegacyGenderMarkers(links);
    // 与原 DOM 路径同语义：面板内只要存在任意 <a> 就走链接分支（即使全被 /actors/ 过滤掉），
    // 仅完全无链接时才用 .value 兜底
    if (links.length > 0 || panel.hasAnyLink) {
      for (const link of links) {
        const href = link.href || '';
        if (!/\/actors\//.test(href)) continue;
        const raw = link.text || '';
        if (!raw.trim()) continue;
        const gender = legacyPresent
          ? detectGenderFromData(link, defaultGender)
          : detectGenderFromLinkClass(link.linkClass);
        const name = stripGenderSymbols(raw).trim();
        if (!name) continue;
        actors.push({ id: matchActorId(href), name, href: normalizeHrefRaw(href, baseUrl), gender });
      }
    } else {
      // 兜底：无链接时用 .value 文本，整体按面板性别判断
      const text = panel.valueText || '';
      if (text.trim()) {
        let gender: ActorGender = defaultGender;
        const hasMale = MALE_SYMBOL.test(text);
        const hasFemale = FEMALE_SYMBOL.test(text);
        if (hasMale && !hasFemale) gender = 'male';
        else if (hasFemale && !hasMale) gender = 'female';
        const name = stripGenderSymbols(text).trim();
        if (name) actors.push({ id: null, name, href: null, gender });
      }
    }
  }
  return actors;
}

/**
 * 解析详情页文档，返回所有演员（含性别）。
 * 支持两种常见 JAVDB 详情面板结构：
 *  - 标签为「演員/演员/Actor(s)/Actress」(female 默认) 与
 *    「男優/男优/Male Actor(s)」(male 默认) 的面板（镜像按 Accept-Language
 *    返回不同语言页面，英文标签兼容见 09-26-display-settings-audit B7）；
 *  - 面板内含 `.symbol.female` / `.symbol.male` 图标紧邻演员链接（legacy 链路）。
 * 09-29 起源站去掉演员性别图标：女演员链接带 `class="actor-female"`、男演员链接无任何 class，
 * 面板内全无旧标记时改走 class 链路（含 actor-female → female，否则 → male）。
 * 非演员面板（标签识别不出）整体跳过。
 */
export function parseDetailActors(doc: Document): DetailActor[] {
  const panels = doc.querySelectorAll('.panel-block, .movie-panel-info .panel-block');
  const rawPanels: RawActorPanel[] = [];

  panels.forEach(panel => {
    const strong = panel.querySelector('strong');
    const label = strong?.textContent || '';

    const actorLinks: RawActorLink[] = [];
    panel.querySelectorAll('a').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (!/\/actors\//.test(href)) return;
      const next = link.nextElementSibling || link.nextSibling;
      const symbol = link.parentElement?.querySelector('.symbol') || null;
      actorLinks.push({
        href,
        text: link.textContent || '',
        nextText: next ? (next.textContent || '') : null,
        symbolClass: symbol ? (symbol.getAttribute('class') || '') : null,
        symbolText: symbol ? (symbol.textContent || '') : null,
        linkClass: link.getAttribute('class') || null,
      });
    });

    const value = panel.querySelector('.value');
    rawPanels.push({
      label,
      actorLinks,
      hasAnyLink: panel.querySelectorAll('a').length > 0,
      valueText: value ? (value.textContent || '') : null,
    });
  });

  // baseURI 必须为绝对 http(s) 才可用作解析基址（'about:blank' 回退站点基址）
  const base = isUsableBaseUrl(doc.baseURI) ? doc.baseURI : 'https://javdb.com';
  return actorsFromRawPanels(rawPanels, base);
}

/**
 * 从解析出的全部演员中取出女性演员（保持顺序）。
 */
export function extractFemaleActors(actors: DetailActor[]): DetailActor[] {
  return actors.filter(actor => actor.gender === 'female');
}

function stripGenderSymbols(text: string): string {
  return text.replace(GENDER_SYMBOL_STRIP, '').replace(/\s{2,}/g, ' ').trim();
}

function matchActorId(href: string): string | null {
  const m = href.match(/\/actors\/([^/?#]+)/);
  return m?.[1] || null;
}

