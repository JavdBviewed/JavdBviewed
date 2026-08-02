/**
 * @file dataDiff.ts
 * @description dataDiff
 * @module features/webdavSync
 */
// src/features/webdavSync/application/dataDiff.ts
// 数据差异分析模块

import type { VideoRecord, ActorRecord, ExtensionSettings, ActorSubscription, NewWorkRecord, NewWorksGlobalConfig } from '../../../types';

// 数据差异分析结果
export interface DataDiffResult {
    videoRecords: VideoRecordDiff;
    actorRecords: ActorRecordDiff;
    settings: SettingsDiff;
    userProfile: ProfileDiff;
    logs: LogsDiff;
    importStats: ImportStatsDiff;
    newWorks: NewWorksDiff; // 新增：新作品差异
}

// 视频记录差异
export interface VideoRecordDiff {
    cloudOnly: VideoRecord[];      // 云端独有
    localOnly: VideoRecord[];      // 本地独有
    conflicts: VideoRecordConflict[]; // 冲突记录
    identical: VideoRecord[];      // 完全相同
    summary: {
        cloudOnlyCount: number;
        localOnlyCount: number;
        conflictCount: number;
        identicalCount: number;
        totalLocal: number;
        totalCloud: number;
    };
}

// 视频记录冲突详情
export interface VideoRecordConflict {
    id: string;
    local: VideoRecord;
    cloud: VideoRecord;
    differences: string[]; // 差异字段列表
    recommendation: 'local' | 'cloud' | 'merge'; // 推荐处理方式
}

// 演员记录差异
export interface ActorRecordDiff {
    cloudOnly: ActorRecord[];
    localOnly: ActorRecord[];
    conflicts: ActorRecordConflict[];
    identical: ActorRecord[];
    summary: {
        cloudOnlyCount: number;
        localOnlyCount: number;
        conflictCount: number;
        identicalCount: number;
        totalLocal: number;
        totalCloud: number;
    };
}

// 演员记录冲突详情
export interface ActorRecordConflict {
    id: string;
    local: ActorRecord;
    cloud: ActorRecord;
    differences: string[];
    recommendation: 'local' | 'cloud' | 'merge';
}

// 设置差异
export interface SettingsDiff {
    hasConflict: boolean;
    local?: ExtensionSettings;
    cloud?: ExtensionSettings;
    differences: string[];
}

// 用户资料差异
export interface ProfileDiff {
    hasConflict: boolean;
    local?: any;
    cloud?: any;
    differences: string[];
}

// 日志差异
export interface LogsDiff {
    hasData: boolean;
    cloudCount: number;
    localCount: number;
}

// 导入统计差异
export interface ImportStatsDiff {
    hasData: boolean;
    local?: any;
    cloud?: any;
}

// 新作品差异
export interface NewWorksDiff {
    subscriptions: KeyedDiff<ActorSubscription>;
    records: KeyedDiff<NewWorkRecord>;
    config: SettingsDiff; // 复用 SettingsDiff 结构，比较配置对象
}

// 通用键值对差异结构
export interface KeyedDiff<T> {
    cloudOnly: Record<string, T>;
    localOnly: Record<string, T>;
    conflicts: Array<{ id: string; local: T; cloud: T; differences: string[]; }>;
    identical: Record<string, T>;
    summary: {
        cloudOnlyCount: number;
        localOnlyCount: number;
        conflictCount: number;
        identicalCount: number;
        totalLocal: number;
        totalCloud: number;
    };
}

// 合并策略类型
export type MergeStrategy = 'smart' | 'cloud-priority' | 'local-priority' | 'custom';

// 合并选项
export interface MergeOptions {
    strategy: MergeStrategy;
    restoreSettings: boolean;
    restoreRecords: boolean;
    restoreUserProfile: boolean;
    restoreActorRecords: boolean;
    restoreLogs: boolean;
    restoreMagnetPushLogs?: boolean;
    restoreImportStats: boolean;
    restoreNewWorks?: boolean; // 新增：是否恢复新作品（订阅/记录/配置）
    restoreLists?: boolean;
    categoryModes?: Partial<Record<
        | 'settings'
        | 'userProfile'
        | 'viewed'
        | 'actors'
        | 'newWorks'
        | 'lists'
        | 'magnets'
        | 'logs'
        | 'magnetPushLogs'
        | 'importStats',
        'skip' | 'merge' | 'replace'
    >>;
    customConflictResolutions?: Record<string, 'local' | 'cloud' | 'merge'>;
}

/**
 * 分析本地和云端数据的差异
 */
export function analyzeDataDifferences(
    localData: any,
    cloudData: any
): DataDiffResult {
    return {
        videoRecords: analyzeVideoRecordDifferences(
            localData.viewedRecords || {},
            cloudData.data || cloudData.viewed || {}
        ),
        actorRecords: analyzeActorRecordDifferences(
            localData.actorRecords || {},
            cloudData.actorRecords || {}
        ),
        settings: analyzeSettingsDifferences(
            localData.settings,
            cloudData.settings
        ),
        userProfile: analyzeProfileDifferences(
            localData.userProfile,
            cloudData.userProfile
        ),
        logs: analyzeLogsDifferences(
            localData.logs,
            cloudData.logs
        ),
        importStats: analyzeImportStatsDifferences(
            localData.importStats,
            cloudData.importStats
        ),
        newWorks: analyzeNewWorksDifferences(
            localData.newWorks || {},
            cloudData.newWorks || {}
        )
    };
}

/**
 * 分析视频记录差异
 */
function analyzeVideoRecordDifferences(
    localRecords: Record<string, VideoRecord>,
    cloudRecords: Record<string, VideoRecord>
): VideoRecordDiff {
    const cloudOnly: VideoRecord[] = [];
    const localOnly: VideoRecord[] = [];
    const conflicts: VideoRecordConflict[] = [];
    const identical: VideoRecord[] = [];

    const allIds = new Set([...Object.keys(localRecords), ...Object.keys(cloudRecords)]);

    for (const id of allIds) {
        const local = localRecords[id];
        const cloud = cloudRecords[id];

        if (!local && cloud) {
            cloudOnly.push(cloud);
        } else if (local && !cloud) {
            localOnly.push(local);
        } else if (local && cloud) {
            const differences = findVideoRecordDifferences(local, cloud);
            if (differences.length === 0) {
                identical.push(local);
            } else {
                conflicts.push({
                    id,
                    local,
                    cloud,
                    differences,
                    recommendation: getVideoRecordRecommendation(local, cloud, differences)
                });
            }
        }
    }

    return {
        cloudOnly,
        localOnly,
        conflicts,
        identical,
        summary: {
            cloudOnlyCount: cloudOnly.length,
            localOnlyCount: localOnly.length,
            conflictCount: conflicts.length,
            identicalCount: identical.length,
            totalLocal: Object.keys(localRecords).length,
            totalCloud: Object.keys(cloudRecords).length
        }
    };
}

/**
 * 查找视频记录的差异字段
 */
function findVideoRecordDifferences(local: VideoRecord, cloud: VideoRecord): string[] {
    const differences: string[] = [];

    // 比较基本字段
    if (local.title !== cloud.title) differences.push('title');
    if (local.status !== cloud.status) differences.push('status');
    if (local.releaseDate !== cloud.releaseDate) differences.push('releaseDate');
    if (local.javdbUrl !== cloud.javdbUrl) differences.push('javdbUrl');
    if (local.javdbImage !== cloud.javdbImage) differences.push('javdbImage');

    // 比较标签
    const localTags = new Set(local.tags || []);
    const cloudTags = new Set(cloud.tags || []);
    if (localTags.size !== cloudTags.size ||
        ![...localTags].every(tag => cloudTags.has(tag))) {
        differences.push('tags');
    }

    const localUserTags = new Set(local.userTags || []);
    const cloudUserTags = new Set(cloud.userTags || []);
    if (localUserTags.size !== cloudUserTags.size ||
        ![...localUserTags].every(tag => cloudUserTags.has(tag))) {
        differences.push('userTags');
    }

    // 比较时间戳
    if (local.updatedAt !== cloud.updatedAt) differences.push('updatedAt');

    return differences;
}

/**
 * 获取视频记录的推荐处理方式
 */
function getVideoRecordRecommendation(
    local: VideoRecord,
    cloud: VideoRecord,
    differences: string[]
): 'local' | 'cloud' | 'merge' {
    // 如果只有时间戳不同，选择更新的
    if (differences.length === 1 && differences[0] === 'updatedAt') {
        return local.updatedAt > cloud.updatedAt ? 'local' : 'cloud';
    }

    // 如果只有标签不同，建议合并
    if (differences.length === 1 && (differences[0] === 'tags' || differences[0] === 'userTags')) {
        return 'merge';
    }

    // 如果云端数据更新，且包含更多信息，推荐云端
    if (cloud.updatedAt > local.updatedAt) {
        const cloudHasMoreInfo = (cloud.title?.length || 0) > (local.title?.length || 0) ||
                                (cloud.tags?.length || 0) > (local.tags?.length || 0) ||
                                !!cloud.releaseDate && !local.releaseDate;
        if (cloudHasMoreInfo) return 'cloud';
    }

    // 默认推荐合并
    return 'merge';
}

/**
 * 分析演员记录差异
 */
function analyzeActorRecordDifferences(
    localRecords: Record<string, ActorRecord>,
    cloudRecords: Record<string, ActorRecord>
): ActorRecordDiff {
    const cloudOnly: ActorRecord[] = [];
    const localOnly: ActorRecord[] = [];
    const conflicts: ActorRecordConflict[] = [];
    const identical: ActorRecord[] = [];

    const allIds = new Set([...Object.keys(localRecords), ...Object.keys(cloudRecords)]);

    for (const id of allIds) {
        const local = localRecords[id];
        const cloud = cloudRecords[id];

        if (!local && cloud) {
            cloudOnly.push(cloud);
        } else if (local && !cloud) {
            localOnly.push(local);
        } else if (local && cloud) {
            const differences = findActorRecordDifferences(local, cloud);
            if (differences.length === 0) {
                identical.push(local);
            } else {
                conflicts.push({
                    id,
                    local,
                    cloud,
                    differences,
                    recommendation: getActorRecordRecommendation(local, cloud, differences)
                });
            }
        }
    }

    return {
        cloudOnly,
        localOnly,
        conflicts,
        identical,
        summary: {
            cloudOnlyCount: cloudOnly.length,
            localOnlyCount: localOnly.length,
            conflictCount: conflicts.length,
            identicalCount: identical.length,
            totalLocal: Object.keys(localRecords).length,
            totalCloud: Object.keys(cloudRecords).length
        }
    };
}

/**
 * 查找演员记录的差异字段
 */
function findActorRecordDifferences(local: ActorRecord, cloud: ActorRecord): string[] {
    const differences: string[] = [];

    if (local.name !== cloud.name) differences.push('name');
    if (local.gender !== cloud.gender) differences.push('gender');
    if (local.category !== cloud.category) differences.push('category');
    if (local.avatarUrl !== cloud.avatarUrl) differences.push('avatarUrl');
    if (local.profileUrl !== cloud.profileUrl) differences.push('profileUrl');

    // 比较别名
    const localAliases = new Set(local.aliases || []);
    const cloudAliases = new Set(cloud.aliases || []);
    if (localAliases.size !== cloudAliases.size ||
        ![...localAliases].every(alias => cloudAliases.has(alias))) {
        differences.push('aliases');
    }

    if (local.updatedAt !== cloud.updatedAt) differences.push('updatedAt');

    return differences;
}

/**
 * 获取演员记录的推荐处理方式
 */
function getActorRecordRecommendation(
    local: ActorRecord,
    cloud: ActorRecord,
    differences: string[]
): 'local' | 'cloud' | 'merge' {
    // 如果只有时间戳不同，选择更新的
    if (differences.length === 1 && differences[0] === 'updatedAt') {
        return local.updatedAt > cloud.updatedAt ? 'local' : 'cloud';
    }

    // 如果只有别名不同，建议合并
    if (differences.length === 1 && differences[0] === 'aliases') {
        return 'merge';
    }

    // 默认推荐合并
    return 'merge';
}

/**
 * 分析设置差异
 */
function analyzeSettingsDifferences(local?: ExtensionSettings, cloud?: ExtensionSettings): SettingsDiff {
    if (!local && !cloud) {
        return { hasConflict: false, differences: [] };
    }

    if (!local || !cloud) {
        return {
            hasConflict: !!cloud,
            local,
            cloud,
            differences: cloud ? ['settings'] : []
        };
    }

    // 简化的设置比较 - 实际实现中可以更详细
    const differences: string[] = [];
    if (JSON.stringify(local) !== JSON.stringify(cloud)) {
        differences.push('settings');
    }

    return {
        hasConflict: differences.length > 0,
        local,
        cloud,
        differences
    };
}

/**
 * 分析用户资料差异
 */
function analyzeProfileDifferences(local?: any, cloud?: any): ProfileDiff {
    if (!local && !cloud) {
        return { hasConflict: false, differences: [] };
    }

    if (!local || !cloud) {
        return {
            hasConflict: !!cloud,
            local,
            cloud,
            differences: cloud ? ['userProfile'] : []
        };
    }

    const differences: string[] = [];
    if (JSON.stringify(local) !== JSON.stringify(cloud)) {
        differences.push('userProfile');
    }

    return {
        hasConflict: differences.length > 0,
        local,
        cloud,
        differences
    };
}

/**
 * 新作品差异分析
 */
function analyzeNewWorksDifferences(
    localNewWorks: any,
    cloudNewWorks: any
): NewWorksDiff {
    const localSubs: Record<string, ActorSubscription> = localNewWorks.subscriptions || {};
    const cloudSubs: Record<string, ActorSubscription> = cloudNewWorks.subscriptions || {};
    const localRecords: Record<string, NewWorkRecord> = localNewWorks.records || {};
    const cloudRecords: Record<string, NewWorkRecord> = cloudNewWorks.records || {};
    const localConfig: NewWorksGlobalConfig | undefined = localNewWorks.config;
    const cloudConfig: NewWorksGlobalConfig | undefined = cloudNewWorks.config;

    return {
        subscriptions: analyzeKeyedDiff(localSubs, cloudSubs, diffActorSubscription),
        records: analyzeKeyedDiff(localRecords, cloudRecords, diffNewWorkRecord),
        config: analyzeSettingsDifferences(localConfig as any, cloudConfig as any)
    };
}

// 泛型键值对差异分析
function analyzeKeyedDiff<T extends { [k: string]: any }>(
    localMap: Record<string, T>,
    cloudMap: Record<string, T>,
    diffFn: (l: T, c: T) => string[]
): KeyedDiff<T> {
    const cloudOnly: Record<string, T> = {};
    const localOnly: Record<string, T> = {};
    const conflicts: Array<{ id: string; local: T; cloud: T; differences: string[]; }> = [];
    const identical: Record<string, T> = {};

    const allIds = new Set([...Object.keys(localMap), ...Object.keys(cloudMap)]);
    for (const id of allIds) {
        const l = localMap[id];
        const c = cloudMap[id];
        if (!l && c) {
            cloudOnly[id] = c;
        } else if (l && !c) {
            localOnly[id] = l;
        } else if (l && c) {
            const differences = diffFn(l, c);
            if (differences.length === 0) {
                identical[id] = l;
            } else {
                conflicts.push({ id, local: l, cloud: c, differences });
            }
        }
    }

    return {
        cloudOnly,
        localOnly,
        conflicts,
        identical,
        summary: {
            cloudOnlyCount: Object.keys(cloudOnly).length,
            localOnlyCount: Object.keys(localOnly).length,
            conflictCount: conflicts.length,
            identicalCount: Object.keys(identical).length,
            totalLocal: Object.keys(localMap).length,
            totalCloud: Object.keys(cloudMap).length
        }
    };
}

// 对比订阅（ActorSubscription）差异
function diffActorSubscription(l: ActorSubscription, c: ActorSubscription): string[] {
    const diffs: string[] = [];
    if (l.actorName !== c.actorName) diffs.push('actorName');
    if (l.avatarUrl !== c.avatarUrl) diffs.push('avatarUrl');
    if (l.enabled !== c.enabled) diffs.push('enabled');
    if (l.lastCheckTime !== c.lastCheckTime) diffs.push('lastCheckTime');
    if (l.subscribedAt !== c.subscribedAt) diffs.push('subscribedAt');
    return diffs;
}

// 对比新作品记录（NewWorkRecord）差异
function diffNewWorkRecord(l: NewWorkRecord, c: NewWorkRecord): string[] {
    const diffs: string[] = [];
    if (l.title !== c.title) diffs.push('title');
    if (l.releaseDate !== c.releaseDate) diffs.push('releaseDate');
    if (l.javdbUrl !== c.javdbUrl) diffs.push('javdbUrl');
    if (l.coverImage !== c.coverImage) diffs.push('coverImage');
    if ((l.tags || []).join('|') !== (c.tags || []).join('|')) diffs.push('tags');
    if (l.isRead !== c.isRead) diffs.push('isRead');
    if (l.status !== c.status) diffs.push('status');
    if (l.discoveredAt !== c.discoveredAt) diffs.push('discoveredAt');
    if (l.actorId !== c.actorId) diffs.push('actorId');
    if (l.actorName !== c.actorName) diffs.push('actorName');
    return diffs;
}



/**
 * 分析日志差异
 */
function analyzeLogsDifferences(local?: any[], cloud?: any[]): LogsDiff {
    return {
        hasData: !!(cloud && cloud.length > 0),
        cloudCount: cloud?.length || 0,
        localCount: local?.length || 0
    };
}

/**
 * 分析导入统计差异
 */
function analyzeImportStatsDifferences(local?: any, cloud?: any): ImportStatsDiff {
    return {
        hasData: !!cloud,
        local,
        cloud
    };
}
