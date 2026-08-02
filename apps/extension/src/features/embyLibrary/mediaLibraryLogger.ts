/**
 * @file mediaLibraryLogger.ts
 * @description 媒体库统一日志：控制台分类 [MEDIA]/[EMBY]/[PLAYER]，持久化由 consoleProxy 统一处理
 * @module features/embyLibrary
 *
 * 注意：日志统一交给 consoleProxy 处理持久化，避免同一条日志同时写入两次。
 */

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function prefix(scope: 'MEDIA' | 'EMBY' | 'PLAYER', message: string): string {
  return `[${scope}] ${message}`;
}

function emit(level: Level, scope: 'MEDIA' | 'EMBY' | 'PLAYER', message: string, data?: unknown): void {
  const text = prefix(scope, message);
  try {
    if (level === 'ERROR') console.error(text, data ?? '');
    else if (level === 'WARN') console.warn(text, data ?? '');
    else if (level === 'DEBUG') console.debug(text, data ?? '');
    else console.info(text, data ?? '');
  } catch {
    /* ignore */
  }
}

export const mediaLog = {
  debug: (message: string, data?: unknown) => emit('DEBUG', 'MEDIA', message, data),
  info: (message: string, data?: unknown) => emit('INFO', 'MEDIA', message, data),
  warn: (message: string, data?: unknown) => emit('WARN', 'MEDIA', message, data),
  error: (message: string, data?: unknown) => emit('ERROR', 'MEDIA', message, data),
};

export const embyLog = {
  debug: (message: string, data?: unknown) => emit('DEBUG', 'EMBY', message, data),
  info: (message: string, data?: unknown) => emit('INFO', 'EMBY', message, data),
  warn: (message: string, data?: unknown) => emit('WARN', 'EMBY', message, data),
  error: (message: string, data?: unknown) => emit('ERROR', 'EMBY', message, data),
};

export const playerLog = {
  debug: (message: string, data?: unknown) => emit('DEBUG', 'PLAYER', message, data),
  info: (message: string, data?: unknown) => emit('INFO', 'PLAYER', message, data),
  warn: (message: string, data?: unknown) => emit('WARN', 'PLAYER', message, data),
  error: (message: string, data?: unknown) => emit('ERROR', 'PLAYER', message, data),
};
