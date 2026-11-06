/** 本机 Jellyfin 12.4 测试容器的扩展 API 主链验收，不读取生产凭据。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authenticateEmbyUser, buildEmbyAuthHeaders } from '../apps/extension/src/features/embyLibrary/domain/embyUserAuth';
import {
  fetchServerLibraryFolders,
  handleEmbyLibrarySetPlayed,
  handleEmbyLibrarySync,
} from '../apps/extension/src/features/embyLibrary/background/handlers';
import { fetchEmbyItemDetail } from '../apps/extension/src/features/embyLibrary/domain/embyItemDetail';
import { resolveEmbyStreamUrl } from '../apps/extension/src/features/embyLibrary/domain/embyPlayback';
import { reportEmbyPlaybackProgress } from '../apps/extension/src/features/embyLibrary/domain/embyPlaystate';
import type { EmbyLibraryState, EmbyMediaServer } from '../apps/extension/src/features/embyLibrary/types';

const base = 'http://127.0.0.1:38496';
const password = process.env.JELLYFIN_TEST_PASSWORD
  || (process.env.JELLYFIN_TEST_PASSWORD_FILE
    ? readFileSync(process.env.JELLYFIN_TEST_PASSWORD_FILE, 'utf8').trim()
    : '');

async function main(): Promise<void> {
  assert.ok(password, 'Set JELLYFIN_TEST_PASSWORD_FILE to the local test credential file');
  const infoResponse = await fetch(`${base}/System/Info/Public`);
  assert.equal(infoResponse.status, 200);
  const info = await infoResponse.json() as { Version?: string };
  assert.equal(info.Version, '12.4.0');

  const login = await authenticateEmbyUser({
    url: base,
    username: 'jf-test',
    password,
  });
  assert.equal(login.success, true, login.message);
  assert.ok(login.accessToken && login.userId);
  console.log('Jellyfin 12.4 login: PASS');

  const server: EmbyMediaServer = {
    id: 'jf-124', name: 'QA124', type: 'jellyfin', enabled: true,
    url: base, apiKey: '', accessToken: login.accessToken, userId: login.userId,
  };
  const folders = await fetchServerLibraryFolders(server);
  assert.ok(folders.some((folder) => folder.name === 'QA124'));
  console.log('Library folders: PASS');

  let state: EmbyLibraryState = { entries: {}, updatedAt: 0 };
  let syncResult: { success?: boolean; synced?: number; failed?: number } = {};
  let playedResult: { success?: boolean; error?: string } = {};
  const deps = {
    getSettings: async () => ({ emby: { mediaServers: [server], libraryEnabled: true } }),
    saveSettings: async () => {},
    getState: async () => state,
    saveState: async (next: EmbyLibraryState) => { state = next; },
    fetchImpl: fetch,
    now: () => Date.now(),
    processCleanupSync: async () => ({ enqueuedCount: 0, baselineCount: 0 }),
  };
  await handleEmbyLibrarySync({ manual: true }, (value) => { syncResult = value; }, deps);
  assert.equal(syncResult.success, true);
  assert.equal(syncResult.failed, 0);
  const itemId = state.entries['ABC-123']?.[0]?.itemId;
  assert.ok(itemId, 'The synthetic movie must be indexed as ABC-123');
  console.log('Library sync and code index: PASS');

  const detail = await fetchEmbyItemDetail({ server, itemId });
  assert.equal(detail.success, true, detail.error);
  assert.equal(detail.detail?.name, 'ABC-123');
  console.log('Item detail: PASS');

  const stream = await resolveEmbyStreamUrl({ server, itemId });
  assert.equal(stream.success, true, stream.message);
  assert.ok(stream.streamUrl);
  assert.equal(new URL(stream.streamUrl).origin, base);
  const mediaResponse = await fetch(stream.streamUrl, { headers: { Range: 'bytes=0-511' } });
  assert.equal(mediaResponse.status, 206);
  assert.equal((await mediaResponse.arrayBuffer()).byteLength, 512);
  console.log('PlaybackInfo and ranged stream: PASS');

  const progress = await reportEmbyPlaybackProgress({
    server, itemId, positionSeconds: 1, durationSeconds: 3, fetchImpl: fetch,
  });
  assert.equal(progress.success, true, progress.message);
  assert.equal(progress.method, 'both');
  console.log('UserData and playing session progress: PASS');

  const userDataUrl = `${base}/UserItems/${itemId}/UserData?userId=${login.userId}`;
  const readUserData = async (): Promise<{ Played?: boolean }> => {
    const response = await fetch(userDataUrl, { headers: buildEmbyAuthHeaders(server) });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ Played?: boolean }>;
  };
  for (const played of [true, false]) {
    await handleEmbyLibrarySetPlayed(
      { itemId, serverUrl: base, played },
      (value) => { playedResult = value; },
      deps,
    );
    assert.equal(playedResult.success, true, playedResult.error);
    assert.equal((await readUserData()).Played, played);
  }
  console.log('Mark watched and unwatch: PASS');

  const stopped = await reportEmbyPlaybackProgress({
    server, itemId, positionSeconds: 1, isStopped: true, fetchImpl: fetch,
  });
  assert.equal(stopped.success, true, stopped.message);
  assert.equal(stopped.method, 'both');
  console.log('Stop playing session: PASS');

  const anonymousResponse = await fetch(userDataUrl);
  assert.equal(anonymousResponse.status, 401);
  console.log('Unauthenticated request denied: PASS');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
