/**
 * @file scheduler.ts
 * @description 新作品定时采集调度器（chrome.alarms 周期路径）
 * @module features/newWorks
 */
// src/features/newWorks/scheduler.ts

import type { NewWorksManager } from './manager';
import type { NewWorksCollector } from './collector';
import { log } from '../../utils/logController';

/** 新作品周期检查 alarm 名称 */
export const NEW_WORKS_CHECK_ALARM = 'newWorks.periodic_check';

/**
 * 将检查间隔（小时）转换为 chrome.alarms 的 periodInMinutes。
 * Chrome 要求 periodInMinutes 至少为 1。
 */
export function resolveNewWorksPeriodInMinutes(checkIntervalHours: number): number {
  const hours = Number(checkIntervalHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return 24 * 60;
  }
  return Math.max(1, Math.round(hours * 60));
}

export class NewWorksScheduler {
  private isRunning: boolean = false;
  private isInitialized: boolean = false;
  private firstRunTimeoutId?: ReturnType<typeof setTimeout>;
  private manager?: NewWorksManager;
  private collector?: NewWorksCollector;

  /**
   * 设置依赖
   */
  setDependencies(manager: NewWorksManager, collector: NewWorksCollector): void {
    this.manager = manager;
    this.collector = collector;
  }

  /**
   * 初始化调度器（幂等）：确保 alarm 与配置一致
   */
  async initialize(): Promise<void> {
    if (!this.manager || !this.collector) {
      throw new Error('NewWorksScheduler: 必须先调用 setDependencies 设置依赖');
    }

    try {
      await this.manager.initialize();

      const config = await this.manager.getGlobalConfig();
      if (config.autoCheckEnabled) {
        await this.start();
      } else {
        await this.clearAlarm();
        this.isRunning = false;
      }

      this.isInitialized = true;
      log.verbose('NewWorksScheduler: 初始化完成');
    } catch (error) {
      log.error('NewWorksScheduler: 初始化失败:', error);
    }
  }

  /**
   * 启动周期检查（clear + create alarm）
   */
  async start(): Promise<void> {
    if (!this.manager) {
      throw new Error('NewWorksScheduler: 必须先调用 setDependencies 设置依赖');
    }

    try {
      const config = await this.manager.getGlobalConfig();

      if (!config.autoCheckEnabled) {
        log.verbose('NewWorksScheduler: 自动检查未开启');
        await this.clearAlarm();
        this.isRunning = false;
        return;
      }

      const periodInMinutes = resolveNewWorksPeriodInMinutes(config.checkInterval);
      await this.clearAlarm();
      await this.createAlarm(periodInMinutes);

      this.isRunning = true;
      log.info(`NewWorksScheduler: 定时任务已启动，间隔 ${config.checkInterval} 小时（${periodInMinutes} 分钟）`);

      // 首次运行保留一次性延迟检查；周期路径不依赖 setInterval
      if (!config.lastGlobalCheck) {
        log.verbose('NewWorksScheduler: 首次运行，延迟执行一次检查');
        this.scheduleFirstRunCheck();
      }
    } catch (error) {
      log.error('NewWorksScheduler: 启动定时任务失败:', error);
    }
  }

  /**
   * 停止定时任务并清理 alarm
   */
  async stop(): Promise<void> {
    this.clearFirstRunTimeout();
    await this.clearAlarm();
    this.isRunning = false;
    log.verbose('NewWorksScheduler: 定时任务已停止');
  }

  /**
   * 重启定时任务
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * alarmRouter 入口：匹配周期 alarm 后执行采集
   * @returns 是否已处理该 alarm
   */
  async handleAlarm(alarmName: string): Promise<boolean> {
    if (alarmName !== NEW_WORKS_CHECK_ALARM) {
      return false;
    }
    await this.runCollectionTask();
    return true;
  }

  /**
   * 执行采集任务
   */
  private async runCollectionTask(): Promise<void> {
    try {
      log.verbose('NewWorksScheduler: 开始执行定时采集任务');

      const config = await this.manager!.getGlobalConfig();
      const subscriptions = await this.manager!.getSubscriptions();
      const activeSubscriptions = subscriptions.filter((sub) => sub.enabled);

      if (activeSubscriptions.length === 0) {
        log.verbose('NewWorksScheduler: 没有活跃的订阅演员，跳过检查');
        return;
      }

      const result = await this.collector!.checkMultipleActors(activeSubscriptions, config);
      await this.processResults(result);

      await this.manager!.updateGlobalConfig({
        lastGlobalCheck: Date.now(),
      });

      log.info(`NewWorksScheduler: 定时采集完成，发现 ${result.discovered} 个新作品`);
    } catch (error) {
      log.error('NewWorksScheduler: 定时采集任务失败:', error);
      throw error;
    }
  }

  /**
   * 处理采集结果
   */
  private async processResults(results: {
    discovered: number;
    errors: string[];
    newWorks: any[];
  }): Promise<void> {
    try {
      if (results.newWorks.length > 0) {
        const stats = await this.manager!.addNewWorks(results.newWorks);
        if (stats.failed > 0) {
          results.errors.push(`持久化失败: ${stats.saved}/${stats.total} 个新作品未写入 IndexedDB`);
        }
      }

      if (results.discovered > 0) {
        await this.sendNotification(results.discovered);
      }

      if (results.errors.length > 0) {
        console.warn('NewWorksScheduler: 采集过程中遇到错误:', results.errors);
      }
    } catch (error) {
      console.error('NewWorksScheduler: 处理采集结果失败:', error);
    }
  }

  /**
   * 发送通知
   */
  private async sendNotification(count: number): Promise<void> {
    try {
      const notificationId = `new-works-${Date.now()}`;

      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/favicons/light/favicon-48x48.png'),
        title: 'Jav 助手 - 新作品提醒',
        message: `发现 ${count} 个新作品，点击查看详情`,
        priority: 1,
        requireInteraction: false,
      });

      const onClicked = (clickedNotificationId: string) => {
        if (clickedNotificationId === notificationId) {
          chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard/dashboard.html#tab-new-works'),
          });
          chrome.notifications.clear(notificationId);
          chrome.notifications.onClicked.removeListener(onClicked);
        }
      };

      chrome.notifications.onClicked.addListener(onClicked);

      setTimeout(() => {
        chrome.notifications.clear(notificationId);
        chrome.notifications.onClicked.removeListener(onClicked);
      }, 10000);

      log.verbose(`NewWorksScheduler: 通知已发送，发现 ${count} 个新作品`);
    } catch (error) {
      log.error('NewWorksScheduler: 发送通知失败:', error);
    }
  }

  /**
   * 手动触发检查
   */
  async triggerManualCheck(): Promise<{
    discovered: number;
    errors: string[];
  }> {
    try {
      log.verbose('NewWorksScheduler: 手动触发检查');

      const config = await this.manager!.getGlobalConfig();
      const subscriptions = await this.manager!.getSubscriptions();
      log.verbose('NewWorksScheduler: 获取到订阅数据:', subscriptions.length, '个订阅');
      log.verbose(
        'NewWorksScheduler: 订阅详情:',
        subscriptions.map((sub) => ({
          id: sub.actorId,
          name: sub.actorName,
          enabled: sub.enabled,
        })),
      );

      const activeSubscriptions = subscriptions.filter((sub) => sub.enabled);
      log.verbose('NewWorksScheduler: 活跃订阅数量:', activeSubscriptions.length);

      if (activeSubscriptions.length === 0) {
        const errorMsg =
          subscriptions.length === 0
            ? '没有订阅任何演员，请先添加订阅'
            : `共有 ${subscriptions.length} 个订阅，但都已禁用，请在管理订阅中启用`;
        log.verbose('NewWorksScheduler: ' + errorMsg);
        return { discovered: 0, errors: [errorMsg] };
      }

      const result = await this.collector!.checkMultipleActors(activeSubscriptions, config);
      await this.processResults(result);

      await this.manager!.updateGlobalConfig({
        lastGlobalCheck: Date.now(),
      });

      return {
        discovered: result.discovered,
        errors: result.errors,
      };
    } catch (error) {
      console.error('NewWorksScheduler: 手动检查失败:', error);
      return {
        discovered: 0,
        errors: [error instanceof Error ? error.message : '未知错误'],
      };
    }
  }

  /**
   * 获取调度器状态
   */
  getStatus(): {
    isRunning: boolean;
    isInitialized: boolean;
    alarmName: string;
  } {
    return {
      isRunning: this.isRunning,
      isInitialized: this.isInitialized,
      alarmName: NEW_WORKS_CHECK_ALARM,
    };
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.stop();
    this.isInitialized = false;
    log.verbose('NewWorksScheduler: 资源已清理');
  }

  private scheduleFirstRunCheck(): void {
    this.clearFirstRunTimeout();
    this.firstRunTimeoutId = setTimeout(() => {
      this.firstRunTimeoutId = undefined;
      this.runCollectionTask().catch((error) => {
        log.error('NewWorksScheduler: 首次检查失败:', error);
      });
    }, 5000);
  }

  private clearFirstRunTimeout(): void {
    if (this.firstRunTimeoutId !== undefined) {
      clearTimeout(this.firstRunTimeoutId);
      this.firstRunTimeoutId = undefined;
    }
  }

  private async createAlarm(periodInMinutes: number): Promise<void> {
    if (!chrome?.alarms?.create) return;
    await Promise.resolve(
      chrome.alarms.create(NEW_WORKS_CHECK_ALARM, {
        delayInMinutes: periodInMinutes,
        periodInMinutes,
      }),
    );
  }

  private async clearAlarm(): Promise<void> {
    if (!chrome?.alarms?.clear) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        // chrome.alarms.clear 在类型上为 callback void；运行时可能返回 Promise
        const result = chrome.alarms.clear(NEW_WORKS_CHECK_ALARM, () => finish()) as unknown;
        const asPromise = result as { then?: (onFulfilled: () => void, onRejected?: () => void) => void };
        if (typeof asPromise?.then === 'function') {
          asPromise.then(() => finish(), () => finish());
        }
      } catch {
        finish();
      }
    });
  }
}

// 单例实例
export const newWorksScheduler = new NewWorksScheduler();
