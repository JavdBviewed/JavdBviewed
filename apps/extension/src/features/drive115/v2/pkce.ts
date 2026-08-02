/**
 * @file pkce.ts
 * @description pkce
 * @module features/drive115
 */
import { normalizeDrive115TokenExpiry } from './tokenExpiry';

const DRIVE115_AUTH_DEVICE_URL = 'https://passportapi.115.com/open/authDeviceCode';
const DRIVE115_QR_STATUS_URL = 'https://qrcodeapi.115.com/get/status/';
const DRIVE115_TOKEN_URL = 'https://passportapi.115.com/open/deviceCodeToToken';

export interface Drive115PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface Drive115DeviceCodeResult {
  uid: string;
  time: string;
  sign: string;
  qrcode: string;
  raw?: any;
}

export interface Drive115QrStatusResult {
  state: number;
  status: number;
  msg: string;
  version?: string;
  raw?: any;
}

export interface Drive115DeviceTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at: number | null;
  raw?: any;
}

function base64UrlEncode(input: ArrayBuffer): string {
  const bytes = new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let output = '';
  for (let i = 0; i < array.length; i += 1) {
    output += chars[array[i] % chars.length];
  }
  return output;
}

function getJsonErrorMessage(data: any, fallback: string): string {
  return data?.message || data?.error || fallback;
}

async function sendRuntimeMessage<T>(type: string, payload: any): Promise<T | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') {
    return null;
  }

  return new Promise<T | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve((resp || null) as T | null);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function generateDrive115PkcePair(): Promise<Drive115PkcePair> {
  const codeVerifier = randomString(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64UrlEncode(digest);
  return { codeVerifier, codeChallenge };
}

export function buildDrive115QrImageUrl(content: string): string {
  const params = new URLSearchParams({ size: '280x280', data: content });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

export async function requestDrive115DeviceCode(
  clientId: string,
  codeChallenge: string,
  codeChallengeMethod = 'sha256'
): Promise<Drive115DeviceCodeResult> {
  const trimmedClientId = String(clientId || '').trim();
  if (!trimmedClientId) {
    throw new Error('缺少 APP ID');
  }

  const bgResp = await sendRuntimeMessage<any>('drive115.auth_device_code_v2', {
    clientId: trimmedClientId,
    codeChallenge,
    codeChallengeMethod,
  });
  let raw = bgResp?.raw;

  if (!raw) {
    const body = new URLSearchParams({
      client_id: trimmedClientId,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
    });
    const resp = await fetch(DRIVE115_AUTH_DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(),
    });
    raw = await resp.json().catch(() => ({}));
    if (!resp.ok && !raw?.data) {
      throw new Error(getJsonErrorMessage(raw, `获取二维码失败: ${resp.status} ${resp.statusText}`));
    }
  } else if (bgResp?.success === false) {
    throw new Error(getJsonErrorMessage(raw, bgResp?.message || '获取二维码失败'));
  }

  const data = raw?.data || {};
  if (!data?.uid || !data?.time || !data?.sign || !data?.qrcode) {
    throw new Error(getJsonErrorMessage(raw, '获取二维码失败'));
  }

  return {
    uid: String(data.uid),
    time: String(data.time),
    sign: String(data.sign),
    qrcode: String(data.qrcode),
    raw,
  };
}

export async function pollDrive115DeviceStatus(
  uid: string,
  time: string,
  sign: string
): Promise<Drive115QrStatusResult> {
  if (!uid || !time || !sign) {
    throw new Error('缺少扫码会话参数');
  }

  const bgResp = await sendRuntimeMessage<any>('drive115.poll_auth_status_v2', { uid, time, sign });
  let raw = bgResp?.raw;

  if (!raw) {
    const params = new URLSearchParams({ uid, time, sign });
    const resp = await fetch(`${DRIVE115_QR_STATUS_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    raw = await resp.json().catch(() => ({}));
    if (!resp.ok && raw?.state === undefined) {
      throw new Error(getJsonErrorMessage(raw, `轮询扫码状态失败: ${resp.status} ${resp.statusText}`));
    }
  } else if (bgResp?.success === false) {
    throw new Error(getJsonErrorMessage(raw, bgResp?.message || '轮询扫码状态失败'));
  }

  return {
    state: Number(raw?.state ?? 0),
    status: Number(raw?.data?.status ?? 0),
    msg: String(raw?.data?.msg || raw?.message || ''),
    version: raw?.data?.version ? String(raw.data.version) : undefined,
    raw,
  };
}

export async function exchangeDrive115DeviceCode(
  uid: string,
  codeVerifier: string
): Promise<Drive115DeviceTokenResult> {
  if (!uid || !codeVerifier) {
    throw new Error('缺少换取 token 的必要参数');
  }

  const bgResp = await sendRuntimeMessage<any>('drive115.exchange_device_code_v2', { uid, codeVerifier });
  let raw = bgResp?.raw;

  if (!raw) {
    const body = new URLSearchParams({ uid, code_verifier: codeVerifier });
    const resp = await fetch(DRIVE115_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(),
    });
    raw = await resp.json().catch(() => ({}));
    if (!resp.ok && !raw?.data) {
      throw new Error(getJsonErrorMessage(raw, `获取 token 失败: ${resp.status} ${resp.statusText}`));
    }
  } else if (bgResp?.success === false) {
    throw new Error(getJsonErrorMessage(raw, bgResp?.message || '获取 token 失败'));
  }

  const data = raw?.data || raw || {};
  const accessToken = String(data?.access_token || '').trim();
  const refreshToken = String(data?.refresh_token || '').trim();
  const expiresIn = Number(data?.expires_in ?? 0) || 0;

  if (!accessToken) {
    throw new Error(getJsonErrorMessage(raw, '获取 token 失败'));
  }

  const nowSec = Math.floor(Date.now() / 1000);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn || undefined,
    expires_at: normalizeDrive115TokenExpiry({
      expires_at: data?.expires_at,
      expires_in: data?.expires_in,
    }, nowSec),
    raw,
  };
}
