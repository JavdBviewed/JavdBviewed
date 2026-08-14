/** 仅同步跨端排障需要的日志，避免常规运行日志占满待同步队列。 */
export function shouldSyncLogEntry(entry: Record<string, unknown>): boolean {
  return entry.level === 'WARN' || entry.level === 'ERROR';
}
