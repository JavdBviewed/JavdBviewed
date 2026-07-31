import type { EmbyMediaServer } from '../embyLibrary/types';
import { buildEmbyAuthHeaders } from '../embyLibrary/domain/embyUserAuth';
import type { MediaCleanupCopySnapshot } from './mediaCleanupModel';

export type MediaCleanupDeleteDeps = {
  getSettings: () => Promise<unknown>;
  fetchImpl: typeof fetch;
  deleteDrive115File: (fileId: string) => Promise<{ ok: boolean; message: string }>;
};

function normalizeServerUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

export async function deleteMediaCleanupCopy(
  copy: MediaCleanupCopySnapshot,
  deps: MediaCleanupDeleteDeps,
): Promise<{ ok: boolean; message: string }> {
  if (copy.source === '115') {
    if (!copy.fileId) return { ok: false, message: '缺少 115 file_id，无法删除' };
    return deps.deleteDrive115File(copy.fileId);
  }

  if (!copy.itemId || !copy.serverUrl) {
    return { ok: false, message: '缺少媒体服务器地址或影片 ID' };
  }
  const settings = await deps.getSettings() as { emby?: { mediaServers?: EmbyMediaServer[] } } | null;
  const servers = Array.isArray(settings?.emby?.mediaServers) ? settings.emby.mediaServers : [];
  const serverUrl = normalizeServerUrl(copy.serverUrl);
  const server = servers.find((candidate) => (
    candidate.type === copy.source
    && normalizeServerUrl(candidate.url) === serverUrl
  ));
  if (!server) return { ok: false, message: '对应媒体服务器配置已不存在' };
  const token = String(server.accessToken || server.apiKey || '').trim();
  if (!token) return { ok: false, message: '媒体服务器缺少可用凭证' };
  const query = server.accessToken ? '' : `?api_key=${encodeURIComponent(server.apiKey)}`;
  try {
    const response = await deps.fetchImpl(
      `${serverUrl}/Items/${encodeURIComponent(copy.itemId)}${query}`,
      {
        method: 'DELETE',
        headers: buildEmbyAuthHeaders(server),
      },
    );
    if (response.ok) return { ok: true, message: '已从媒体服务器删除' };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: '媒体服务器拒绝删除，请检查账号权限' };
    }
    if (response.status === 404) {
      return { ok: true, message: '文件已不存在，按删除成功处理' };
    }
    return { ok: false, message: `媒体服务器删除失败 (${response.status})` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '媒体服务器删除网络错误',
    };
  }
}
