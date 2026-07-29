/**
 * @file detailCategoryTags.ts
 * @description 数据同步详情页类别标签解析工具
 * @module dashboard/dataSync
 */

export function extractDetailCategoryTagsFromHTML(html: string): string[] {
    const tags: string[] = [];
    const panelBlockRegex = /<div\b([^>]*)class=["']([^"']*\bpanel-block\b[^"']*)["']([^>]*)>([\s\S]*?)<\/div>/gi;
    let blockMatch: RegExpExecArray | null;

    while ((blockMatch = panelBlockRegex.exec(html)) !== null) {
        const className = blockMatch[2] || '';
        const blockHtml = blockMatch[4] || '';
        const isGenreBlock = hasClassName(className, 'genre');
        const labelText = stripHtmlTags(blockHtml.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '');
        const isCategoryLabel = /類別|类别|Category/i.test(labelText);

        if (!isGenreBlock && !isCategoryLabel) continue;

        const valueHtml = blockHtml.match(/<span\b[^>]*class=["'][^"']*value[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || blockHtml;
        const links = valueHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
        for (const linkMatch of links) {
            const href = linkMatch[1] || '';
            if (!isNativeCategoryHref(href)) continue;
            const tag = stripHtmlTags(linkMatch[2] || '').trim();
            if (tag && !tags.includes(tag)) {
                tags.push(tag);
            }
        }

        if (tags.length > 0) {
            return tags;
        }
    }

    return tags;
}

function hasClassName(className: string, expectedClassName: string): boolean {
    return className.split(/\s+/).some((item) => item === expectedClassName);
}

function isNativeCategoryHref(href: string): boolean {
    const rawHref = String(href || '').trim();
    if (!rawHref) return false;

    try {
        const url = new URL(rawHref, 'https://javdb.com');
        return url.pathname.startsWith('/tags') || url.pathname.startsWith('/genres');
    } catch {
        return rawHref.startsWith('/tags') || rawHref.startsWith('/genres');
    }
}

function stripHtmlTags(html: string): string {
    return String(html || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}
