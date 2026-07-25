/**
 * @file types.ts
 * @description 115 媒体库轻量索引类型
 * @module features/drive115/mediaLibrary
 */

/** 片库根目录（与设置 mediaLibraryRoots 对齐） */
export type Drive115MediaLibraryRoot = {
  cid: string;
  name?: string;
  path?: string;
  enabled: boolean;
};

/** 单条本地索引条目 */
export type Drive115LibraryEntry = {
  /** 稳定键：folderCid:videoFileId */
  key: string;
  /** 规范化番号；未识别时为空串 */
  code: string;
  title: string;
  folderCid: string;
  folderName: string;
  rootCid: string;
  videoFileId: string;
  pickCode: string;
  fileName: string;
  fileSize: number;
  coverFileId?: string;
  coverFileName?: string;
  nfoFileId?: string;
  nfoFileName?: string;
  nfoSummary?: {
    title?: string;
    plot?: string;
    year?: string;
  };
  updatedAt: number;
};

export type Drive115LibraryIndexStats = {
  roots: number;
  foldersSeen: number;
  indexed: number;
  skipped: number;
  unrecognized: number;
  apiCalls: number;
  /** 因 maxFolders 截断的文件夹数 */
  truncatedFolders: number;
};

export type Drive115LibraryIndexState = {
  version: 1;
  updatedAt: number;
  entries: Drive115LibraryEntry[];
  stats: Drive115LibraryIndexStats;
  lastError?: string;
};

/** 索引进度（可选回调） */
export type Drive115IndexProgress = {
  phase: 'start' | 'root' | 'folder' | 'done' | 'error';
  message: string;
  rootsTotal?: number;
  rootsDone?: number;
  foldersSeen?: number;
  indexed?: number;
  skipped?: number;
  apiCalls?: number;
};

export type Drive115IndexResult = {
  success: boolean;
  /** 是否完全沿用旧索引（失败且本轮 0 条新入库时） */
  keptPrevious: boolean;
  /** 中断/失败时是否已将本轮已扫描条目合并进旧索引并落盘 */
  partialMerged?: boolean;
  /** 本轮中断前新入库条数（合并前） */
  partialIndexed?: number;
  state: Drive115LibraryIndexState;
  message?: string;
};

/** 写入 storage 的索引进度快照，供设置页实时展示 */
export type Drive115IndexProgressSnapshot = Drive115IndexProgress & {
  running: boolean;
  updatedAt: number;
};

export const DEFAULT_DRIVE115_LIBRARY_STATS: Drive115LibraryIndexStats = {
  roots: 0,
  foldersSeen: 0,
  indexed: 0,
  skipped: 0,
  unrecognized: 0,
  apiCalls: 0,
  truncatedFolders: 0,
};

export const DEFAULT_DRIVE115_LIBRARY_STATE: Drive115LibraryIndexState = {
  version: 1,
  updatedAt: 0,
  entries: [],
  stats: { ...DEFAULT_DRIVE115_LIBRARY_STATS },
};

/** MVP 限频与保护参数 */
export const DRIVE115_INDEX_LIMITS = {
  /** 单次刷新最多扫描的影片文件夹数 */
  maxFolders: 300,
  /** 根目录之间最小间隔 ms */
  rootIntervalMs: 400,
  /** 子目录 list 最小间隔 ms */
  folderIntervalMs: 250,
  /** 连续限流错误达到此数则熔断 */
  circuitBreakerThreshold: 3,
  /** listFiles 每页 limit */
  pageLimit: 1150,
} as const;
