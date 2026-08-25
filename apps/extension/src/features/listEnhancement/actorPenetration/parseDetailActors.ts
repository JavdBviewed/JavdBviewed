/**
 * @file parseDetailActors.ts
 * @description 从影片详情页 HTML 解析女性演员（纯函数，可离线测试）。
 * 只在演员面板内读取链接，并检查链接附近的性别图标（.symbol.female / .symbol.male / ♀ / ♂）；
 * 只保留明确标记为女性的演员，保留原始顺序，携带演员页 URL。
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

/**
 * 解析详情页文档，返回所有演员（含性别）。
 * 支持两种常见 JAVDB 详情面板结构：
 *  - 标签为「演員/演员」(female 默认) 与「男優/男优」(male 默认) 的面板；
 *  - 面板内含 `.symbol.female` / `.symbol.male` 图标紧邻演员链接。
 * 未识别性别标记的链接按 unknown 处理。
 */
export function parseDetailActors(doc: Document): DetailActor[] {
  const panels = doc.querySelectorAll('.panel-block, .movie-panel-info .panel-block');
  const actors: DetailActor[] = [];

  panels.forEach(panel => {
    const strong = panel.querySelector('strong');
    const label = strong?.textContent || '';

    let defaultGender: ActorGender = 'unknown';
    if (/演員|演员/.test(label)) {
      defaultGender = 'female';
    } else if (/男優|男优/.test(label)) {
      defaultGender = 'male';
    } else {
      return; // 非演员面板，跳过
    }

    const links = panel.querySelectorAll('a');
    if (links.length > 0) {
      links.forEach(link => {
        const href = link.getAttribute('href') || '';
        if (!/\/actors\//.test(href)) return;
        const raw = link.textContent || '';
        if (!raw.trim()) return;

        let gender = detectGenderNearLink(link, defaultGender);
        const name = stripGenderSymbols(raw).trim();
        if (!name) return;
        const id = matchActorId(href);
        actors.push({ id, name, href: normalizeHref(href, doc), gender });
      });
    } else {
      // 兜底：无链接时用 .value 文本，整体按面板性别判断
      const value = panel.querySelector('.value');
      const text = value?.textContent || '';
      if (text.trim()) {
        let gender: ActorGender = defaultGender;
        const hasMale = MALE_SYMBOL.test(text);
        const hasFemale = FEMALE_SYMBOL.test(text);
        if (hasMale && !hasFemale) gender = 'male';
        else if (hasFemale && !hasMale) gender = 'female';
        const name = stripGenderSymbols(text).trim();
        if (name) {
          actors.push({ id: null, name, href: null, gender });
        }
      }
    }
  });

  return actors;
}

/**
 * 从解析出的全部演员中取出女性演员（保持顺序）。
 */
export function extractFemaleActors(actors: DetailActor[]): DetailActor[] {
  return actors.filter(actor => actor.gender === 'female');
}

/** 检查链接附近的性别图标，返回明确性别；无法判断时返回传入的默认性别。 */
function detectGenderNearLink(link: Element, defaultGender: ActorGender): ActorGender {
  const text = link.textContent || '';
  const inTextFemale = FEMALE_SYMBOL.test(text);
  const inTextMale = MALE_SYMBOL.test(text);
  if (inTextFemale || inTextMale) {
    if (inTextFemale && !inTextMale) return 'female';
    if (inTextMale && !inTextFemale) return 'male';
    return defaultGender;
  }

  // 检查紧邻兄弟节点（JAVDB 常用 <span>♂</span> 跟在 <a> 后）
  const next = link.nextElementSibling || link.nextSibling;
  if (next) {
    const nextText = next.textContent || '';
    if (FEMALE_SYMBOL.test(nextText) && !MALE_SYMBOL.test(nextText)) return 'female';
    if (MALE_SYMBOL.test(nextText) && !FEMALE_SYMBOL.test(nextText)) return 'male';
  }

  // 检查相邻 .symbol 图标（class 标记）
  const symbol = link.parentElement?.querySelector('.symbol');
  if (symbol) {
    if (/female|♀/.test(symbol.className + ' ' + (symbol.textContent || ''))) return 'female';
    if (/male|♂/.test(symbol.className + ' ' + (symbol.textContent || ''))) return 'male';
  }

  return defaultGender;
}

function stripGenderSymbols(text: string): string {
  return text.replace(GENDER_SYMBOL_STRIP, '').replace(/\s{2,}/g, ' ').trim();
}

function matchActorId(href: string): string | null {
  const m = href.match(/\/actors\/([^/?#]+)/);
  return m?.[1] || null;
}

function normalizeHref(href: string, doc: Document): string | null {
  if (!href) return null;
  try {
    return href.startsWith('http') ? href : new URL(href, doc.baseURI || 'https://javdb.com').href;
  } catch {
    return href;
  }
}
