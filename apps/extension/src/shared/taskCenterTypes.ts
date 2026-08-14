/**
 * @file taskCenterTypes.ts
 * @description 全局任务中心的核心类型定义
 * @module shared（跨上下文：background 运行时 + UI 展示层）
 *
 * 任务生命周期：registered → queued → leased → running → done/error/canceled
 * 暂停恢复：running → paused → running（通过 pauseCount/resumeCount 追踪）
 */

/** 任务状态（生命周期） */
export type GlobalTaskStatus = 'registered' | 'queued' | 'leased' | 'running' | 'paused' | 'canceled' | 'done' | 'error';
/** 任务资源开销等级，影响并发调度策略 */
export type GlobalTaskCost = 'light' | 'medium' | 'heavy';
/**
 * Visibility policy for task scheduling.
 * - foreground_first: runs with the base limit while visible; waits while hidden.
 * - background_allowed: can run while visible or hidden; hidden pages use a capped background limit.
 * - background_throttled: can prewarm while hidden with a stricter global and per-page budget.
 * - foreground_only: only runs while visible.
 */
export type GlobalTaskVisibilityPolicy = 'foreground_first' | 'background_allowed' | 'background_throttled' | 'foreground_only';
/** 任务恢复策略 —— 页面刷新后如何处理未完成任务 */
export type GlobalTaskResumePolicy = 'restart' | 'resume' | 'cache_then_skip';
/** 执行保证语义：用于可观察性与后续调度策略，不单独改变默认并发算法 */
export type GlobalTaskExecutionClass = 'must-run' | 'best-effort' | 'on-demand' | 'system-only';
/**
 * 跨页共享范围：
 * - per-page: 每页独立（默认 dedupeKey 含 pageInstanceId）
 * - dedupe-by-video / dedupe-by-action / global: 由 feature 在 dedupeKey 中编码业务身份
 */
export type GlobalTaskShareScope = 'per-page' | 'dedupe-by-video' | 'dedupe-by-action' | 'global';

/** 任务描述符 —— 创建时的静态配置，运行期间不变 */
export interface GlobalTaskDescriptor {
  taskId: string;
  label: string;                                      // UI 展示用的任务名称
  parentTaskId?: string;                              // 父任务 ID（子任务场景）
  rootTaskId?: string;                                // 根任务 ID（多级子任务场景）
  correlationId?: string;                             // 关联 ID，用于跨任务追踪
  tabId: number;                                      // 触发任务的标签页 ID
  pageUrl: string;
  pageType: string;                                   // 页面类型（如 'list'、'detail'、'actor'）
  mainId: string;                                     // 页面主标识（如番号、演员 ID）
  pageInstanceId: string;                             // 页面实例唯一标识（用于页面刷新去重）
  phase: string;                                      // 当前阶段标识
  priority: number;                                   // 优先级，数值越大越优先
  cost: GlobalTaskCost;
  visibilityPolicy: GlobalTaskVisibilityPolicy;
  timeoutMs: number;
  retryLimit: number;
  dedupeKey?: string;                                 // 去重键，相同 key 的任务不会重复创建
  registrationSource?: 'blueprint' | 'runtime';       // blueprint=预定义, runtime=运行时动态创建
  resumePolicy: GlobalTaskResumePolicy;
  executionClass?: GlobalTaskExecutionClass;
  shareScope?: GlobalTaskShareScope;
  dependsOn?: string[];                               // 前置依赖任务 ID 列表
  metadata?: Record<string, unknown>;                 // 业务自定义元数据
  createdAt: number;
}

/** 任务运行时状态 —— 随执行过程动态更新 */
export interface GlobalTaskRuntimeState {
  status: GlobalTaskStatus;
  waitReason?: string;                                // 排队等待原因
  startedAt?: number;
  endedAt?: number;
  lastProgressAt?: number;
  progressPct?: number;                               // 进度百分比（0-100）
  stage?: string;                                     // 当前执行阶段标识
  stageStartedAt?: number;
  stageDurationMs?: number;                           // 当前阶段已耗时
  detail?: string;                                    // 状态详情文本（UI 展示用）
  retryCount: number;
  pauseCount: number;
  resumeCount: number;
  heartbeatTs?: number;                               // 最后心跳时间戳，用于检测卡死
}

/** 任务完整记录 = 描述符 + 运行时状态 */
export interface GlobalTaskRecord {
  descriptor: GlobalTaskDescriptor;
  runtime: GlobalTaskRuntimeState;
}
