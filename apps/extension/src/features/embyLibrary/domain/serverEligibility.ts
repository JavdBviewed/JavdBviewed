import { normalizeServerUrl } from './libraryIndex';

/**
 * 媒体服务器「是否可参与资料库同步」的凭据判定——单一事实源。
 *
 * 自动同步 alarm 的注册侧（background/scheduler）与同步执行侧
 * （background/handlers getEnabledServers）必须都调用本函数，
 * 使注册口径与执行口径结构性一致；此前注册侧只认 apiKey、
 * 执行侧认 apiKey/accessToken/账号+密码，导致 UI 登录（有
 * accessToken 无 API key）或仅账号+密码未登录的用户手动同步
 * 正常、自动同步 alarm 却永不注册。
 *
 * 合格条件（全部满足）：
 * - 条目存在且未显式禁用（enabled !== false）
 * - 地址非空（归一化后，与同步执行链路同口径）
 * - 至少一种凭据：apiKey / accessToken（UI 登录会话）/ 账号+密码
 *   （仅账号+密码未登录也合格：保留后由功能入口的凭据守卫给出配置指引）
 *
 * 凭据字段统一 trim 后判定，空白占位视为缺失。
 */
export function isSyncEligibleServer(server: unknown): boolean {
  if (!server || typeof server !== 'object') return false;
  const value = server as Record<string, unknown>;
  if (value.enabled === false) return false;
  if (!normalizeServerUrl(String(value.url || ''))) return false;
  const apiKey = String(value.apiKey || '').trim();
  const accessToken = String(value.accessToken || '').trim();
  const username = String(value.username || '').trim();
  const password = String(value.password || '').trim();
  return Boolean(apiKey || accessToken || (username && password));
}
