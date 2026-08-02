/**
 * @file logSettingsModel.ts
 * @description 日志设置纯数据模型：默认值、映射、校验、快捷操作
 * @module apps/dashboard/pages/settings/log
 */
import type { ExtensionSettings } from '../../../../../types';

export type ConsoleLevel = 'OFF' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export type LogModulesState = {
  core: boolean;
  orchestrator: boolean;
  storage: boolean;
  actor: boolean;
  magnet: boolean;
  sync: boolean;
  newworks: boolean;
  drive115: boolean;
  media: boolean;
  privacy: boolean;
  ai: boolean;
  enhancement: boolean;
  update: boolean;
  help: boolean;
  settings: boolean;
  general: boolean;
  debug: boolean;
};

export type LogSettingsFormState = {
  consoleLevel: ConsoleLevel;
  maxLogEntries: number;
  maxMagnetPushEntries: number;
  retentionDays: number;
  verboseMode: boolean;
  showPrivacyLogs: boolean;
  showStorageLogs: boolean;
  showTimestamp: boolean;
  showMilliseconds: boolean;
  showSource: boolean;
  color: boolean;
  timeZone: string;
  suppressConsoleOutput: boolean;
  modules: LogModulesState;
};

export const DEFAULT_LOG_MODULES: LogModulesState = {
  core: false,
  orchestrator: false,
  storage: false,
  actor: false,
  magnet: false,
  sync: false,
  newworks: false,
  drive115: false,
  media: false,
  privacy: false,
  ai: false,
  enhancement: false,
  update: false,
  help: false,
  settings: false,
  general: false,
  debug: false,
};

export const DEFAULT_LOG_SETTINGS_FORM: LogSettingsFormState = {
  consoleLevel: 'INFO',
  maxLogEntries: 10000,
  maxMagnetPushEntries: 10000,
  retentionDays: 0,
  verboseMode: false,
  showPrivacyLogs: false,
  showStorageLogs: false,
  showTimestamp: true,
  showMilliseconds: false,
  showSource: true,
  color: true,
  timeZone: 'Asia/Shanghai',
  suppressConsoleOutput: false,
  modules: { ...DEFAULT_LOG_MODULES },
};

export const CONSOLE_LEVEL_OPTIONS = [
  { value: 'OFF', label: 'OFF - 关闭所有日志' },
  { value: 'ERROR', label: 'ERROR - 仅错误' },
  { value: 'WARN', label: 'WARN - 警告及以上' },
  { value: 'INFO', label: 'INFO - 信息及以上' },
  { value: 'DEBUG', label: 'DEBUG - 全部显示' },
] as const;

export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: '中国标准时间 (UTC+8)' },
  { value: 'Asia/Hong_Kong', label: '香港时间 (UTC+8)' },
  { value: 'Asia/Taipei', label: '台北时间 (UTC+8)' },
  { value: 'Asia/Tokyo', label: '日本标准时间 (UTC+9)' },
  { value: 'Asia/Seoul', label: '韩国标准时间 (UTC+9)' },
  { value: 'Asia/Singapore', label: '新加坡时间 (UTC+8)' },
  { value: 'Asia/Bangkok', label: '曼谷时间 (UTC+7)' },
  { value: 'Asia/Dubai', label: '迪拜时间 (UTC+4)' },
  { value: 'Europe/London', label: '伦敦时间 (UTC+0/+1)' },
  { value: 'Europe/Paris', label: '巴黎时间 (UTC+1/+2)' },
  { value: 'Europe/Berlin', label: '柏林时间 (UTC+1/+2)' },
  { value: 'Europe/Moscow', label: '莫斯科时间 (UTC+3)' },
  { value: 'America/New_York', label: '纽约时间 (UTC-5/-4)' },
  { value: 'America/Chicago', label: '芝加哥时间 (UTC-6/-5)' },
  { value: 'America/Denver', label: '丹佛时间 (UTC-7/-6)' },
  { value: 'America/Los_Angeles', label: '洛杉矶时间 (UTC-8/-7)' },
  { value: 'America/Toronto', label: '多伦多时间 (UTC-5/-4)' },
  { value: 'America/Vancouver', label: '温哥华时间 (UTC-8/-7)' },
  { value: 'America/Sao_Paulo', label: '圣保罗时间 (UTC-3)' },
  { value: 'Australia/Sydney', label: '悉尼时间 (UTC+10/+11)' },
  { value: 'Australia/Melbourne', label: '墨尔本时间 (UTC+10/+11)' },
  { value: 'Pacific/Auckland', label: '奥克兰时间 (UTC+12/+13)' },
  { value: 'UTC', label: '协调世界时 (UTC+0)' },
] as const;

/** 模块网格元数据（稳定 id） */
export const LOG_MODULE_FIELDS: {
  key: keyof LogModulesState;
  id: string;
  label: string;
  tag: string;
  description: string;
  group: string;
}[] = [
  { key: 'core', id: 'logModuleCore', label: '核心系统', tag: '[CORE]', description: '扩展主程序、初始化、配置加载', group: '核心功能' },
  { key: 'orchestrator', id: 'logModuleOrchestrator', label: '任务编排', tag: '[ORCH]', description: '任务调度、协调、队列管理', group: '核心功能' },
  { key: 'storage', id: 'logModuleStorage', label: '数据存储', tag: '[STORAGE]', description: '本地数据库读写、缓存操作', group: '核心功能' },
  { key: 'actor', id: 'logModuleActor', label: '演员管理', tag: '[ACTOR]', description: '演员数据同步、订阅、收藏', group: '业务功能' },
  { key: 'magnet', id: 'logModuleMagnet', label: '磁力搜索', tag: '[MAGNET]', description: '磁力链接搜索、解析、下载', group: '业务功能' },
  { key: 'sync', id: 'logModuleSync', label: '数据同步', tag: '[SYNC]', description: 'WebDAV、云端备份与恢复', group: '业务功能' },
  { key: 'newworks', id: 'logModuleNewWorks', label: '新作品', tag: '[NEWWORKS]', description: '新作品订阅、采集、状态同步', group: '业务功能' },
  { key: 'drive115', id: 'logModuleDrive115', label: '115网盘', tag: '[115]', description: '115网盘离线下载、文件管理', group: '扩展功能' },
  { key: 'media', id: 'logModuleMedia', label: '媒体库', tag: '[MEDIA]/[EMBY]', description: 'Emby/JF 同步、详情、播放取流', group: '扩展功能' },
  { key: 'privacy', id: 'logModulePrivacy', label: '隐私保护', tag: '[PRIVACY]', description: '隐私模式、密码锁、数据加密', group: '扩展功能' },
  { key: 'ai', id: 'logModuleAI', label: 'AI功能', tag: '[AI]', description: 'AI对话、智能分析、推荐', group: '扩展功能' },
  { key: 'enhancement', id: 'logModuleEnhancement', label: '功能增强', tag: '[ENHANCEMENT]', description: '列表增强、视频增强、预览', group: '扩展功能' },
  { key: 'update', id: 'logModuleUpdate', label: '更新检查', tag: '[UPDATE]', description: '版本检查、更新提示', group: '系统功能' },
  { key: 'help', id: 'logModuleHelp', label: '帮助系统', tag: '[HELP]', description: '帮助面板、内容映射', group: '系统功能' },
  { key: 'settings', id: 'logModuleSettings', label: '设置管理', tag: '[SETTINGS]', description: '设置加载、保存、验证', group: '系统功能' },
  { key: 'general', id: 'logModuleGeneral', label: '通用日志', tag: '[GENERAL]', description: '未分类的通用日志信息', group: '其他' },
  { key: 'debug', id: 'logModuleDebug', label: '调试模式', tag: '[DEBUG]', description: '详细的调试信息（开发用）', group: '其他' },
];

function n(v: unknown, def: number): number {
  const x = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(x) ? x : def;
}

function readModule(
  modules: Record<string, unknown> | undefined,
  cats: Record<string, unknown> | undefined,
  key: keyof LogModulesState,
  catKey?: string,
): boolean {
  if (modules && modules[key] !== undefined) return !!modules[key];
  const ck = catKey || key;
  if (cats && cats[ck] !== undefined) return !!cats[ck];
  return false;
}

export function mapSettingsToLogForm(
  settings: Partial<ExtensionSettings> | null | undefined,
): LogSettingsFormState {
  const logging = (settings?.logging || {}) as any;
  const modules = (logging.logModules || {}) as Record<string, unknown>;
  const cats = (logging.consoleCategories || {}) as Record<string, unknown>;
  const fmt = logging.consoleFormat || {};
  const level = String(logging.consoleLevel || 'INFO') as ConsoleLevel;
  const validLevels: ConsoleLevel[] = ['OFF', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

  return {
    consoleLevel: validLevels.includes(level) ? level : 'INFO',
    maxLogEntries: n(logging.maxLogEntries ?? logging.maxEntries, 10000),
    maxMagnetPushEntries: n(logging.maxMagnetPushEntries, 10000),
    retentionDays: n(logging.retentionDays, 0),
    verboseMode: !!logging.verboseMode,
    showPrivacyLogs: !!logging.showPrivacyLogs,
    showStorageLogs: !!logging.showStorageLogs,
    showTimestamp: fmt.showTimestamp ?? true,
    showMilliseconds: fmt.showMilliseconds ?? false,
    showSource: fmt.showSource ?? true,
    color: fmt.color ?? true,
    timeZone: fmt.timeZone || 'Asia/Shanghai',
    suppressConsoleOutput: !!logging.suppressConsoleOutput,
    modules: {
      core: readModule(modules, cats, 'core'),
      orchestrator: readModule(modules, cats, 'orchestrator'),
      storage: readModule(modules, cats, 'storage'),
      actor: readModule(modules, cats, 'actor'),
      magnet: readModule(modules, cats, 'magnet'),
      sync: readModule(modules, cats, 'sync'),
      newworks: readModule(modules, cats, 'newworks'),
      drive115: readModule(modules, cats, 'drive115'),
      media: readModule(modules, cats, 'media'),
      privacy: readModule(modules, cats, 'privacy'),
      ai: readModule(modules, cats, 'ai'),
      enhancement: readModule(modules, cats, 'enhancement'),
      update: readModule(modules, cats, 'update'),
      help: readModule(modules, cats, 'help'),
      settings: readModule(modules, cats, 'settings'),
      general: readModule(modules, cats, 'general'),
      debug: readModule(modules, cats, 'debug'),
    },
  };
}

export function applyLogFormToSettings(
  current: ExtensionSettings,
  form: LogSettingsFormState,
): ExtensionSettings {
  const logModules = { ...form.modules };
  const consoleCategories = {
    core: form.modules.core,
    orchestrator: form.modules.orchestrator,
    drive115: form.modules.drive115,
    media: form.modules.media,
    privacy: form.modules.privacy,
    magnet: form.modules.magnet,
    actor: form.modules.actor,
    storage: form.modules.storage,
    enhancement: form.modules.enhancement,
    general: form.modules.general,
  };

  return {
    ...current,
    logging: {
      ...(current.logging || {}),
      maxLogEntries: form.maxLogEntries,
      maxMagnetPushEntries: form.maxMagnetPushEntries,
      verboseMode: form.verboseMode,
      showPrivacyLogs: form.showPrivacyLogs,
      showStorageLogs: form.showStorageLogs,
      retentionDays: form.retentionDays,
      consoleLevel: form.consoleLevel,
      consoleFormat: {
        showTimestamp: form.showTimestamp,
        showSource: form.showSource,
        showMilliseconds: form.showMilliseconds,
        color: form.color,
        timeZone: form.timeZone,
      },
      logModules,
      consoleCategories,
      suppressConsoleOutput: form.suppressConsoleOutput,
    },
  };
}

export function validateLogForm(form: LogSettingsFormState): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (
    !Number.isFinite(form.maxLogEntries) ||
    form.maxLogEntries < 100 ||
    form.maxLogEntries > 50000
  ) {
    errors.push('最大保存条数必须在100-50000之间');
  }
  if (
    !Number.isFinite(form.maxMagnetPushEntries) ||
    form.maxMagnetPushEntries < 100 ||
    form.maxMagnetPushEntries > 50000
  ) {
    errors.push('磁力推送最大条数必须在100-50000之间');
  }
  if (
    !Number.isFinite(form.retentionDays) ||
    form.retentionDays < 0 ||
    form.retentionDays > 3650
  ) {
    errors.push('日志保留天数必须在0-3650之间');
  }
  return { isValid: errors.length === 0, errors };
}

/** 全部静默 */
export function applyMuteAll(form: LogSettingsFormState): LogSettingsFormState {
  return {
    ...form,
    consoleLevel: 'OFF',
    modules: {
      core: false,
      orchestrator: false,
      storage: false,
      actor: false,
      magnet: false,
      sync: false,
      newworks: false,
      drive115: false,
      privacy: false,
      media: false,
      ai: false,
      enhancement: false,
      update: false,
      help: false,
      settings: false,
      general: false,
      debug: false,
    },
  };
}

/** 全部启用 DEBUG */
export function applyEnableAll(form: LogSettingsFormState): LogSettingsFormState {
  return {
    ...form,
    consoleLevel: 'DEBUG',
    showTimestamp: true,
    showSource: true,
    color: true,
    modules: {
      core: true,
      orchestrator: true,
      storage: true,
      actor: true,
      magnet: true,
      sync: true,
      newworks: true,
      drive115: true,
      privacy: true,
      media: true,
      ai: true,
      enhancement: true,
      update: true,
      help: true,
      settings: true,
      general: true,
      debug: true,
    },
  };
}

/** 恢复默认 INFO */
export function applyResetDefault(form: LogSettingsFormState): LogSettingsFormState {
  return {
    ...form,
    consoleLevel: 'INFO',
    maxLogEntries: 10000,
    maxMagnetPushEntries: 10000,
    showTimestamp: true,
    showSource: true,
    showMilliseconds: false,
    color: true,
    modules: {
      core: true,
      orchestrator: true,
      storage: true,
      actor: true,
      magnet: true,
      sync: true,
      newworks: true,
      drive115: true,
      privacy: true,
      media: true,
      ai: true,
      enhancement: true,
      update: true,
      help: true,
      settings: true,
      general: true,
      debug: false,
    },
  };
}
