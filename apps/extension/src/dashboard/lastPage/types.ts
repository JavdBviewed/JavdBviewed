/**
 * @file types.ts
 * @description Dashboard 上次关闭页面记录类型
 * @module dashboard/lastPage
 */

export type DashboardLastPageRecord = {
  /** 规范化完整 hash，含 #，如 #tab-settings/drive-settings/115 */
  hash: string;
  /** 人类可读页面名 */
  title: string;
  /** 写入时间 epoch ms */
  updatedAt: number;
};
