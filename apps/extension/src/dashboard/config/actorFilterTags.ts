/**
 * 演员页影片过滤标签配置
 * 用于定义可用的过滤标签及其显示文本
 *
 * 08-29-actor-passthrough-category-filter P2：category 组改为从公共类别字典
 * （@javdb/video-category-dict，311 项内置快照）派生，value 统一为 entryKey（`cN=ID`）；
 * basic/quality 组（t 码）保留原地，它们不是类别维度。
 */
import { BUILTIN_CATEGORY_DICTIONARY, entryKey } from '@javdb/video-category-dict';

export interface ActorFilterTag {
    /** 标签值（用于存储和API） */
    value: string;
    /** 显示文本 */
    label: string;
    /** 标签描述（可选） */
    description?: string;
    /** 是否默认选中 */
    defaultChecked?: boolean;
    /** 标签分组（可选） */
    group?: 'basic' | 'quality' | 'category' | 'custom';
    /** 仅 category 组：该维度 ?cN= 是否经实测可用于作品列表 URL（保守默认 false） */
    appliesToUrl?: boolean;
}

/**
 * 演员页影片过滤标签列表
 */
export const ACTOR_FILTER_TAGS: ActorFilterTag[] = [
    // 基础过滤标签
    {
        value: 's',
        label: '单体作品',
        description: '只显示单个演员的作品',
        defaultChecked: true,
        group: 'basic'
    },
    {
        value: 'p',
        label: '可播放',
        description: '只显示可在线播放的作品',
        defaultChecked: false,
        group: 'basic'
    },
    {
        value: 'd',
        label: '含磁链',
        description: '只显示包含磁力链接的作品',
        defaultChecked: true,
        group: 'basic'
    },
    {
        value: 'c',
        label: '含字幕',
        description: '只显示有中文字幕的作品',
        defaultChecked: false,
        group: 'basic'
    },
    
    // 画质标签
    {
        value: '4k',
        label: '4K',
        description: '只显示4K画质的作品',
        defaultChecked: false,
        group: 'quality'
    },
    {
        value: 'uncensored',
        label: '无码流出',
        description: '只显示无码流出的作品',
        defaultChecked: false,
        group: 'quality'
    },
    
    // 常见类别标签（08-29-actor-passthrough-category-filter P2：从公共字典派生，
    // value = entryKey `cN=ID`，311 项全量；旧裸数字 id 由 normalizeActorDefaultTags 透明迁移）
    ...(categoryTagsFromDictionary()),
];

/** 从内置类别字典派生 category 组（维度顺序与 /tags 页一致）。 */
function categoryTagsFromDictionary(): ActorFilterTag[] {
    const source = BUILTIN_CATEGORY_DICTIONARY.sources[BUILTIN_CATEGORY_DICTIONARY.activeSite];
    const tags: ActorFilterTag[] = [];
    for (const dim of source.dimensionOrder) {
        const dimension = source.dimensions[dim];
        if (!dimension) continue;
        for (const entry of dimension.entries) {
            tags.push({
                value: entryKey(dim, entry.id),
                label: entry.label,
                description: `类别：${entry.label}`,
                defaultChecked: false,
                group: 'category',
                appliesToUrl: entry.appliesToUrl === true,
            });
        }
    }
    return tags;
}


/**
 * 获取默认选中的标签值列表
 */
export function getDefaultTags(): string[] {
    return ACTOR_FILTER_TAGS
        .filter(tag => tag.defaultChecked)
        .map(tag => tag.value);
}

/**
 * 根据值获取标签配置
 */
export function getTagByValue(value: string): ActorFilterTag | undefined {
    return ACTOR_FILTER_TAGS.find(tag => tag.value === value);
}

/**
 * 获取所有标签值
 */
export function getAllTagValues(): string[] {
    return ACTOR_FILTER_TAGS.map(tag => tag.value);
}

/**
 * 根据分组获取标签
 */
export function getTagsByGroup(group: 'basic' | 'quality' | 'category' | 'custom'): ActorFilterTag[] {
    return ACTOR_FILTER_TAGS.filter(tag => tag.group === group);
}

/**
 * 获取基础标签（常用的）
 */
export function getBasicTags(): ActorFilterTag[] {
    return getTagsByGroup('basic');
}
