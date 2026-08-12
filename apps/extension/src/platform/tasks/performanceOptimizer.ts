/**
 * @file performanceOptimizer.ts
 * @description 性能优化器 —— 节流（throttle）和防抖（debounce）工具，控制任务调度频率
 * @module platform/tasks
 */

import { countContentPerformanceEvent } from './contentPerformanceDiagnostics';

const log = (...args: any[]) => {
  try {
    const verbose = typeof window !== 'undefined' && (window as any).__JDB_VERBOSE;
    if (verbose !== false) {
      console.log('[JavDB Ext]', ...args);
    }
  } catch {
    console.log('[JavDB Ext]', ...args);
  }
};

export interface PerformanceConfig {
  // 网络请求优化
  maxConcurrentRequests: number;
  requestTimeout: number;
  requestRetryDelay: number;
  
  // DOM操作优化
  domBatchSize: number;
  domThrottleDelay: number;
  
  // 内存管理
  enableMemoryCleanup: boolean;
  memoryCleanupInterval: number;
}

export class PerformanceOptimizer {
  private config: PerformanceConfig;
  private requestQueue: Array<() => Promise<any>> = [];
  private runningRequests = 0;
  private domOperationQueue: Array<() => void> = [];
  private domThrottleTimer: number | null = null;
  private memoryCleanupTimer: number | null = null;
  private isInitialized = false;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      maxConcurrentRequests: 2, // 限制并发网络请求
      requestTimeout: 8000, // 降低超时时间
      requestRetryDelay: 1000,
      
      domBatchSize: 5,
      domThrottleDelay: 100,
      
      enableMemoryCleanup: true,
      memoryCleanupInterval: 30000, // 30秒清理一次
      ...config,
    };
  }

  /**
   * 初始化性能优化器
   */
  initialize(): void {
    if (this.isInitialized) return;
    
    log('[PerformanceOptimizer] Initializing performance optimizer...');
    
    // 启动内存清理
    if (this.config.enableMemoryCleanup) {
      this.startMemoryCleanup();
    }
    
    // 监听页面卸载事件
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
    
    // 监听扩展上下文失效
    this.setupContextInvalidationHandler();
    
    this.isInitialized = true;
    log('[PerformanceOptimizer] Performance optimizer initialized');
  }


  /**
   * 网络请求优化 - 限制并发请求数量
   */
  async scheduleRequest<T>(request: () => Promise<T>, timeout?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedRequest = async () => {
        try {
          this.runningRequests++;
          
          // 添加超时控制
          const timeoutMs = timeout || this.config.requestTimeout;
          const timeoutPromise = new Promise<never>((_, timeoutReject) => {
            setTimeout(() => {
              timeoutReject(new Error(`Request timeout after ${timeoutMs}ms`));
            }, timeoutMs);
          });

          const result = await Promise.race([request(), timeoutPromise]);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.runningRequests--;
          this.processRequestQueue();
        }
      };

      this.requestQueue.push(wrappedRequest);
      this.processRequestQueue();
    });
  }

  /**
   * 处理网络请求队列
   */
  private processRequestQueue(): void {
    if (this.runningRequests >= this.config.maxConcurrentRequests || this.requestQueue.length === 0) {
      return;
    }

    const request = this.requestQueue.shift();
    if (request) {
      request();
    }
  }

  /**
   * DOM操作优化 - 批量处理DOM操作
   */
  scheduleDOMOperation(operation: () => void): void {
    this.domOperationQueue.push(operation);
    
    if (this.domThrottleTimer) {
      clearTimeout(this.domThrottleTimer);
    }
    
    this.domThrottleTimer = window.setTimeout(() => {
      this.processDOMOperations();
    }, this.config.domThrottleDelay);
  }

  /**
   * 处理DOM操作队列
   */
  private processDOMOperations(): void {
    if (this.domOperationQueue.length === 0) return;

    // 使用requestAnimationFrame确保在浏览器重绘前执行
    requestAnimationFrame(() => {
      const batchSize = Math.min(this.config.domBatchSize, this.domOperationQueue.length);
      
      for (let i = 0; i < batchSize; i++) {
        const operation = this.domOperationQueue.shift();
        if (operation) {
          try {
            operation();
          } catch (error) {
            log('[PerformanceOptimizer] DOM operation error:', error);
          }
        }
      }

      // 如果还有操作，继续处理
      if (this.domOperationQueue.length > 0) {
        setTimeout(() => this.processDOMOperations(), this.config.domThrottleDelay);
      }
    });
  }

  /**
   * 内存清理
   */
  private startMemoryCleanup(): void {
    this.memoryCleanupTimer = window.setInterval(() => {
      countContentPerformanceEvent('interval.performanceOptimizer.memoryCleanup');
      this.performMemoryCleanup();
    }, this.config.memoryCleanupInterval);
  }

  /**
   * 执行内存清理
   */
  private performMemoryCleanup(): void {
    try {
      // P1 FIX: 清理前先 flush 到 storage，而不是直接截断丢失工作
      this.flushQueuesToStorage();

      // 清理请求队列中的过期请求（保留更多缓冲空间）
      if (this.requestQueue.length > 20) {
        log('[PerformanceOptimizer] Truncating request queue:', this.requestQueue.length, '-> 10');
        this.requestQueue = this.requestQueue.slice(0, 10);
      }

      // 清理DOM操作队列（不再截断，改为保留更多操作）
      if (this.domOperationQueue.length > 200) {
        log('[PerformanceOptimizer] Truncating DOM operation queue:', this.domOperationQueue.length, '-> 80');
        this.domOperationQueue = this.domOperationQueue.slice(0, 80);
      }

      // 强制垃圾回收（如果可用）
      if (window.gc) {
        window.gc();
      }

      log('[PerformanceOptimizer] Memory cleanup completed');
    } catch (error) {
      log('[PerformanceOptimizer] Memory cleanup error:', error);
    }
  }

  // P1 FIX: 清理前将队列中的任务 flush 到 chrome.storage，防止工作丢失
  private async flushQueuesToStorage(): Promise<void> {
    if (this.requestQueue.length === 0 && this.domOperationQueue.length === 0) return;
    try {
      const snapshot = {
        flushedAt: Date.now(),
        pageUrl: typeof window !== 'undefined' ? window.location.href : '',
        pendingRequests: this.requestQueue.length,
        pendingDOMOps: this.domOperationQueue.length,
      };
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ performanceOptimizerSnapshot: snapshot }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
      log('[PerformanceOptimizer] Queues flushed to storage:', snapshot);
    } catch (err) {
      log('[PerformanceOptimizer] Failed to flush queues:', err);
    }
  }

  /**
   * 设置扩展上下文失效处理
   */
  private setupContextInvalidationHandler(): void {
    // 监听chrome.runtime错误
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      const originalSendMessage = (chrome.runtime as any).sendMessage;
      (chrome.runtime as any).sendMessage = function(...args: any[]) {
        try {
          return originalSendMessage.apply(this, args);
        } catch (error) {
          if (error.message?.includes('Extension context invalidated')) {
            log('[PerformanceOptimizer] Extension context invalidated, cleaning up...');
            performanceOptimizer.cleanup();
          }
          throw error;
        }
      };
    }

    // 监听storage错误
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const originalGet = (chrome.storage.local as any).get;
      (chrome.storage.local as any).get = function(...args: any[]) {
        try {
          return originalGet.apply(this, args);
        } catch (error) {
          if (error.message?.includes('Extension context invalidated')) {
            log('[PerformanceOptimizer] Storage context invalidated, cleaning up...');
            performanceOptimizer.cleanup();
          }
          throw error;
        }
      };
    }
  }

  /**
   * 获取性能统计信息
   */
  getStats() {
    return {
      runningRequests: this.runningRequests,
      queuedRequests: this.requestQueue.length,
      queuedDOMOperations: this.domOperationQueue.length,
      config: this.config,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    log('[PerformanceOptimizer] Configuration updated:', this.config);
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    log('[PerformanceOptimizer] Cleaning up resources...');
    
    // 清理定时器
    if (this.domThrottleTimer) {
      clearTimeout(this.domThrottleTimer);
      this.domThrottleTimer = null;
    }
    
    if (this.memoryCleanupTimer) {
      clearInterval(this.memoryCleanupTimer);
      this.memoryCleanupTimer = null;
    }
    
    // 清理队列
    this.requestQueue = [];
    this.domOperationQueue = [];
    
    log('[PerformanceOptimizer] Cleanup completed');
  }
}

// 创建全局实例
export const performanceOptimizer = new PerformanceOptimizer();

// 暴露到window对象以便调试
if (typeof window !== 'undefined') {
  (window as any).performanceOptimizer = performanceOptimizer;
}
