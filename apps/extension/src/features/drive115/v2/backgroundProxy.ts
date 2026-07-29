/**
 * @file backgroundProxy.ts
 * @description backgroundProxy
 * @module features/drive115
 */
// src/features/drive115/v2/backgroundProxy.ts
// 抽离 115 v2 后台代理（解决内容脚本 CORS）
import {
  extractStreamUrlFromPlayResponse,
  inferDrive115StreamType,
  maskDrive115StreamUrlForLog,
  type Drive115PlaybackEndpointKind,
} from './streamResponse';

function logDrive115Proxy(message: string, data?: any): void {
  try {
    if (data !== undefined) console.info(`[115Proxy] ${message}`, data);
    else console.info(`[115Proxy] ${message}`);
  } catch {}
}

export function installDrive115V2Proxy(): void {
  try {
    // 避免重复注册
    // @ts-ignore
    const __drive115_v2_proxy_flag = (globalThis as any).__drive115_v2_proxy_flag;
    if (!__drive115_v2_proxy_flag && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      // @ts-ignore
      (globalThis as any).__drive115_v2_proxy_flag = true;
      chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse): boolean | void => {
        if (!message || typeof message !== 'object') return false;
        if (message.type === 'drive115.add_task_urls_v2') {
          const payload = message.payload || {};
          const accessToken = String(payload.accessToken || '').trim();
          const urls = String(payload.urls || '');
          const wp_path_id = payload.wp_path_id;
          const base = String(payload.baseUrl || 'https://proapi.115.com').replace(/\/$/, '');
          const correlationId = String(payload.correlationId || '').trim();
          const taskId = String(payload.taskId || '').trim();
          if (!accessToken || !urls) {
            sendResponse({ success: false, message: '缺少 accessToken 或 urls' });
            return false;
          }

          const fd = new FormData();
          fd.set('urls', urls);
          if (wp_path_id !== undefined) fd.set('wp_path_id', String(wp_path_id));

          const fetchStartedAt = Date.now();
          const slowWarnMs = 10000;
          const slowWarnTimer = setTimeout(() => {
            logDrive115Proxy('add_task_urls still pending', {
              taskId,
              correlationId,
              waitedMs: Date.now() - fetchStartedAt,
              wp_path_id: wp_path_id ?? 'root',
            });
          }, slowWarnMs);

          logDrive115Proxy('add_task_urls fetch start', {
            taskId,
            correlationId,
            wp_path_id: wp_path_id ?? 'root',
            startedAt: fetchStartedAt,
          });

          fetch(`${base}/open/offline/add_task_urls`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            },
            body: fd,
          })
            .then(async (res) => {
              clearTimeout(slowWarnTimer);
              const raw = await res.json().catch(() => ({} as any));
              const ok = typeof raw.state === 'boolean' ? raw.state : res.ok;
              const data = (raw && (raw.data || raw.result)) || undefined;
              logDrive115Proxy('add_task_urls fetch done', {
                taskId,
                correlationId,
                ok,
                status: res.status,
                durationMs: Date.now() - fetchStartedAt,
              });
              sendResponse({ success: ok, message: raw?.message || raw?.error, raw, data });
            })
            .catch((err) => {
              clearTimeout(slowWarnTimer);
              logDrive115Proxy('add_task_urls fetch error', {
                taskId,
                correlationId,
                durationMs: Date.now() - fetchStartedAt,
                error: err?.message || String(err),
              });
              sendResponse({ success: false, message: err?.message || '后台请求失败' });
            });
          return true; // 异步响应
        } else if (message.type === 'drive115.refresh_token_v2') {
          try {
            const rt = String(message?.payload?.refreshToken || '').trim();
            const refreshBase = 'https://passportapi.115.com';
            if (!rt) {
              sendResponse({ success: false, message: '缺少 refresh_token' });
              return false;
            }
            const fd = new URLSearchParams();
            fd.set('refresh_token', rt);
            fetch(`${refreshBase}/open/refreshToken`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
              body: fd.toString(),
            })
              .then(async (res) => {
                const raw = await res.json().catch(() => ({} as any));
                const ok = typeof raw.state === 'boolean' ? raw.state : res.ok;
                sendResponse({ success: ok, raw });
              })
              .catch((err) => {
                sendResponse({ success: false, message: err?.message || '后台刷新请求失败' });
              });
            return true; // 异步响应
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台刷新异常' });
            return false;
          }
        } else if (message.type === 'drive115.auth_device_code_v2') {
          try {
            const clientId = String(message?.payload?.clientId || '').trim();
            const codeChallenge = String(message?.payload?.codeChallenge || '').trim();
            const codeChallengeMethod = String(message?.payload?.codeChallengeMethod || 'sha256').trim() || 'sha256';
            if (!clientId || !codeChallenge) {
              sendResponse({ success: false, message: '缺少 client_id 或 code_challenge' });
              return false;
            }
            const fd = new URLSearchParams();
            fd.set('client_id', clientId);
            fd.set('code_challenge', codeChallenge);
            fd.set('code_challenge_method', codeChallengeMethod);
            fetch('https://passportapi.115.com/open/authDeviceCode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
              body: fd.toString(),
            })
              .then(async (res) => {
                const raw = await res.json().catch(() => ({} as any));
                const ok = !!(raw?.data?.uid) || (typeof raw?.state === 'boolean' ? raw.state : res.ok);
                sendResponse({ success: ok, message: raw?.message || raw?.error, raw });
              })
              .catch((err) => {
                sendResponse({ success: false, message: err?.message || '后台获取扫码信息失败' });
              });
            return true;
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台获取扫码信息异常' });
            return false;
          }
        } else if (message.type === 'drive115.poll_auth_status_v2') {
          try {
            const uid = String(message?.payload?.uid || '').trim();
            const time = String(message?.payload?.time || '').trim();
            const sign = String(message?.payload?.sign || '').trim();
            if (!uid || !time || !sign) {
              sendResponse({ success: false, message: '缺少 uid、time 或 sign' });
              return false;
            }
            const url = new URL('https://qrcodeapi.115.com/get/status/');
            url.searchParams.set('uid', uid);
            url.searchParams.set('time', time);
            url.searchParams.set('sign', sign);
            fetch(url.toString(), {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
            })
              .then(async (res) => {
                const raw = await res.json().catch(() => ({} as any));
                const ok = raw?.state !== undefined || (typeof raw?.code === 'number') || res.ok;
                sendResponse({ success: ok, message: raw?.message || raw?.error, raw });
              })
              .catch((err) => {
                sendResponse({ success: false, message: err?.message || '后台轮询扫码状态失败' });
              });
            return true;
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台轮询扫码状态异常' });
            return false;
          }
        } else if (message.type === 'drive115.exchange_device_code_v2') {
          try {
            const uid = String(message?.payload?.uid || '').trim();
            const codeVerifier = String(message?.payload?.codeVerifier || '').trim();
            if (!uid || !codeVerifier) {
              sendResponse({ success: false, message: '缺少 uid 或 code_verifier' });
              return false;
            }
            const fd = new URLSearchParams();
            fd.set('uid', uid);
            fd.set('code_verifier', codeVerifier);
            fetch('https://passportapi.115.com/open/deviceCodeToToken', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
              body: fd.toString(),
            })
              .then(async (res) => {
                const raw = await res.json().catch(() => ({} as any));
                const token = raw?.data || raw;
                const ok = !!token?.access_token || (typeof raw?.state === 'boolean' ? raw.state : res.ok);
                sendResponse({ success: ok, message: raw?.message || raw?.error, raw });
              })
              .catch((err) => {
                sendResponse({ success: false, message: err?.message || '后台换取 token 失败' });
              });
            return true;
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台换取 token 异常' });
            return false;
          }
        } else if (message.type === 'drive115.list_files_v2') {
          try {
            const accessToken = String(message?.payload?.accessToken || '').trim();
            const base = String(message?.payload?.baseUrl || 'https://proapi.115.com').replace(/\/$/, '');
            const query = message?.payload?.query || {};
            if (!accessToken) {
              sendResponse({ success: false, message: '缺少 access_token' });
              return false;
            }

            const url = new URL(`${base}/open/ufile/files`);
            Object.entries(query).forEach(([key, value]) => {
              if (value !== undefined && value !== null && String(value).trim() !== '') {
                url.searchParams.set(key, String(value));
              }
            });

            fetch(url.toString(), {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
              },
            }).then(async (res) => {
              const raw = await res.json().catch(() => ({} as any));
              const ok = typeof raw.state === 'boolean' ? raw.state : res.ok;
              sendResponse({
                success: ok,
                message: raw?.message || raw?.error,
                raw,
                data: raw?.data,
                path: raw?.path,
              });
            }).catch((err) => {
              sendResponse({ success: false, message: err?.message || '后台文件列表请求失败' });
            });
            return true;
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台文件列表异常' });
            return false;
          }
        } else if (message.type === 'drive115.get_quota_info_v2') {
          try {
            const accessToken = String(message?.payload?.accessToken || '').trim();
            const base = String(message?.payload?.baseUrl || 'https://proapi.115.com').replace(/\/$/, '');
            if (!accessToken) {
              sendResponse({ success: false, message: '缺少 access_token' });
              return false;
            }
            fetch(`${base}/open/offline/get_quota_info`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
              },
            }).then(async (res) => {
              const raw = await res.json().catch(() => ({} as any));
              const ok = typeof raw.state === 'boolean' ? raw.state : res.ok;
              sendResponse({ success: ok, raw });
            }).catch((err) => {
              sendResponse({ success: false, message: err?.message || '后台配额请求失败' });
            });
            return true; // 异步响应
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台配额异常' });
            return false;
          }
        } else if (message.type === 'drive115.delete_files_v2') {
          try {
            const accessToken = String(message?.payload?.accessToken || '').trim();
            const base = String(message?.payload?.baseUrl || 'https://proapi.115.com').replace(/\/$/, '');
            const fileIds = Array.isArray(message?.payload?.fileIds)
              ? message.payload.fileIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
              : [];
            if (!accessToken || !fileIds.length) {
              sendResponse({ success: false, message: '缺少 accessToken 或 fileIds' });
              return false;
            }
            const endpoints = [`${base}/open/rb/delete`, `${base}/open/ufile/delete`];
            const tryNext = (idx: number) => {
              if (idx >= endpoints.length) {
                sendResponse({ success: false, message: '删除接口均不可用' });
                return;
              }
              const url = endpoints[idx];
              const fd = new FormData();
              fd.set('file_id', fileIds.join(','));
              fd.set('file_ids', fileIds.join(','));
              fetch(url, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: 'application/json',
                },
                body: fd,
              })
                .then(async (res) => {
                  const raw = await res.json().catch(() => ({} as any));
                  const ok = (typeof raw.state === 'boolean' ? raw.state : res.ok) && res.ok;
                  if (ok) {
                    sendResponse({ success: true, raw, endpoint: url });
                    return;
                  }
                  if (idx + 1 < endpoints.length) {
                    tryNext(idx + 1);
                    return;
                  }
                  sendResponse({
                    success: false,
                    message: raw?.message || raw?.error || `删除失败 (${res.status})`,
                    raw,
                    endpoint: url,
                  });
                })
                .catch((err) => {
                  if (idx + 1 < endpoints.length) {
                    tryNext(idx + 1);
                    return;
                  }
                  sendResponse({ success: false, message: err?.message || '后台删除请求失败' });
                });
            };
            tryNext(0);
            return true;
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台删除异常' });
            return false;
          }
        } else if (message.type === 'drive115.video_play_v2') {
          try {
            const accessToken = String(message?.payload?.accessToken || '').trim();
            const pickCode = String(message?.payload?.pickCode || '').trim();
            const base = String(message?.payload?.baseUrl || 'https://proapi.115.com').replace(/\/$/, '');
            if (!accessToken || !pickCode) {
              sendResponse({ success: false, message: '缺少 accessToken 或 pickCode' });
              return false;
            }
            const endpoints: Array<{ url: string; kind: Drive115PlaybackEndpointKind; init: () => RequestInit }> = [
              // ????????????? <video> ???????? CDN MP4?
              // ?? /open/video/play ?? HLS ?? m3u8 ?? CORS/Referer ?????
              {
                url: `${base}/open/ufile/downurl`,
                kind: 'downurl',
                init: () => {
                  const body = new FormData();
                  body.set('pick_code', pickCode);
                  return { method: 'POST', body };
                },
              },
              {
                url: `${base}/open/video/play?pick_code=${encodeURIComponent(pickCode)}`,
                kind: 'video_play',
                init: () => ({ method: 'GET' }),
              },
              {
                url: `${base}/open/video/play?pickcode=${encodeURIComponent(pickCode)}`,
                kind: 'video_play',
                init: () => ({ method: 'GET' }),
              },
              {
                url: `${base}/open/video/play`,
                kind: 'video_play',
                init: () => {
                  const body = new FormData();
                  body.set('pick_code', pickCode);
                  return { method: 'POST', body };
                },
              },
            ];

            const extractUrl = (json: unknown): string | undefined => extractStreamUrlFromPlayResponse(json);
            const tryNext = (idx: number) => {
              if (idx >= endpoints.length) {
                sendResponse({ success: false, message: '取流接口均不可用' });
                return;
              }
              const endpoint = endpoints[idx];
              fetch(endpoint.url, {
                ...endpoint.init(),
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: 'application/json',
                },
              })
                .then(async (res) => {
                  const raw = await res.json().catch(() => ({} as any));
                  const ok = (typeof raw.state === 'boolean' ? raw.state : res.ok) && res.ok;
                  const streamUrl = ok ? extractUrl(raw) : undefined;
                  if (streamUrl) {
                    const streamType = inferDrive115StreamType({
                      url: streamUrl,
                      raw,
                      endpointKind: endpoint.kind,
                      endpoint: endpoint.url,
                    });
                    const debugSafeUrl = maskDrive115StreamUrlForLog(streamUrl);
                    sendResponse({ success: true, streamUrl, streamType, raw, endpoint: endpoint.url, debugSafeUrl });
                    return;
                  }
                  if (idx + 1 < endpoints.length) {
                    tryNext(idx + 1);
                    return;
                  }
                  sendResponse({
                    success: false,
                    message: raw?.message || raw?.error || '响应中无播放地址',
                    raw,
                    endpoint: endpoint.url,
                  });
                })
                .catch(() => {
                  if (idx + 1 < endpoints.length) tryNext(idx + 1);
                  else sendResponse({ success: false, message: '后台取流请求失败' });
                });
            };
            tryNext(0);
            return true;
          } catch (e: any) {
            sendResponse({ success: false, message: e?.message || '后台取流异常' });
            return false;
          }
        }
        // 未匹配任何 115 v2 消息类型
        return false;
      });
    }
  } catch (e) {
    // 静默
  }
}
