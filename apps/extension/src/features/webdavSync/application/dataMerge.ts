/**
 * @file dataMerge.ts
 * @description dataMerge
 * @module features/webdavSync
 */
// src/features/webdavSync/application/dataMerge.ts
// 数据智能合并模块

import type { VideoRecord, ActorRecord, ExtensionSettings, VideoStatus, ActorSubscription, NewWorkRecord } from '../../../types';
import { mergeKeyedMap } from './mergeKeyedMap';
import type { DataDiffResult, MergeOptions } from './dataDiff';

// 合并结果
export interface MergeResult {
    success: boolean;
    error?: string;
    summary: MergeSummary;
    mergedData: {
        videoRecords?: Record<string, VideoRecord>;
        actorRecords?: Record<string, ActorRecord>;
        settings?: ExtensionSettings;
        userProfile?: any;
        logs?: any[];
        importStats?: any;
        newWorks?: {
            subscriptions?: Record<string, ActorSubscription>;
            records?: Record<string, NewWorkRecord>;
            config?: any;
        }
    };
}

// 合并摘要
export interface MergeSummary {
    videoRecords: {
        added: number;
        updated: number;
        kept: number;
        total: number;
    };
    actorRecords: {
        added: number;
        updated: number;
        kept: number;
        total: number;
    };
    newWorks: {
        subscriptions: { added: number; updated: number; kept: number; total: number; };
        records: { added: number; updated: number; kept: number; total: number; };
        config: { updated: boolean };
    };
    settings: {
        updated: boolean;
    };
    userProfile: {
        updated: boolean;
    };
    logs: {
        added: number;
    };
    importStats: {
        updated: boolean;
    };
}

/**
 * 执行数据合并
 */
export function mergeData(
    localData: any,
    cloudData: any,
    diffResult: DataDiffResult,
    options: MergeOptions
): MergeResult {
    try {
        const summary: MergeSummary = {
            videoRecords: { added: 0, updated: 0, kept: 0, total: 0 },
            actorRecords: { added: 0, updated: 0, kept: 0, total: 0 },
            newWorks: {
                subscriptions: { added: 0, updated: 0, kept: 0, total: 0 },
                records: { added: 0, updated: 0, kept: 0, total: 0 },
                config: { updated: false }
            },
            settings: { updated: false },
            userProfile: { updated: false },
            logs: { added: 0 },
            importStats: { updated: false }
        };

        const mergedData: any = {};

        // 合并视频记录
        if (options.restoreRecords) {
            const videoResult = mergeVideoRecords(
                localData.viewedRecords || {},
                cloudData.data || cloudData.viewed || {},
                diffResult.videoRecords,
                options
            );
            mergedData.videoRecords = videoResult.merged;
            summary.videoRecords = videoResult.summary;
        }

        // 合并演员记录
        if (options.restoreActorRecords) {
            const actorResult = mergeActorRecords(
                localData.actorRecords || {},
                cloudData.actorRecords || {},
                diffResult.actorRecords,
                options
            );
            mergedData.actorRecords = actorResult.merged;
            summary.actorRecords = actorResult.summary;
        }

        // 合并设置
        if (options.restoreSettings && cloudData.settings) {
            mergedData.settings = mergeSettings(
                localData.settings,
                cloudData.settings,
                options
            );
            summary.settings.updated = true;
        }

        // 合并用户资料
        if (options.restoreUserProfile && cloudData.userProfile) {
            mergedData.userProfile = mergeUserProfile(
                localData.userProfile,
                cloudData.userProfile,
                options
            );
            summary.userProfile.updated = true;
        }
        // 合并新作品（始终保留云端为主，避免过度复杂化；后续可按策略细化）
        if (options.restoreNewWorks && cloudData.newWorks) {
            mergedData.newWorks = {};
            // 订阅
            const subsResult = mergeKeyedMap<ActorSubscription>(
                localData.newWorks?.subscriptions || {},
                cloudData.newWorks.subscriptions || {},
                diffResult.newWorks.subscriptions,
                options
            );
            mergedData.newWorks.subscriptions = subsResult.merged;
            summary.newWorks.subscriptions = subsResult.summary;

            // 记录
            const recsResult = mergeKeyedMap<NewWorkRecord>(
                localData.newWorks?.records || {},
                cloudData.newWorks.records || {},
                diffResult.newWorks.records,
                options
            );
            mergedData.newWorks.records = recsResult.merged;
            summary.newWorks.records = recsResult.summary;

            // 配置
            if (cloudData.newWorks.config) {
                mergedData.newWorks.config = cloudData.newWorks.config;
                summary.newWorks.config.updated = true;
            }
        }


        // 合并日志
        if (options.restoreLogs && cloudData.logs) {
            mergedData.logs = mergeLogs(
                localData.logs || [],
                cloudData.logs,
                options
            );
            summary.logs.added = cloudData.logs.length;
        }

        // 合并导入统计
        if (options.restoreImportStats && cloudData.importStats) {
            mergedData.importStats = cloudData.importStats;
            summary.importStats.updated = true;
        }

        return {
            success: true,
            summary,
            mergedData
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message,
            summary: {
                videoRecords: { added: 0, updated: 0, kept: 0, total: 0 },
                actorRecords: { added: 0, updated: 0, kept: 0, total: 0 },
                newWorks: {
                    subscriptions: { added: 0, updated: 0, kept: 0, total: 0 },
                    records: { added: 0, updated: 0, kept: 0, total: 0 },
                    config: { updated: false }
                },
                settings: { updated: false },
                userProfile: { updated: false },
                logs: { added: 0 },
                importStats: { updated: false }
            },
            mergedData: {}
        };
    }
}

/**
 * 合并视频记录
 */
function mergeVideoRecords(
    localRecords: Record<string, VideoRecord>,
    cloudRecords: Record<string, VideoRecord>,
    diff: any,
    options: MergeOptions
): { merged: Record<string, VideoRecord>; summary: any } {
    const merged = { ...localRecords };
    let added = 0;
    let updated = 0;
    const kept = Object.keys(localRecords).length;

    switch (options.strategy) {
        case 'cloud-priority':
            // 云端优先：资料以云端为准，但本地用户标签不能被覆盖。
            for (const record of diff.cloudOnly) {
                merged[record.id] = record;
                added++;
            }
            for (const conflict of diff.conflicts) {
                merged[conflict.id] = mergeVideoRecordKeepingUserTags(conflict.local, conflict.cloud);
                updated++;
            }
            break;

        case 'local-priority':
            // 本地优先：只添加本地没有的云端记录
            for (const record of diff.cloudOnly) {
                merged[record.id] = record;
                added++;
            }
            break;

        case 'custom':
            // 自定义：根据用户选择处理冲突
            // 添加云端独有记录
            for (const record of diff.cloudOnly) {
                merged[record.id] = record;
                added++;
            }

            // 处理冲突记录
            for (const conflict of diff.conflicts) {
                const resolution = options.customConflictResolutions?.[conflict.id] || 'merge';
                switch (resolution) {
                    case 'cloud':
                        merged[conflict.id] = mergeVideoRecordKeepingUserTags(conflict.local, conflict.cloud);
                        updated++;
                        break;
                    case 'local':
                        // 保持本地不变
                        break;
                    case 'merge':
                        merged[conflict.id] = smartMergeVideoRecord(conflict.local, conflict.cloud);
                        updated++;
                        break;
                }
            }
            break;

        case 'smart':
        default:
            // 智能合并：自动处理冲突
            // 添加云端独有记录
            for (const record of diff.cloudOnly) {
                merged[record.id] = record;
                added++;
            }

            // 智能处理冲突记录
            for (const conflict of diff.conflicts) {
                switch (conflict.recommendation) {
                    case 'cloud':
                        merged[conflict.id] = mergeVideoRecordKeepingUserTags(conflict.local, conflict.cloud);
                        updated++;
                        break;
                    case 'local':
                        // 保持本地不变
                        break;
                    case 'merge':
                        merged[conflict.id] = smartMergeVideoRecord(conflict.local, conflict.cloud);
                        updated++;
                        break;
                }
            }
            break;
    }

    return {
        merged,
        summary: {
            added,
            updated,
            kept,
            total: Object.keys(merged).length
        }
    };
}

/**
 * 智能合并单个视频记录
 */
function smartMergeVideoRecord(local: VideoRecord, cloud: VideoRecord): VideoRecord {
    const now = Date.now();

    return {
        // 基础信息以最新为准
        ...local,
        ...cloud,

        // 保留原始创建时间
        createdAt: local.createdAt || cloud.createdAt,

        // 更新时间设为当前时间
        updatedAt: now,

        // 标签合并去重
        tags: [...new Set([...(local.tags || []), ...(cloud.tags || [])])],
        userTags: mergeUserTags(local.userTags, cloud.userTags),

        // 选择更完整的数据
        title: (cloud.title && cloud.title.length > (local.title?.length || 0)) ? cloud.title : local.title,
        releaseDate: cloud.releaseDate || local.releaseDate,
        javdbUrl: cloud.javdbUrl || local.javdbUrl,
        javdbImage: cloud.javdbImage || local.javdbImage,

        // 状态以更高优先级为准（viewed > want > browsed）
        status: getHigherPriorityStatus(local.status, cloud.status),

        // 合并增强数据
        enhancedData: mergeEnhancedData(local.enhancedData, cloud.enhancedData)
    };
}

function mergeUserTags(localTags?: string[], cloudTags?: string[]): string[] | undefined {
    const tags = [...(localTags || []), ...(cloudTags || [])]
        .map(tag => String(tag).trim())
        .filter(Boolean);
    const uniqueTags = [...new Set(tags)];
    return uniqueTags.length > 0 ? uniqueTags : undefined;
}

function mergeVideoRecordKeepingUserTags(local: VideoRecord, cloud: VideoRecord): VideoRecord {
    const merged: VideoRecord = { ...cloud };
    const userTags = mergeUserTags(local.userTags, cloud.userTags);
    if (userTags) {
        merged.userTags = userTags;
    } else {
        delete merged.userTags;
    }
    return merged;
}

/**
 * 获取更高优先级的状态
 */
function getHigherPriorityStatus(status1: VideoStatus, status2: VideoStatus): VideoStatus {
    const priority: Record<VideoStatus, number> = { untracked: 0, browsed: 1, want: 2, viewed: 3 };
    const p1 = priority[status1] || 0;
    const p2 = priority[status2] || 0;
    return p1 >= p2 ? status1 : status2;
}

/**
 * 合并增强数据
 */
function mergeEnhancedData(local?: any, cloud?: any): any {
    if (!local && !cloud) return undefined;
    if (!local) return cloud;
    if (!cloud) return local;

    return {
        ...local,
        ...cloud,
        // 保留最新的增强时间
        lastEnhanced: Math.max(local.lastEnhanced || 0, cloud.lastEnhanced || 0)
    };
}

/**
 * 合并演员记录
 */
function mergeActorRecords(
    localRecords: Record<string, ActorRecord>,
    cloudRecords: Record<string, ActorRecord>,
    diff: any,
    options: MergeOptions
): { merged: Record<string, ActorRecord>; summary: any } {
    const merged = { ...localRecords };
    let added = 0;
    let updated = 0;
    const kept = Object.keys(localRecords).length;

    switch (options.strategy) {
        case 'cloud-priority':
            Object.assign(merged, cloudRecords);
            added = diff.cloudOnly.length;
            updated = diff.conflicts.length;
            break;

        case 'local-priority':
            for (const record of diff.cloudOnly) {
                merged[record.id] = record;
                added++;
            }
            break;

        case 'custom':
            // 添加云端独有记录
            for (const record of diff.cloudOnly) {
                merged[record.id] = record;
                added++;
            }

            // 处理冲突记录
            for (const conflict of diff.conflicts) {
                const resolution = options.customConflictResolutions?.[conflict.id] || 'merge';
                switch (resolution) {
                    case 'cloud':
                        merged[conflict.id] = conflict.cloud;
                        updated++;
                        break;
                    case 'local':
                        break;
                    case 'merge':
                        merged[conflict.id] = smartMergeActorRecord(conflict.local, conflict.cloud);
                        updated++;
                        break;
                }
            }
            break;

        case 'smart':
        default:
            // 添加云端独有记录
            for (const record of diff.cloudOnly) {
                merged[record.id] = record;
                added++;
            }

            // 智能处理冲突记录
            for (const conflict of diff.conflicts) {
                switch (conflict.recommendation) {
                    case 'cloud':
                        merged[conflict.id] = conflict.cloud;
                        updated++;
                        break;
                    case 'local':
                        break;
                    case 'merge':
                        merged[conflict.id] = smartMergeActorRecord(conflict.local, conflict.cloud);
                        updated++;
                        break;
                }
            }
            break;
    }

    return {
        merged,
        summary: {
            added,
            updated,
            kept,
            total: Object.keys(merged).length
        }
    };
}

/**
 * 智能合并单个演员记录
 */
function smartMergeActorRecord(local: ActorRecord, cloud: ActorRecord): ActorRecord {
    const now = Date.now();

    return {
        ...local,
        ...cloud,
        createdAt: local.createdAt || cloud.createdAt,
        updatedAt: now,

        // 合并别名
        aliases: [...new Set([...(local.aliases || []), ...(cloud.aliases || [])])],

        // 选择更完整的数据
        name: cloud.name || local.name,
        avatarUrl: cloud.avatarUrl || local.avatarUrl,
        profileUrl: cloud.profileUrl || local.profileUrl,
        worksUrl: cloud.worksUrl || local.worksUrl,

        // 合并详细信息
        details: {
            ...local.details,
            ...cloud.details
        },

        // 合并同步信息
        syncInfo: cloud.syncInfo || local.syncInfo
    };
}

/**
 * 合并设置
 */
function mergeSettings(
    local?: ExtensionSettings,
    cloud?: ExtensionSettings,
    options?: MergeOptions
): ExtensionSettings {
    if (!cloud) return local!;
    if (!local) return cloud;

    // 根据策略决定如何合并设置
    switch (options?.strategy) {
        case 'cloud-priority':
            return cloud;
        case 'local-priority':
            return local;
        default:
            // 智能合并：保留用户自定义的重要设置
            return {
                ...cloud,
                // 保留本地的WebDAV配置（用户可能不想覆盖）
                webdav: local.webdav,
                // 保留本地的显示设置
                display: local.display,
                // 保留本地的用户体验设置
                userExperience: local.userExperience
            };


        }
    }





/**
 * 合并用户资料
 */
function mergeUserProfile(local?: any, cloud?: any, options?: MergeOptions): any {
    if (!cloud) return local;
    if (!local) return cloud;

    switch (options?.strategy) {
        case 'cloud-priority':
            return cloud;
        case 'local-priority':
            return local;
        default:
            // 智能合并：选择更新的数据
            return cloud;
    }
}

/**
 * 合并日志
 */
function mergeLogs(local: any[], cloud: any[], options?: MergeOptions): any[] {
    switch (options?.strategy) {
        case 'cloud-priority':
            return cloud;
        case 'local-priority':
            return local;
        default:
            // 合并并去重
            const merged = [...local];
            const localTimestamps = new Set(local.map(log => log.timestamp));

            for (const cloudLog of cloud) {
                if (!localTimestamps.has(cloudLog.timestamp)) {
                    merged.push(cloudLog);
                }
            }

            // 按时间戳排序
            return merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
}
