/**
 * @file consoleProxy.ts
 * @description 统一控制台代理 —— 拦截 console.* 输出，实现级别过滤、分类过滤、时间戳格式化、彩色输出
 * @module platform/logging
 *
 * 控制台显示与轻量日志持久化。幂等安装，多次调用安全。
 */

import { enqueuePersistentLog } from './persistentLogQueue';

export type LogLevel = 'OFF' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/** 输出格式化选项 */
interface FormatOptions {
  showTimestamp: boolean;                             // 前缀 [HH:mm:ss]
  timestampStyle?: 'hms';
  timeZone?: string;                                  // 时区，如 'Asia/Shanghai'
  showSource: boolean;                                // 显示 [SOURCE] 标签
  color: boolean;                                     // 启用彩色前缀
}

/** 分类规则 —— 控制不同模块的日志是否显示 */
export interface CategoryRule {
  enabled: boolean;
  match: RegExp | ((args: any[]) => boolean);         // 匹配方式：正则或函数
  label?: string;                                     // [SOURCE] 中显示的标签
  color?: string;                                     // 分类标签的 CSS 颜色
}

/** 控制台代理初始化选项 */
export interface ConsoleProxyOptions {
  level?: LogLevel;
  format?: Partial<FormatOptions>;
  categories?: Record<string, Partial<CategoryRule> & { match: CategoryRule['match'] } >;
}

interface InternalConfig {
  level: LogLevel;
  levelValue: number; // numeric for comparison
  format: FormatOptions;
  categories: Record<string, CategoryRule>;
}

// Numeric severity mapping (higher means more important)
const LEVEL_SEVERITY: Record<Exclude<LogLevel, 'OFF'>, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

function toSeverity(level: LogLevel): number {
  if (level === 'OFF') return Infinity; // nothing passes
  return LEVEL_SEVERITY[level];
}

// Default categories (extension self logs common tags)
function buildDefaultCategories(): Record<string, CategoryRule> {
  return {
    // ========== 核心功能 ==========
    core: {
      enabled: false,
      match: /\[(CORE|Extension|LogController|Cache)\]|初始化|Initialized/i,
      label: 'CORE',
      color: '#16a085',
    },
    orchestrator: {
      enabled: false,
      match: /\[Orchestrator\]|任务编排|Task/i,
      label: 'ORCH',
      color: '#8e44ad',
    },
    storage: {
      enabled: false,
      match: /\[(Storage|STORAGE|StorageManager)\]|存储|数据库|IndexedDB/i,
      label: 'STORAGE',
      color: '#2c3e50',
    },
    
    // ========== 业务功能 ==========
    actor: {
      enabled: false,
      match: /\[Actor|ActorManager\]|演员|Actor/i,
      label: 'ACTOR',
      color: '#2980b9',
    },
    magnet: {
      enabled: false,
      match: /\[Magnet\]|磁链|磁力|Magnet/i,
      label: 'MAGNET',
      color: '#27ae60',
    },
    sync: {
      enabled: false,
      match: /\[Sync|DataSync\]|同步|WebDAV|Sync/i,
      label: 'SYNC',
      color: '#3498db',
    },
    newworks: {
      enabled: false,
      match: /\[NewWorks|NewWorksManager|NEWWORKS\]|新作品/i,
      label: 'NEWWORKS',
      color: '#f39c12',
    },
    
    // ========== 扩展功能 ==========
    drive115: {
      enabled: false,
      match: /\[(Drive115|115V?2?)\]|115网盘|Drive115/i,
      label: '115',
      color: '#d35400',
    },
    media: {
      enabled: false,
      match: /\[(MEDIA|EMBY|PLAYER|MediaLibrary|EmbyLibrary)\]|媒体库|Emby|Jellyfin|MEDIA/i,
      label: 'MEDIA',
      color: '#16a085',
    },
    privacy: {
      enabled: false,
      match: /\[(Privacy|PrivacyManager|LockScreen)\]|隐私|Privacy|Lock/i,
      label: 'PRIVACY',
      color: '#c0392b',
    },
    ai: {
      enabled: false,
      match: /\[AI\]|AI功能|人工智能/i,
      label: 'AI',
      color: '#9b59b6',
    },
    enhancement: {
      enabled: false,
      match: /\[(Enhancement|ListEnhancement|CoverEnhancement|OnlineAvailability|ReviewBreaker|FC2Breaker|EmbyEnhancement)\]|功能增强|列表增强|视频增强|封面增强|在线可看|评论破解|FC2增强|Emby增强/i,
      label: 'ENHANCEMENT',
      color: '#7d3c98',
    },
    
    // ========== 系统功能 ==========
    update: {
      enabled: false,
      match: /\[UpdateChecker\]|更新检查|Update/i,
      label: 'UPDATE',
      color: '#e67e22',
    },
    help: {
      enabled: false,
      match: /\[Help|HelpPanel|HelpContent\]|帮助|Help/i,
      label: 'HELP',
      color: '#1abc9c',
    },
    settings: {
      enabled: false,
      match: /\[Settings\]|设置|Settings/i,
      label: 'SETTINGS',
      color: '#34495e',
    },
    
    // ========== 其他 ==========
    general: {
      enabled: false,
      match: () => true,
      label: 'GENERAL',
      color: '#95a5a6',
    },
  };
}

function mergeCategories(base: Record<string, CategoryRule>, extra?: ConsoleProxyOptions['categories']): Record<string, CategoryRule> {
  if (!extra) return base;
  const out: Record<string, CategoryRule> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const prev = out[k] || { enabled: true, match: v.match, label: k.toUpperCase() } as CategoryRule;
    out[k] = {
      enabled: v.enabled ?? prev.enabled,
      match: v.match ?? prev.match,
      label: v.label ?? prev.label ?? k.toUpperCase(),
      color: v.color ?? prev.color,
    };
  }
  return out;
}

function getLocalTimeHHMMSS(tz?: string): string {
  try {
    if (tz) {
      return new Intl.DateTimeFormat('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: tz,
      }).format(new Date());
    }
    // default local
    return new Intl.DateTimeFormat('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date());
  } catch {
    // Fallback
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

function compactLogValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (typeof value === 'function') return '[Function]';
  if (depth >= 2 || typeof value !== 'object') return '[Object]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactLogValue(item, depth + 1, seen));
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, 40)) {
    try {
      output[key] = compactLogValue((value as Record<string, unknown>)[key], depth + 1, seen);
    } catch {
      output[key] = '[Unserializable]';
    }
  }
  return output;
}

function safeToString(x: unknown): string {
  try {
    const value = compactLogValue(x, 0, new WeakSet<object>());
    const result = typeof value === 'string' ? value : JSON.stringify(value);
    return result.length > 8192 ? `${result.slice(0, 8192)}…` : result;
  } catch {
    return '[Unserializable]';
  }
}

/**
 * 分类只需要识别日志前缀，不需要读取 payload 的完整内容。
 * 避免为每条日志 JSON 序列化大对象，尤其是被级别过滤的 DEBUG 日志。
 */
export function buildLogCategorySample(args: unknown[]): string {
  return args
    .slice(0, 3)
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value == null) return String(value);
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
      }
      return '[object]';
    })
    .join(' ');
}

function pickCategory(args: any[], categories: Record<string, CategoryRule>): string {
  // try match by scanning first 2-3 args as string
  const sample = buildLogCategorySample(args);

  for (const [key, rule] of Object.entries(categories)) {
    if (typeof rule.match === 'function') {
      try { if ((rule.match as (a: any[]) => boolean)(args)) return key; } catch {}
    } else {
      try { if ((rule.match as RegExp).test(sample)) return key; } catch {}
    }
  }
  return 'general';
}

const nativeConsole = {
  log: console.log.bind(console),
  info: console.info ? console.info.bind(console) : console.log.bind(console),
  warn: console.warn ? console.warn.bind(console) : console.log.bind(console),
  error: console.error ? console.error.bind(console) : console.log.bind(console),
  debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  group: console.group ? console.group.bind(console) : undefined,
  groupCollapsed: console.groupCollapsed ? console.groupCollapsed.bind(console) : undefined,
  groupEnd: console.groupEnd ? console.groupEnd.bind(console) : undefined,
  time: console.time ? console.time.bind(console) : undefined,
  timeEnd: console.timeEnd ? console.timeEnd.bind(console) : undefined,
};

let INSTALLED = false;
let CONFIG: InternalConfig;

function buildInitialConfig(options?: ConsoleProxyOptions): InternalConfig {
  const level = options?.level ?? 'DEBUG';
  const format: FormatOptions = {
    showTimestamp: options?.format?.showTimestamp ?? true,
    timestampStyle: 'hms',
    timeZone: options?.format?.timeZone ?? 'Asia/Shanghai',
    showSource: options?.format?.showSource ?? true,
    color: options?.format?.color ?? true,
  };
  const baseCategories = buildDefaultCategories();
  const categories = mergeCategories(baseCategories, options?.categories);
  return {
    level,
    levelValue: toSeverity(level),
    format,
    categories,
  };
}

function formatPrefix(level: Exclude<LogLevel, 'OFF'>, categoryKey: string): { text: string; styles: string[] } {
  const f = CONFIG.format;
  const parts: string[] = [];
  const styles: string[] = [];

  // Colors by level
  const levelColors: Record<Exclude<LogLevel, 'OFF'>, string> = {
    ERROR: '#e74c3c',
    WARN: '#f39c12',
    INFO: '#3498db',
    DEBUG: '#95a5a6',
  };

  const cat = CONFIG.categories[categoryKey] || CONFIG.categories.general;
  const catColor = cat.color || '#7f8c8d';

  const push = (text: string, style?: string) => {
    if (f.color && style) {
      parts.push(`%c${text}`);
      styles.push(style);
    } else {
      parts.push(text);
    }
  };

  if (f.showTimestamp) {
    const ts = getLocalTimeHHMMSS(f.timeZone);
    push(`[${ts}]`, 'color:#888; font-weight:500;');
  }

  push(`[${level}]`, f.color ? `color:${levelColors[level]}; font-weight:700;` : undefined);

  if (f.showSource) {
    push(`[${cat.label || categoryKey.toUpperCase()}]`, f.color ? `color:${catColor}; font-weight:600;` : undefined);
  }

  return { text: parts.join(' '), styles };
}

function shouldPrint(level: Exclude<LogLevel, 'OFF'>, categoryKey: string): boolean {
  if (CONFIG.level === 'OFF') return false;
  if (LEVEL_SEVERITY[level] < CONFIG.levelValue) return false;
  const rule = CONFIG.categories[categoryKey];
  if (rule && rule.enabled === false) return false;
  return true;
}

function wrapMethod(level: Exclude<LogLevel, 'OFF'>, native: (...args: any[]) => void) {
  return function proxied(...args: any[]) {
    try {
      const catKey = pickCategory(args, CONFIG.categories);
      if (!shouldPrint(level, catKey)) return;

      // 去掉第一个参数中的分类标签（如 [NewWorks]、[Actor] 等）
      // 因为 proxy 会自动添加统一的分类标签
      const cleanedArgs = args.map((arg, index) => {
        if (index === 0 && typeof arg === 'string') {
          // 移除常见的分类标签模式：[NewWorks]、[Actor]、[Magnet] 等
          return arg.replace(/^\[(NewWorks|NewWorksManager|Actor|ActorManager|Magnet|Sync|DataSync|Drive115|115V?2?|Privacy|PrivacyManager|AI|Enhancement|ListEnhancement|CoverEnhancement|OnlineAvailability|ReviewBreaker|FC2Breaker|EmbyEnhancement|Update|UpdateChecker|Help|Settings|CORE|Extension|Storage|STORAGE|Orchestrator|IDB|Background|Popup|Dashboard|Content|QA|LogController|Cache|LockScreen|INSIGHTS|dbRouter)\]\s*/i, '');
        }
        return arg;
      });

      const { text, styles } = formatPrefix(level, catKey);
      if (CONFIG.format.color && styles.length > 0) {
        native(text, ...styles, ...cleanedArgs);
      } else {
        native(text, ...cleanedArgs);
      }

      // 将 INFO/WARN/ERROR 控制台输出持久化至后台 IDB 日志（避免 DEBUG 造成高写入量）
      try {
        if (level !== 'DEBUG' && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          const serialized = cleanedArgs.map((a) => safeToString(a)).join(' ');
          const entry: any = {
            timestamp: new Date().toISOString(),
            level,
            message: serialized,
          };
          enqueuePersistentLog(entry);
        }
      } catch {}
    } catch (e) {
      // Fallback to native if anything goes wrong to avoid breaking logs
      native('[ConsoleProxy:FALLBACK]', ...args);
    }
  };
}


export function installConsoleProxy(options?: ConsoleProxyOptions) {
  if (INSTALLED) return getConsoleControl();
  CONFIG = buildInitialConfig(options);

  // Replace console methods
  // Use minimal set to avoid unexpected behaviors in third-party libs
  console.log = wrapMethod('INFO', nativeConsole.log) as any; // treat log as INFO
  console.info = wrapMethod('INFO', nativeConsole.info) as any;
  console.warn = wrapMethod('WARN', nativeConsole.warn) as any;
  console.error = wrapMethod('ERROR', nativeConsole.error) as any;
  console.debug = wrapMethod('DEBUG', nativeConsole.debug) as any;

  if (nativeConsole.group && nativeConsole.groupCollapsed && nativeConsole.groupEnd) {
    console.group = wrapMethod('INFO', nativeConsole.group) as any;
    console.groupCollapsed = wrapMethod('INFO', nativeConsole.groupCollapsed) as any;
    console.groupEnd = nativeConsole.groupEnd;
  }

  if (nativeConsole.time && nativeConsole.timeEnd) {
    const timers = new Map<string, number>();
    console.time = (label = 'default') => timers.set(label, Date.now());
    console.timeEnd = (label = 'default') => {
      const start = timers.get(label);
      if (start) {
        const dur = Date.now() - start;
        wrapMethod('DEBUG', nativeConsole.debug)(`${label}: ${dur}ms`);
        timers.delete(label);
      }
    };
  }

  INSTALLED = true;
  const ctrl = getConsoleControl();
  // Expose control to globalThis for runtime tweaks
  try {
    const g: any = (typeof window !== 'undefined') ? window : (globalThis as any);
    g.__JDB_CONSOLE__ = ctrl;
  } catch {}

  return ctrl;
}

export function uninstallConsoleProxy() {
  if (!INSTALLED) return;
  // Restore
  console.log = nativeConsole.log as any;
  console.info = nativeConsole.info as any;
  console.warn = nativeConsole.warn as any;
  console.error = nativeConsole.error as any;
  console.debug = nativeConsole.debug as any;
  if (nativeConsole.group) console.group = nativeConsole.group as any;
  if (nativeConsole.groupCollapsed) console.groupCollapsed = nativeConsole.groupCollapsed as any;
  if (nativeConsole.groupEnd) console.groupEnd = nativeConsole.groupEnd as any;
  if (nativeConsole.time) console.time = nativeConsole.time as any;
  if (nativeConsole.timeEnd) console.timeEnd = nativeConsole.timeEnd as any;
  INSTALLED = false;
}

function updateConfig(patch: Partial<ConsoleProxyOptions & { level?: LogLevel; format?: Partial<FormatOptions> }>) {
  if (!CONFIG) return;
  if (patch.level) {
    CONFIG.level = patch.level;
    CONFIG.levelValue = toSeverity(patch.level);
  }
  if (patch.format) {
    CONFIG.format = { ...CONFIG.format, ...patch.format };
  }
  if (patch.categories) {
    CONFIG.categories = mergeCategories(CONFIG.categories, patch.categories);
  }
}

export interface ConsoleControl {
  getConfig(): InternalConfig;
  setLevel(level: LogLevel): void;
  enable(category: string): void;
  disable(category: string): void;
  setFormat(format: Partial<FormatOptions>): void;
  registerCategory(key: string, rule: Omit<CategoryRule, 'enabled'> & { enabled?: boolean }): void;
  restore(): void; // restore native console
  updateConfig(patch: Partial<ConsoleProxyOptions>): void;
}

function getConsoleControl(): ConsoleControl {
  return {
    getConfig: () => JSON.parse(JSON.stringify(CONFIG)),
    setLevel: (level: LogLevel) => updateConfig({ level }),
    enable: (category: string) => {
      if (!CONFIG.categories[category]) return;
      CONFIG.categories[category].enabled = true;
    },
    disable: (category: string) => {
      if (!CONFIG.categories[category]) return;
      CONFIG.categories[category].enabled = false;
    },
    setFormat: (format: Partial<FormatOptions>) => updateConfig({ format }),
    registerCategory: (key: string, rule: Omit<CategoryRule, 'enabled'> & { enabled?: boolean }) => {
      updateConfig({ categories: { [key]: { ...rule, enabled: rule.enabled ?? true, match: rule.match } } });
    },
    restore: () => uninstallConsoleProxy(),
    updateConfig: (patch) => updateConfig(patch),
  };
}

// Convenience named export for code wishing to log with category explicitly
export const cx = {
  debug: (category: string, ...args: any[]) => console.debug(`[${category}]`, ...args),
  info: (category: string, ...args: any[]) => console.info(`[${category}]`, ...args),
  warn: (category: string, ...args: any[]) => console.warn(`[${category}]`, ...args),
  error: (category: string, ...args: any[]) => console.error(`[${category}]`, ...args),
};
