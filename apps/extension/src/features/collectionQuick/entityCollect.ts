/**
 * @file entityCollect.ts
 * @description 影片页 .movie-panel-info 四实体（番号/導演/片商/系列）链接识别与收藏端点构造（10-05-collection-makers-directors）
 *   - 纯函数 + 只读 DOM（CSRF 提取），可单测
 *   - 实体路径精确锚定单段：/video_codes/{id} /directors/{id} /makers/{id} /series/{id}
 *   - 收藏端点：POST {origin}/{segment}/{id}/collect
 * @module features/collectionQuick
 */

export type CollectibleEntity = 'code' | 'director' | 'maker' | 'series';

export interface ParsedEntityLink {
    entity: CollectibleEntity;
    id: string;
}

const ENTITY_PATH_PATTERNS: Array<{ entity: CollectibleEntity; pattern: RegExp }> = [
    { entity: 'code', pattern: /^\/video_codes\/([^/?#]+)$/ },
    { entity: 'director', pattern: /^\/directors\/([^/?#]+)$/ },
    { entity: 'maker', pattern: /^\/makers\/([^/?#]+)$/ },
    { entity: 'series', pattern: /^\/series\/([^/?#]+)$/ },
];

const ENTITY_SEGMENT: Record<CollectibleEntity, string> = {
    code: 'video_codes',
    director: 'directors',
    maker: 'makers',
    series: 'series',
};

/**
 * 识别四实体链接（相对/绝对、带 query/hash 均支持）。
 * 多段路径（如 /makers/AEO/videos）、非实体路径、空 ID 一律返回 null（零误伤面）。
 */
export function parseEntityLink(href: string, pageHref: string): ParsedEntityLink | null {
    if (!href) return null;
    let url: URL;
    try {
        url = new URL(href, pageHref);
    } catch {
        return null;
    }
    for (const { entity, pattern } of ENTITY_PATH_PATTERNS) {
        const m = url.pathname.match(pattern);
        if (!m) continue;
        let id: string;
        try {
            id = decodeURIComponent(m[1]);
        } catch {
            return null;
        }
        if (!id) return null;
        return { entity, id };
    }
    return null;
}

/** 构造收藏端点 URL：{origin}/{segment}/{id}/collect（id 走 encodeURIComponent） */
export function buildCollectUrl(entity: CollectibleEntity, id: string, origin: string): string {
    const base = origin.replace(/\/+$/, '');
    return `${base}/${ENTITY_SEGMENT[entity]}/${encodeURIComponent(id)}/collect`;
}

/**
 * CSRF token 三段 fallback（drive115 先例）：
 * meta[name=csrf-token].content → input[name=authenticity_token].value → null
 */
export function extractCSRFToken(): string | null {
    if (typeof document === 'undefined') return null;
    const meta = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null;
    const metaContent = meta?.getAttribute('content')?.trim();
    if (metaContent) return metaContent;
    const input = document.querySelector('input[name="authenticity_token"]') as HTMLInputElement | null;
    const inputValue = input?.value?.trim();
    if (inputValue) return inputValue;
    return null;
}
