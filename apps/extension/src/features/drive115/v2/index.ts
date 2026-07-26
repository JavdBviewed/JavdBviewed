/**
 * @file index.ts
 * @description 115 网盘集成（磁力推送、文件管理）统一导出
 * @module features/drive115
 */
import { getSettings, saveSettings } from '../../../utils/storage';
import { describe115Error } from './errorCodes';
import { addLogV2 } from './logs';

/**
 * drive115v2: 基于 access_token/refresh_token 的新版 115 服务骨架
 * 仅用于承载设置与后续刷新逻辑，不影响旧版实现。
 */

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null; // 秒级时间戳
}

// 115 v2 用户信息（基于 /open/user/info 推测的常见字段集合，做可选兜底）
export interface Drive115V2UserInfo {
  // 基础
  id?: number | string;
  uid?: number | string;
  user_id?: number | string;
  name?: string;
  username?: string;
  nick?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  avatar_small?: string;
  avatar_middle?: string;
  avatar_large?: string;

  // 空间与会员
  space_total?: number;
  space_used?: number;
  space_free?: number;
  is_vip?: boolean | number;
  vip_level?: number | string;
  vip_expire?: number | string; // 可能为时间戳或可解析字符串
}

export interface Drive115V2UserInfoResponse {
  state?: boolean;
  errNo?: number;
  error?: string;
  data?: Drive115V2UserInfo;
  // 有些实现可能直接平铺返回用户字段，因此保留索引签名
  [k: string]: any;
}


// v2 文件搜索：查询参数与返回类型
export interface Drive115V2SearchQuery {
  search_value: string; // 关键字（必填）
  limit: number;        // 单页记录数（必填）
  offset: number;       // 偏移量（必填）
  file_label?: string;  // 标签（可选）
  cid?: string | number; // 目录ID，-1 表示不返回列表任何内容（可选）
  gte_day?: string;     // 开始时间 YYYY-MM-DD（可选）
  lte_day?: string;     // 结束时间 YYYY-MM-DD（可选）
  fc?: 1 | 2;           // 只显示文件或文件夹：1 文件夹；2 文件（可选）
  type?: 1 | 2 | 3 | 4 | 5 | 6; // 一级分类：文档/图片/音乐/视频/压缩包/应用（可选）
  suffix?: string;      // 其他后缀（可选）
}

export interface Drive115V2SearchItem {
  file_id: string;
  user_id: string;
  sha1: string;
  file_name: string;
  file_size: string;
  user_ptime: string;
  user_utime: string;
  pick_code: string;
  parent_id: string;
  area_id: string; // 1 正常，7 回收站，120 彻底删除
  is_private: number; // 0 未隐藏，1 已隐藏
  file_category: string; // 1 文件；0 文件夹（按文档原文）
  ico: string; // 文件后缀
  [k: string]: any;
}

export interface Drive115V2SearchResponse {
  state?: boolean;
  message?: string;
  code?: number;
  count?: number; // 符合条件总数
  data?: Drive115V2SearchItem[];
  limit?: number;
  offset?: number;
  [k: string]: any;
}

export interface Drive115V2FileListItem {
  fid?: string;
  cid?: string | number;
  pid?: string | number;
  fc?: string | number; // 0 文件夹，1 文件
  fn?: string;
  file_name?: string;
  file_id?: string;
  [k: string]: any;
}

export interface Drive115V2PathItem {
  name?: string;
  file_name?: string;
  cid?: string | number;
  file_id?: string | number;
  [k: string]: any;
}

export interface Drive115V2FileListResponse {
  state?: boolean;
  message?: string;
  code?: number;
  count?: number;
  offset?: number;
  limit?: number;
  cid?: string | number;
  data?: Drive115V2FileListItem[];
  path?: Drive115V2PathItem[];
  [k: string]: any;
}


// 配额信息类型（/open/offline/get_quota_info）
export interface Drive115V2QuotaExpireInfo {
  expire_time?: number | string | null;
  expire_text?: string;
  [k: string]: any;
}

export interface Drive115V2QuotaItem {
  name?: string;          // 配额类型名称
  type?: string | number; // 配额类型标识
  count?: number;         // 配额总数
  used?: number;          // 已用
  surplus?: number;       // 剩余
  expire_info?: Drive115V2QuotaExpireInfo | null; // 过期信息
  [k: string]: any;
}

export interface Drive115V2QuotaInfo {
  total?: number;               // 总额度（若返回）
  used?: number;                // 已使用总额（若返回）
  surplus?: number;             // 总剩余（若返回）
  list?: Drive115V2QuotaItem[]; // 各配额项
  [k: string]: any;
}

export interface Drive115V2QuotaResponse {
  state?: boolean;
  message?: string;
  code?: number;
  data?: Drive115V2QuotaInfo | Drive115V2QuotaItem[] | any;
  [k: string]: any;
}

// 云下载任务类型定义
export interface Drive115V2Task {
  info_hash?: string;        // 任务sha1
  add_time?: number;         // 任务添加时间戳
  percentDone?: number;      // 任务下载进度
  size?: number;             // 任务总大小（字节）
  name?: string;             // 任务名
  last_update?: number;      // 任务最后更新时间戳
  file_id?: string;          // 任务源文件（夹）对应文件（夹）id
  delete_file_id?: string;   // 删除任务需删除源文件（夹）时，对应需传递的文件（夹）id
  status?: number;           // 任务状态：-1下载失败；0分配中；1下载中；2下载成功
  url?: string;              // 链接任务url
  wp_path_id?: string;       // 任务源文件所在父文件夹id
  def2?: number;             // 视频清晰度；1:标清 2:高清 3:超清 4:1080P 5:4k;100:原画
  play_long?: number;        // 视频时长
  can_appeal?: number;       // 是否可申诉
  [k: string]: any;
}

export interface Drive115V2TaskListData {
  page?: number;             // 当前第几页
  page_count?: number;       // 总页数
  count?: number;            // 总数量
  tasks?: Drive115V2Task[];  // 云下载任务列表
  [k: string]: any;
}

export interface Drive115V2TaskListResponse {
  state?: boolean;
  message?: string;
  code?: number;
  data?: Drive115V2TaskListData;
  [k: string]: any;
}


class Drive115V2Service {
  private static instance: Drive115V2Service | null = null;
  // 并发刷新保护：避免多处同时触发 refresh 导致频繁请求
  private refreshingPromise: Promise<{ success: boolean; message?: string; token?: TokenPair; raw?: any }> | null = null;
  private getUserDisplayName(user?: Drive115V2UserInfo | null): string {
    const u: any = user || {};
    const uid = u.uid || u.user_id || u.id || '-';
    const name = u.user_name || u.name || u.nick || u.username || '';
    return name ? `${name} (UID ${uid})` : `UID ${uid}`;
  }
  // 基础域名：从设置读取（默认 https://proapi.115.com）
  private async getBaseURL(): Promise<string> {
    try {
      const settings = await getSettings();
      const url = (settings?.drive115?.v2ApiBaseUrl || '').toString().trim();
      if (url) return url.replace(/\/$/, '');
    } catch {}
    return 'https://proapi.115.com';
  }
  // 刷新域名：按文档使用 passportapi
  private readonly refreshURL = 'https://passportapi.115.com';

  static getInstance(): Drive115V2Service {
    if (!this.instance) this.instance = new Drive115V2Service();
    return this.instance;
  }

  /**
   * 获取离线配额信息（v2）
   * GET {baseURL}/open/offline/get_quota_info
   * Header: Authorization: Bearer <access_token>
   */
  async getQuotaInfo(params: { accessToken: string }): Promise<
    { success: boolean; message?: string; raw?: Drive115V2QuotaResponse } & { data?: Drive115V2QuotaInfo }
  > {
    try {
      const token = (params.accessToken || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' } as any;

      const base = await this.getBaseURL();
      const url = `${base}/open/offline/get_quota_info`;
      await addLogV2({ timestamp: Date.now(), level: 'debug', message: '开始获取离线配额信息（v2）' });

      // 优先通过后台代理，避免某些环境下的 CORS/站点策略问题
      let json: Drive115V2QuotaResponse | undefined;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
          const bgResp: any = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                { type: 'drive115.get_quota_info_v2', payload: { accessToken: token, baseUrl: base } },
                (resp) => resolve(resp)
              );
            } catch { resolve(undefined); }
          });
          if (bgResp && typeof bgResp.success === 'boolean') {
            if (!bgResp.success) {
              await addLogV2({ timestamp: Date.now(), level: 'warn', message: `后台配额请求失败：${bgResp.message || '未知'}` });
              // 不中断，回退前端 fetch
            } else {
              json = (bgResp.raw || {}) as Drive115V2QuotaResponse;
            }
          }
        }
      } catch {}

      // 回退：直接在前端发起 fetch
      if (!json) {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });

        if (!res.ok) {
          const msg = `获取离线配额网络错误: ${res.status} ${res.statusText}`;
          await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
          return { success: false, message: msg } as any;
        }
        json = await res.json().catch(() => ({} as any));
      }
      // 兜底保护：即便仍未得到 json，也给出失败信息
      if (!json) {
        const msg = '获取配额失败：未得到有效响应';
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
        return { success: false, message: msg } as any;
      }
      const ok = typeof (json as any).state === 'boolean' ? (json as any).state : true;
      if (!ok) {
        const msg = describe115Error(json) || (json as any).message || '获取配额失败';
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: `获取离线配额失败：${msg}` });
        return { success: false, message: msg, raw: json } as any;
      }

      // 兼容 data 直接为数组或对象
      let info: Drive115V2QuotaInfo | undefined = undefined;
      if (json && typeof json === 'object') {
        const j: any = json as any;
        if (j.data && typeof j.data === 'object') {
          if (Array.isArray(j.data)) {
            info = { list: j.data as any[] } as Drive115V2QuotaInfo;
          } else {
            info = j.data as Drive115V2QuotaInfo;
          }
        } else {
          // 回退：将可能的已知字段平铺映射
          const candidate: any = j;
          const picked: any = {};
          let hasAny = false;
          for (const k of ['total','used','surplus','list']) {
            if (k in candidate) { picked[k] = candidate[k]; hasAny = true; }
          }
          if (hasAny) info = picked as Drive115V2QuotaInfo;
        }
      }

      // 若成功但仍没有可渲染字段，给一个空对象，后续会在调用方尝试用用户信息兜底
      if (!info) info = {} as Drive115V2QuotaInfo;

      await addLogV2({ timestamp: Date.now(), level: 'info', message: '获取离线配额信息成功（v2）' });
      return { success: true, data: info, raw: json } as any;
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '获取配额失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `获取离线配额异常：${msg}` });
      return { success: false, message: msg } as any;
    }
  }

  /**
   * 存储优先获取离线配额：默认仅读取本地缓存；仅在 forceRefresh 时进行网络请求并持久化
   * 缓存键：chrome.storage.local['drive115_quota_cache'] => { data: Drive115V2QuotaInfo, updatedAt: number }
   */
  async getQuotaInfoAuto(opts?: { forceAutoRefresh?: boolean; forceRefresh?: boolean }): Promise<
    { success: boolean; data?: Drive115V2QuotaInfo; cached?: boolean; updatedAt?: number; message?: string; raw?: Drive115V2QuotaResponse }
  > {
    try {
      // 1) 读取本地缓存
      try {
        // 优先从设置中读取镜像
        try {
          const settings = await getSettings();
          const cachedMirror: any = (settings as any)?.drive115?.quotaCache || null;
          if (!opts?.forceRefresh && cachedMirror && cachedMirror.data) {
            return { success: true, data: cachedMirror.data as Drive115V2QuotaInfo, cached: true, updatedAt: Number(cachedMirror.updatedAt) || undefined } as any;
          }
        } catch {}

        // 其次从 chrome.storage 本地缓存读取
        const bag = await (chrome as any)?.storage?.local?.get?.('drive115_quota_cache');
        const cached = bag?.['drive115_quota_cache'];
        if (!opts?.forceRefresh && cached && cached.data) {
          return { success: true, data: cached.data as Drive115V2QuotaInfo, cached: true, updatedAt: Number(cached.updatedAt) || undefined } as any;
        }
      } catch {}

      // 2) 非强制刷新则直接返回“未命中缓存”
      if (!opts?.forceRefresh) {
        return { success: false, message: 'no-cache' } as any;
      }

      // 3) 强制刷新：本次点击应当总是发起请求
      //    先用现有 access_token 尝试；仅当判定 token 失效时才触发自动刷新（该刷新受最小间隔限制）
      const settings = await getSettings();
      const drv: any = settings?.drive115 || {};
      let atTry: string = (drv.v2AccessToken || '').trim();
      // 若完全没有 access_token，再走一次 getValidAccessToken（可能触发刷新）
      if (!atTry) {
        const vt0 = await this.getValidAccessToken({ forceAutoRefresh: !!opts?.forceAutoRefresh });
        if (vt0.success) atTry = vt0.accessToken;
      }

      // 第一次尝试：用现有 token 获取
      let fresh = await this.getQuotaInfo({ accessToken: atTry });
      if (!fresh.success) {
        const tokenInvalid = this.isTokenInvalidResponse((fresh as any).raw) || /access[_\s-]?token/i.test(String(fresh.message || ''));
        if (tokenInvalid) {
          // 仅此时尝试自动刷新；该刷新内部有最小间隔限制
          const vt = await this.getValidAccessToken({ forceAutoRefresh: !!opts?.forceAutoRefresh });
          if (vt.success) {
            fresh = await this.getQuotaInfo({ accessToken: vt.accessToken });
            // 若重试仍失败，不直接返回，继续尝试用用户信息兜底
          } else {
            // 刷新被限频或失败，不直接返回，继续尝试用用户信息兜底
          }
        } else {
          // 非 token 失效：不直接返回，进入兜底推导逻辑
        }
      }

      // 4) 兜底：若接口不可用或返回无关键字段，尝试从用户信息的空间字段推导（v2UserInfo.rt_space_info）
      let dataFinal: Drive115V2QuotaInfo | undefined = fresh.data as any;
      const hasKeyNums = (o: any) => o && (typeof o.total === 'number' || typeof o.used === 'number' || typeof o.surplus === 'number');
      if (!hasKeyNums(dataFinal)) {
        try {
          const settingsNow = await getSettings();
          const rtsi = (settingsNow as any)?.drive115?.v2UserInfo?.rt_space_info;
          const all_total = Number(rtsi?.all_total?.size ?? rtsi?.all_total ?? NaN);
          const all_use = Number(rtsi?.all_use?.size ?? rtsi?.all_use ?? NaN);
          const all_remain = Number(rtsi?.all_remain?.size ?? rtsi?.all_remain ?? NaN);
          if (Number.isFinite(all_total) || Number.isFinite(all_use) || Number.isFinite(all_remain)) {
            dataFinal = {
              total: Number.isFinite(all_total) ? all_total : undefined,
              used: Number.isFinite(all_use) ? all_use : undefined,
              surplus: Number.isFinite(all_remain) ? all_remain : (Number.isFinite(all_total) && Number.isFinite(all_use) ? Math.max(0, all_total - all_use) : undefined),
            } as Drive115V2QuotaInfo;
          }
        } catch {}
      }

      const record = { data: dataFinal || ({} as Drive115V2QuotaInfo), updatedAt: Date.now() };
      try {
        await (chrome as any)?.storage?.local?.set?.({ 'drive115_quota_cache': record });
        // 同步镜像到设置，满足“配额需要存储同步”的需求
        try {
          const settings = await getSettings();
          const newSettings: any = { ...(settings || {}) };
          newSettings.drive115 = { ...(settings as any)?.drive115 };
          newSettings.drive115.quotaCache = record;
          await saveSettings(newSettings);
        } catch {}
      } catch {}

      return { success: true, data: record.data, cached: false, updatedAt: record.updatedAt, raw: fresh.raw } as any;
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '获取配额失败';
      return { success: false, message: msg } as any;
    }
  }

  private constructor() {}

  // 预留：手动刷新 access_token（未来会调用 https://api.oplist.org/ 流程）
  async manualRefresh(_refreshToken: string): Promise<{ success: boolean; message?: string; token?: TokenPair }> {
    // 占位：当前逻辑在设置面板中仅复制 refresh_token 并打开帮助页面
    return { success: true, message: '请按帮助页指引完成刷新流程' };
  }

  /**
   * 刷新 access_token
   * POST https://passportapi.115.com/open/refreshToken
   * Headers: Content-Type: application/x-www-form-urlencoded
   * Body: refresh_token=<token>
   */
  async refreshToken(refreshToken: string): Promise<{ success: boolean; message?: string; token?: TokenPair; raw?: any }> {
    try {
      const rt = (refreshToken || '').trim();
      if (!rt) return { success: false, message: '缺少 refresh_token' };

      // 检查 refresh_token 状态
      const settings = await getSettings();
      const drv = (settings?.drive115 || {}) as any;
      const rtStatus = drv.v2RefreshTokenStatus;

      // 如果 refresh_token 已标记为永久失效，直接返回错误
      if (rtStatus === 'invalid' || rtStatus === 'expired') {
        const lastError = drv.v2RefreshTokenLastError || 'refresh_token 已失效';
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: `跳过刷新：${lastError}` });
        return { success: false, message: `${lastError}，请重新授权` };
      }

      await addLogV2({ timestamp: Date.now(), level: 'info', message: '开始刷新 access_token（v2）' });

      // 优先通过后台代理，避免内容脚本 CORS
      let json: any | undefined;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
          const bgResp: any = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: 'drive115.refresh_token_v2',
                  payload: { refreshToken: rt },
                },
                (resp) => resolve(resp)
              );
            } catch {
              resolve(undefined);
            }
          });
          if (bgResp && typeof bgResp.success === 'boolean') {
            if (!bgResp.success) {
              const msg = bgResp.message || '后台刷新失败';
              await addLogV2({ timestamp: Date.now(), level: 'warn', message: `后台刷新失败：${msg}` });

              // 更新 refresh_token 状态
              await this.updateRefreshTokenStatus(bgResp.raw);

              return { success: false, message: msg, raw: bgResp.raw };
            }
            json = bgResp.raw || {};
          }
        }
      } catch {
        // 忽略后台调用错误，回退到前端 fetch
      }

      // 若后台未返回，则回退前端直接请求
      if (!json) {
        const url = `${this.refreshURL}/open/refreshToken`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: new URLSearchParams({ refresh_token: rt }).toString(),
        });

        if (!res.ok) {
          const msg = `刷新 access_token 网络错误: ${res.status} ${res.statusText}`;
          await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
          return { success: false, message: msg };
        }
        json = await res.json().catch(() => ({} as any));
      }

      // 兼容多种返回：{state, code, message, data:{access_token, refresh_token, expires_in}}
      const ok = (typeof json.state === 'boolean') ? json.state : true; // 若无 state 字段，则按照成功处理并通过字段兜底
      const data = json?.data || {};
      const at: string | undefined = data?.access_token || json?.access_token;
      const newRt: string | undefined = data?.refresh_token || json?.refresh_token || rt;
      const expiresIn: number | undefined = Number(data?.expires_in ?? json?.expires_in);

      if (!ok || !at) {
        const msg = describe115Error(json) || json?.message || json?.error || '刷新失败';
        await addLogV2({ timestamp: Date.now(), level: 'error', message: `刷新 access_token 失败：${msg}` });

        // 更新 refresh_token 状态
        await this.updateRefreshTokenStatus(json);

        return { success: false, message: msg, raw: json };
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const token: TokenPair = {
        access_token: at,
        refresh_token: newRt || rt,
        expires_at: expiresIn && !isNaN(expiresIn) ? nowSec + Math.max(0, expiresIn) : null,
      };

      // 立刻持久化：确保任何入口刷新都会保存
      try {
        const currentSettings = await getSettings();
        const newSettings: any = { ...(currentSettings || {}) };
        newSettings.drive115 = { ...(currentSettings as any)?.drive115 };
        newSettings.drive115.v2AccessToken = token.access_token;
        newSettings.drive115.v2RefreshToken = token.refresh_token;
        newSettings.drive115.v2TokenExpiresAt = token.expires_at ?? null;
        newSettings.drive115.v2RefreshTokenIssuedAtSec = nowSec;
        // 刷新成功，标记 refresh_token 为有效
        newSettings.drive115.v2RefreshTokenStatus = 'valid';
        newSettings.drive115.v2RefreshTokenLastError = undefined;
        newSettings.drive115.v2RefreshTokenLastErrorCode = undefined;
        newSettings.drive115.v2AccessTokenStatus = 'valid';
        newSettings.drive115.v2AccessTokenLastError = undefined;
        newSettings.drive115.v2AccessTokenLastErrorCode = undefined;
        // 记录最近刷新时间戳，便于限频逻辑协同
        newSettings.drive115.v2LastTokenRefreshAtSec = nowSec;
        await saveSettings(newSettings);
      } catch {}
      await addLogV2({ timestamp: Date.now(), level: 'info', message: `刷新 access_token 成功并已持久化（expires_in=${expiresIn ?? '未知'}）` });
      return { success: true, token, raw: json };
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '刷新失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `刷新 access_token 异常：${msg}` });
      return { success: false, message: msg };
    }
  }

  private async updateAccessTokenStatus(status: 'valid' | 'expired' | 'rate_limited' | 'unknown', errorResponse?: any): Promise<void> {
    try {
      const settings = await getSettings();
      const newSettings: any = { ...settings };
      newSettings.drive115 = { ...(settings.drive115 || {}) };
      newSettings.drive115.v2AccessTokenStatus = status;
      newSettings.drive115.v2AccessTokenLastError = errorResponse ? (describe115Error(errorResponse) || errorResponse?.message || errorResponse?.error) : undefined;
      const code = Number(errorResponse?.code ?? errorResponse?.errNo ?? errorResponse?.errno ?? NaN);
      newSettings.drive115.v2AccessTokenLastErrorCode = Number.isFinite(code) ? code : undefined;
      await saveSettings(newSettings);
    } catch {}
  }

  /**
   * 更新 refresh_token 状态（根据错误响应）
   */
  private async updateRefreshTokenStatus(errorResponse: any): Promise<void> {
    try {
      const code = Number(errorResponse?.code ?? errorResponse?.errNo ?? errorResponse?.errno ?? NaN);
      if (!Number.isFinite(code)) return;

      const settings = await getSettings();
      const newSettings: any = { ...(settings || {}) };
      newSettings.drive115 = { ...(settings?.drive115 || {}) };

      const { is115RefreshTokenPermanentlyInvalidCode, is115RefreshRateLimitCode } = await import('./errorCodes');

      if (is115RefreshTokenPermanentlyInvalidCode(code)) {
        // refresh_token 永久失效
        newSettings.drive115.v2RefreshTokenStatus = code === 40140119 ? 'expired' : 'invalid';
        newSettings.drive115.v2RefreshTokenLastError = describe115Error(errorResponse) || '需要重新授权';
        newSettings.drive115.v2RefreshTokenLastErrorCode = code;
        await addLogV2({ timestamp: Date.now(), level: 'error', message: `refresh_token 已失效（错误码：${code}），需要重新授权` });
      } else if (is115RefreshRateLimitCode(code)) {
        // 刷新频率限制，不改变状态
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: `刷新频率受限（错误码：${code}），请稍后再试` });
        return; // 不保存状态
      } else {
        // 其他错误，标记为 unknown
        newSettings.drive115.v2RefreshTokenStatus = 'unknown';
        newSettings.drive115.v2RefreshTokenLastError = describe115Error(errorResponse);
        newSettings.drive115.v2RefreshTokenLastErrorCode = code;
      }

      await saveSettings(newSettings);
    } catch (e) {
      // 静默失败，不影响主流程
    }
  }

  /**
   * 获取有效的 access_token。若已过期且允许自动刷新，将使用 refresh_token 刷新并持久化。
   */
  async getValidAccessToken(opts?: { forceAutoRefresh?: boolean }): Promise<{ success: true; accessToken: string } | { success: false; message: string }>{
    const settings = await getSettings();
    const drv = (settings?.drive115 || {}) as any;
    const accessToken: string = (drv.v2AccessToken || '').trim();
    const refreshToken: string = (drv.v2RefreshToken || '').trim();
    const expiresAt: number | null | undefined = drv.v2TokenExpiresAt;
    const rtStatus: string = drv.v2RefreshTokenStatus || 'unknown';
    const autoRefreshSetting: boolean = drv.v2AutoRefresh !== false; // 默认开启
    const autoRefresh: boolean = (opts?.forceAutoRefresh !== undefined) ? !!opts.forceAutoRefresh : autoRefreshSetting;
    const skewSec: number = Math.max(0, Number(drv.v2AutoRefreshSkewSec ?? 60) || 0);
    // 最小刷新间隔（分钟），配置项：v2MinRefreshIntervalMin，范围 60-120；默认 60
    const cfgMinMin: number = Math.min(120, Math.max(60, Number(drv.v2MinRefreshIntervalMin ?? 60) || 60));
    const minIntervalSec: number = cfgMinMin * 60;
    const lastRefreshAtSec: number = Number(drv.v2LastTokenRefreshAtSec || 0) || 0;

    if (!accessToken && !refreshToken) return { success: false, message: '缺少 access_token/refresh_token' };

    const now = Math.floor(Date.now() / 1000);

    // 优化：如果有 access_token 且过期时间未知或未过期，先尝试使用
    if (accessToken) {
      // 情况1：有明确的过期时间且未过期
      if (typeof expiresAt === 'number' && expiresAt - skewSec > now) {
        await addLogV2({ timestamp: Date.now(), level: 'debug', message: 'access_token 仍在有效期内（v2）' });
        return { success: true, accessToken };
      }

      // 情况2：过期时间未知，但 token 存在（可能是手动填入的）
      if (expiresAt === null || expiresAt === undefined) {
        await addLogV2({ timestamp: Date.now(), level: 'debug', message: 'access_token 过期时间未知，尝试直接使用（v2）' });
        // 不直接返回，而是继续检查是否需要刷新
        // 如果不需要自动刷新，就直接使用
        if (!autoRefresh) {
          return { success: true, accessToken };
        }
        // 如果需要自动刷新但没有 refresh_token，也直接使用
        if (!refreshToken) {
          return { success: true, accessToken };
        }
        // 有 refresh_token 且开启自动刷新，继续往下走尝试刷新
      }
    }

    // 检查是否需要刷新
    const needRefresh = !accessToken || (typeof expiresAt === 'number' && expiresAt - skewSec <= now);

    if (!needRefresh) {
      return { success: true, accessToken };
    }

    if (!autoRefresh) {
      const msg = 'access_token 已过期且未开启自动刷新（v2）';
      await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
      return { success: false, message: msg };
    }

    if (!refreshToken) return { success: false, message: '缺少 refresh_token，无法自动刷新' };

    // 检查 refresh_token 状态
    if (rtStatus === 'invalid' || rtStatus === 'expired') {
      const lastError = drv.v2RefreshTokenLastError || 'refresh_token 已失效';
      await addLogV2({ timestamp: Date.now(), level: 'warn', message: `无法自动刷新：${lastError}` });
      return { success: false, message: `${lastError}，请重新授权` };
    }

    // 2小时滑动窗口刷新次数限制（固定最多3次，不可配置），仅限制通过接口的自动刷新
    const nowSec = Math.floor(Date.now() / 1000);
    const maxPer2h: number = 3;
    const histRaw: any[] = Array.isArray(drv.v2TokenRefreshHistorySec) ? drv.v2TokenRefreshHistorySec : [];
    const hist: number[] = histRaw
      .map(v => Number(v))
      .filter(v => Number.isFinite(v) && v > 0 && (nowSec - v) <= 86400); // 仅保留最近1天内的记录，防膨胀
    const twoHoursAgo = nowSec - 7200;
    const count2h = hist.filter(ts => ts >= twoHoursAgo).length;
    if (count2h >= maxPer2h) {
      const msg = `2小时内自动刷新次数已达上限（${maxPer2h} 次），请稍后再试`;
      await addLogV2({ timestamp: Date.now(), level: 'warn', message: `自动刷新被2小时上限限制：${msg}` });
      return { success: false, message: msg };
    }

    // 刷新频率限制：最小间隔
    if (lastRefreshAtSec > 0 && (nowSec - lastRefreshAtSec) < minIntervalSec) {
      const remain = minIntervalSec - (nowSec - lastRefreshAtSec);
      const mins = Math.ceil(remain / 60);
      const msg = `距离上次自动刷新不足最小间隔（${cfgMinMin}分钟），请稍后再试（剩余约 ${mins} 分钟）`;
      await addLogV2({ timestamp: Date.now(), level: 'warn', message: `自动刷新被限频：${msg}` });
      return { success: false, message: msg };
    }

    // 刷新并发保护：若已有刷新在进行，复用同一个 Promise
    let ret: { success: boolean; message?: string; token?: TokenPair; raw?: any };
    if (this.refreshingPromise) {
      await addLogV2({ timestamp: Date.now(), level: 'debug', message: '发现正在进行中的刷新任务，复用 Promise（v2）' });
      ret = await this.refreshingPromise;
    } else {
      await addLogV2({ timestamp: Date.now(), level: 'info', message: 'access_token 已过期，开始自动刷新（v2）' });
      // 重新读取最新的 refresh_token（可能已被其他地方更新）
      const latestSettings = await getSettings();
      const latestRt = ((latestSettings?.drive115 as any)?.v2RefreshToken || '').trim() || refreshToken;

      this.refreshingPromise = this.refreshToken(latestRt);
      try {
        ret = await this.refreshingPromise;
      } finally {
        this.refreshingPromise = null;
      }
    }

    if (!ret.success || !ret.token) {
      const msg = ret.message || '刷新失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `自动刷新 access_token 失败：${msg}` });
      return { success: false, message: msg };
    }

    // 持久化新的 token 与最近刷新时间
    const newAt = ret.token.access_token || '';
    const newRt = ret.token.refresh_token || refreshToken;
    const newExp = typeof ret.token.expires_at === 'number' ? ret.token.expires_at : null;
    const newSettings: any = { ...(settings || {}) };
    newSettings.drive115 = { ...(settings?.drive115 || {}) };
    newSettings.drive115.v2AccessToken = newAt;
    newSettings.drive115.v2RefreshToken = newRt;
    newSettings.drive115.v2TokenExpiresAt = newExp;
    newSettings.drive115.v2LastTokenRefreshAtSec = nowSec;
    newSettings.drive115.v2RefreshTokenIssuedAtSec = nowSec;
    // 保存时进行范围保护（60-120）
    newSettings.drive115.v2MinRefreshIntervalMin = Math.min(120, Math.max(60, Number(newSettings.drive115.v2MinRefreshIntervalMin ?? cfgMinMin) || cfgMinMin));
    // 刷新历史：更新并限制长度（仅保留最近 20 条）
    try {
      const histRaw2: any[] = Array.isArray(newSettings.drive115.v2TokenRefreshHistorySec) ? newSettings.drive115.v2TokenRefreshHistorySec : hist;
      const updated = [...histRaw2, nowSec]
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v > 0 && (nowSec - v) <= 86400);
      newSettings.drive115.v2TokenRefreshHistorySec = updated.slice(-20);
      // 固定上限 3，不再从设置读取
      newSettings.drive115.v2MaxRefreshPer2h = maxPer2h;
    } catch {}
    await saveSettings(newSettings);
    await addLogV2({ timestamp: Date.now(), level: 'info', message: `自动刷新 access_token 成功并已持久化（v2），记录时间戳=${nowSec}，限频=${newSettings.drive115.v2MinRefreshIntervalMin}分钟` });

    return { success: true, accessToken: newAt };
  }

  /**
   * 判断返回是否为 access_token 无效/过期
   */
  private isTokenInvalidResponse(json: any): boolean {
    if (!json || typeof json !== 'object') return false;
    const code = Number(json.code ?? json.errNo ?? json.errno ?? NaN);
    const msgRaw = String(json.message || json.error || '');
    const msg = msgRaw.toLowerCase();
    // 常见 code 组合
    if (
      code === 40140125 || // token 无效
      code === 40140126 || // token 过期/校验失败
      code === 401 ||
      code === 401401 ||
      code === 400401 || // 某些网关返回
      code === 401001 // 未授权/登录信息失效
    ) return true;
    // 关键字匹配（尽量宽松覆盖不同文案）
    if (
      msg.includes('access_token') && (msg.includes('invalid') || msg.includes('无效') || msg.includes('过期') || msgRaw.includes('校验失败'))
      || msg.includes('token invalid')
      || msg.includes('token 无效')
      || msg.includes('token 失效')
      || msg.includes('登录信息失效')
      || msg.includes('unauthorized')
      || msg.includes('未授权')
    ) return true;
    return false;
  }

  /**
   * 获取用户信息（自动处理 access_token 失效：刷新并重试一次）
   */
  async fetchUserInfoAuto(opts?: { forceAutoRefresh?: boolean }): Promise<{ success: boolean; data?: Drive115V2UserInfo; message?: string; raw?: Drive115V2UserInfoResponse }> {
    const settings = await getSettings();
    const drv = (settings?.drive115 || {}) as any;
    const autoRefresh: boolean = (opts?.forceAutoRefresh !== undefined) ? !!opts.forceAutoRefresh : (drv.v2AutoRefresh !== false); // 默认使用设置；可被强制覆盖

    // 优先尝试直接使用现有 access_token（即使没有 expiresAt 也先试用，避免不必要的刷新）
    const atTry = (drv.v2AccessToken || '').trim();
    if (atTry) {
      await addLogV2({ timestamp: Date.now(), level: 'debug', message: '使用现有 access_token 获取用户信息（v2）' });
      const first = await this.fetchUserInfo(atTry);
      if (first.success) return first;

      const tokenInvalid = this.isTokenInvalidResponse((first as any).raw) || /access[_\s-]?token/i.test(String(first.message || ''));
      if (!tokenInvalid) {
        // 与 token 失效无关，直接返回首次结果
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: `获取用户信息失败（非 token 失效）：${first.message || '未知错误'}` });
        return first;
      }

      // 确认 token 失效，再按需刷新
      await addLogV2({ timestamp: Date.now(), level: 'warn', message: '检测到 token 失效，准备自动刷新并重试（v2）' });
      if (!autoRefresh) {
        return { success: false, message: 'access_token 已过期且未开启自动刷新（v2）' } as any;
      }
      const vt2 = await this.getValidAccessToken({ forceAutoRefresh: true });
      if (!vt2.success) return { success: false, message: (vt2 as any).message } as any;
      await addLogV2({ timestamp: Date.now(), level: 'debug', message: '刷新后重试获取用户信息（v2）' });
      return await this.fetchUserInfo(vt2.accessToken);
    }

    // 若没有 access_token，只能按设置执行自动刷新流程以获取一个可用的 token
    const vt = await this.getValidAccessToken({ forceAutoRefresh: autoRefresh });
    if (!vt.success) return { success: false, message: (vt as any).message } as any;
    await addLogV2({ timestamp: Date.now(), level: 'debug', message: '首次无 token，使用 getValidAccessToken 后获取用户信息（v2）' });
    return await this.fetchUserInfo(vt.accessToken);
  }

  /**
   * 获取 115 v2 用户信息
   * 请求：GET {baseURL}/open/user/info
   * Header：Authorization: Bearer <access_token>
   */
  async fetchUserInfo(accessToken: string): Promise<{ success: boolean; data?: Drive115V2UserInfo; message?: string; raw?: Drive115V2UserInfoResponse }> {
    try {
      const token = (accessToken || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' };

      const base = await this.getBaseURL();
      const url = `${base}/open/user/info`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        // 带上凭据通常不需要（token足够），保持默认
      });

      if (!res.ok) {
        const msg = `获取用户信息网络错误: ${res.status} ${res.statusText}`;
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
        await this.updateAccessTokenStatus('unknown', { message: msg, code: res.status });
        return { success: false, message: msg };
      }

      const json: Drive115V2UserInfoResponse = await res.json().catch(() => ({} as any));

      // 常见包裹：{ state, data } 或直接平铺
      const ok = typeof json.state === 'boolean' ? json.state : true; // 若无 state 字段，按成功处理再做兜底校验
      let user: Drive115V2UserInfo | undefined = undefined;
      if (json && typeof json === 'object') {
        if (json.data && typeof json.data === 'object') {
          user = json.data as Drive115V2UserInfo;
        } else {
          // 某些实现可能直接平铺返回，将已知字段映射出来
          const candidate: any = json;
          const keys = ['id','uid','user_id','name','username','nick','email','phone','avatar','avatar_small','avatar_middle','avatar_large','space_total','space_used','space_free','is_vip','vip_level','vip_expire'];
          const picked: any = {};
          let hasAny = false;
          for (const k of keys) {
            if (k in candidate) {
              picked[k] = candidate[k];
              hasAny = true;
            }
          }
          if (hasAny) user = picked as Drive115V2UserInfo;
        }
      }

      if (!ok) {
        const msg = describe115Error(json) || json.error || json.message || `接口返回失败 errNo=${json.errNo ?? ''}`;
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: `获取用户信息失败：${msg}` });
        return { success: false, message: msg, raw: json };
      }
      if (!user || Object.keys(user).length === 0) {
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: '获取用户信息成功但数据为空' });
        return { success: false, message: '未获取到用户数据', raw: json };
      }
      await addLogV2({ timestamp: Date.now(), level: 'info', message: `获取用户信息成功（v2）：${this.getUserDisplayName(user)}` });
      return { success: true, data: user, raw: json };
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '获取用户信息失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `获取用户信息异常：${msg}` });
      return { success: false, message: msg };
    }
  }

  /**
   * 文件搜索（v2）
   * GET {baseURL}/open/ufile/search
   * Header: Authorization: Bearer <access_token>
   * Query: search_value, limit, offset, file_label?, cid?, gte_day?, lte_day?, fc?, type?, suffix?
   */
  async searchFiles(params: { accessToken: string } & Drive115V2SearchQuery): Promise<
    { success: boolean; message?: string; raw?: Drive115V2SearchResponse } &
    { count?: number; data?: Drive115V2SearchItem[]; limit?: number; offset?: number }
  > {
    try {
      const token = (params.accessToken || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' } as any;

      const base = await this.getBaseURL();
      const url = `${base}/open/ufile/search`;

      const qs = new URLSearchParams();
      qs.set('search_value', String(params.search_value ?? ''));
      qs.set('limit', String(params.limit ?? 20));
      qs.set('offset', String(params.offset ?? 0));
      if (params.file_label) qs.set('file_label', String(params.file_label));
      if (params.cid !== undefined && params.cid !== null && String(params.cid).length > 0) qs.set('cid', String(params.cid));
      if (params.gte_day) qs.set('gte_day', String(params.gte_day));
      if (params.lte_day) qs.set('lte_day', String(params.lte_day));
      if (params.fc) qs.set('fc', String(params.fc));
      if (params.type) qs.set('type', String(params.type));
      if (params.suffix) qs.set('suffix', String(params.suffix));

      await addLogV2({ timestamp: Date.now(), level: 'debug', message: `开始搜索（v2）：q="${String(params.search_value ?? '').slice(0, 50)}"` });
      const res = await fetch(`${url}?${qs.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        const msg = `搜索网络错误: ${res.status} ${res.statusText}`;
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
        return { success: false, message: msg } as any;
      }

      const json: Drive115V2SearchResponse = await res.json().catch(() => ({} as any));
      const ok = typeof json.state === 'boolean' ? json.state : true;
      if (!ok) {
        const msg = describe115Error(json) || json.message || '搜索失败';
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: `搜索失败：${msg}` });
        return { success: false, message: msg, raw: json } as any;
      }
      const data = Array.isArray(json?.data) ? json.data as Drive115V2SearchItem[] : undefined;
      await addLogV2({ timestamp: Date.now(), level: 'info', message: `搜索成功（v2）：返回 ${Array.isArray(data) ? data.length : 0} 条` });
      return {
        success: true,
        count: typeof json.count === 'number' ? json.count : undefined,
        data,
        limit: typeof json.limit === 'number' ? json.limit : undefined,
        offset: typeof json.offset === 'number' ? json.offset : undefined,
        raw: json,
      } as any;
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '搜索失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `搜索异常：${msg}` });
      return { success: false, message: msg } as any;
    }
  }

  /**
   * 文件列表（v2）
   * GET {baseURL}/open/ufile/files
   * Header: Authorization: Bearer <access_token>
   */
  async listFiles(params: {
    accessToken: string;
    cid?: string | number;
    limit?: number;
    offset?: number;
    show_dir?: 0 | 1;
    stdir?: 0 | 1;
    cur?: 0 | 1;
    o?: string;
    asc?: 0 | 1;
    signal?: AbortSignal;
    /** Background callers can skip the runtime proxy so AbortSignal can cancel the fetch directly. */
    skipBackgroundProxy?: boolean;
  }): Promise<
    { success: boolean; message?: string; raw?: Drive115V2FileListResponse } &
    { count?: number; data?: Drive115V2FileListItem[]; path?: Drive115V2PathItem[]; limit?: number; offset?: number; cid?: string | number }
  > {
    try {
      const token = (params.accessToken || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' } as any;

      const base = await this.getBaseURL();
      const url = `${base}/open/ufile/files`;
      const qs = new URLSearchParams();
      const cid = String(params.cid ?? '').trim();
      if (cid && cid !== '0') qs.set('cid', cid);
      qs.set('limit', String(Math.min(1150, Math.max(1, Number(params.limit ?? 1150) || 1150))));
      qs.set('offset', String(Math.max(0, Number(params.offset ?? 0) || 0)));
      qs.set('show_dir', String(params.show_dir ?? 1));
      qs.set('stdir', String(params.stdir ?? 1));
      qs.set('cur', String(params.cur ?? 1));
      qs.set('o', params.o || 'file_name');
      qs.set('asc', String(params.asc ?? 1));

      await addLogV2({ timestamp: Date.now(), level: 'debug', message: `开始获取文件列表（v2）：cid=${cid || 'root'}` });
      let json: Drive115V2FileListResponse | undefined;
      try {
        if (!params.skipBackgroundProxy && typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
          const bgResp: any = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: 'drive115.list_files_v2',
                  payload: {
                    accessToken: token,
                    baseUrl: base,
                    query: Object.fromEntries(qs.entries()),
                  },
                },
                (resp) => resolve(resp)
              );
            } catch { resolve(undefined); }
          });
          if (bgResp && typeof bgResp.success === 'boolean') {
            if (!bgResp.success) {
              const msg = bgResp.message || '后台文件列表请求失败';
              await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
              return { success: false, message: msg, raw: bgResp.raw } as any;
            }
            json = (bgResp.raw || {}) as Drive115V2FileListResponse;
          }
        }
      } catch {}

      if (!json) {
        const res = await fetch(`${url}?${qs.toString()}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          },
          signal: params.signal,
        });

        if (!res.ok) {
          const msg = `文件列表网络错误: ${res.status} ${res.statusText}`;
          await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
          return { success: false, message: msg } as any;
        }

        json = await res.json().catch(() => ({} as Drive115V2FileListResponse));
      }

      const fileList = json || ({} as Drive115V2FileListResponse);
      const ok = typeof fileList.state === 'boolean' ? fileList.state : true;
      if (!ok) {
        const msg = describe115Error(fileList) || fileList.message || '获取文件列表失败';
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: `获取文件列表失败：${msg}` });
        return { success: false, message: msg, raw: fileList } as any;
      }

      return {
        success: true,
        count: typeof fileList.count === 'number' ? fileList.count : undefined,
        data: Array.isArray(fileList.data) ? fileList.data : [],
        path: Array.isArray(fileList.path) ? fileList.path : [],
        limit: typeof fileList.limit === 'number' ? fileList.limit : undefined,
        offset: typeof fileList.offset === 'number' ? fileList.offset : undefined,
        cid: fileList.cid,
        raw: fileList,
      } as any;
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '获取文件列表失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `获取文件列表异常：${msg}` });
      return { success: false, message: msg } as any;
    }
  }

  /**
   * 获取云下载任务列表（v2）
   * GET {baseURL}/open/offline/get_task_list
   * Header: Authorization: Bearer <access_token>
   */
  async getTaskList(params: {
    accessToken: string;
    page?: number; // 页码，默认1
  }): Promise<{ success: boolean; message?: string; raw?: Drive115V2TaskListResponse } & { data?: Drive115V2TaskListData }> {
    try {
      const token = (params.accessToken || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' } as any;

      const base = await this.getBaseURL();
      const page = params.page || 1;
      const url = `${base}/open/offline/get_task_list?page=${page}`;
      await addLogV2({ timestamp: Date.now(), level: 'debug', message: `开始获取云下载任务列表（v2），页码：${page}` });

      // 优先通过后台代理
      let json: Drive115V2TaskListResponse | undefined;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
          const bgResp: any = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                { type: 'drive115.get_task_list_v2', payload: { accessToken: token, page, baseUrl: base } },
                (resp) => resolve(resp)
              );
            } catch { resolve(undefined); }
          });
          if (bgResp && typeof bgResp.success === 'boolean') {
            if (!bgResp.success) {
              await addLogV2({ timestamp: Date.now(), level: 'warn', message: `后台任务列表请求失败：${bgResp.message || '未知'}` });
            } else {
              json = (bgResp.raw || {}) as Drive115V2TaskListResponse;
            }
          }
        }
      } catch {}

      // 回退：直接在前端发起 fetch
      if (!json) {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });

        if (!res.ok) {
          const msg = `获取任务列表网络错误: ${res.status} ${res.statusText}`;
          await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
          return { success: false, message: msg };
        }

        json = await res.json().catch(() => ({} as Drive115V2TaskListResponse));
      }

      const ok = typeof json?.state === 'boolean' ? json.state : true;
      if (!ok) {
        const msg = describe115Error(json) || json?.message || json?.error || '获取任务列表失败';
        await addLogV2({ timestamp: Date.now(), level: 'error', message: `获取任务列表失败：${msg}` });
        return { success: false, message: msg, raw: json };
      }

      const data = json?.data || {};
      const taskCount = data.tasks?.length || 0;
      await addLogV2({ timestamp: Date.now(), level: 'info', message: `获取任务列表成功（v2）：第${page}页，共${taskCount}个任务` });
      return { success: true, data, raw: json };
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '获取任务列表失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `获取任务列表异常：${msg}` });
      return { success: false, message: msg };
    }
  }

  /**
   * 删除云下载任务（v2）
   * POST {baseURL}/open/offline/del_task
   * Header: Authorization: Bearer <access_token>
   * Body: info_hash=xxx&del_source_file=0
   */
  async deleteTask(params: {
    accessToken: string;
    info_hash: string;
    del_source_file?: number; // 是否删除源文件：1删除；0不删除，默认0
  }): Promise<{ success: boolean; message?: string; raw?: any }> {
    try {
      const token = (params.accessToken || '').trim();
      const hash = (params.info_hash || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' };
      if (!hash) return { success: false, message: '缺少 info_hash' };

      const base = await this.getBaseURL();
      const url = `${base}/open/offline/del_task`;
      await addLogV2({ timestamp: Date.now(), level: 'debug', message: `开始删除云下载任务（v2）：${hash}` });

      // 优先通过后台代理
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
          const bgResp: any = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: 'drive115.del_task_v2',
                  payload: {
                    accessToken: token,
                    info_hash: hash,
                    del_source_file: params.del_source_file || 0,
                    baseUrl: base,
                  },
                },
                (resp) => resolve(resp)
              );
            } catch { resolve(undefined); }
          });
          if (bgResp && typeof bgResp.success === 'boolean') {
            return {
              success: !!bgResp.success,
              message: bgResp.message,
              raw: bgResp.raw,
            };
          }
        }
      } catch {}

      // 回退：直接在前端发起 fetch
      const fd = new FormData();
      fd.set('info_hash', hash);
      fd.set('del_source_file', String(params.del_source_file || 0));

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        body: fd,
      });

      if (!res.ok) {
        const msg = `删除任务网络错误: ${res.status} ${res.statusText}`;
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
        return { success: false, message: msg };
      }

      const json: any = await res.json().catch(() => ({} as any));
      const ok = typeof json.state === 'boolean' ? json.state : true;
      if (!ok) {
        const msg = describe115Error(json) || json.message || json.error || '删除任务失败';
        await addLogV2({ timestamp: Date.now(), level: 'error', message: `删除任务失败：${msg}` });
        return { success: false, message: msg, raw: json };
      }

      await addLogV2({ timestamp: Date.now(), level: 'info', message: `删除任务成功（v2）：${hash}` });
      return { success: true, raw: json };
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '删除任务失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `删除任务异常：${msg}` });
      return { success: false, message: msg };
    }
  }

  /**
   * 清空云下载任务（v2）
   * POST {baseURL}/open/offline/clear_task
   * Header: Authorization: Bearer <access_token>
   * Body: flag=1
   */
  async clearTasks(params: {
    accessToken: string;
    flag?: number; // 清除类型：0已完成、1全部、2失败、3进行中、4已完成+源文件、5全部+源文件，默认1
  }): Promise<{ success: boolean; message?: string; raw?: any }> {
    try {
      const token = (params.accessToken || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' };

      const base = await this.getBaseURL();
      const url = `${base}/open/offline/clear_task`;
      const flag = params.flag ?? 1;
      await addLogV2({ timestamp: Date.now(), level: 'debug', message: `开始清空云下载任务（v2），类型：${flag}` });

      // 优先通过后台代理
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
          const bgResp: any = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: 'drive115.clear_task_v2',
                  payload: {
                    accessToken: token,
                    flag,
                    baseUrl: base,
                  },
                },
                (resp) => resolve(resp)
              );
            } catch { resolve(undefined); }
          });
          if (bgResp && typeof bgResp.success === 'boolean') {
            return {
              success: !!bgResp.success,
              message: bgResp.message,
              raw: bgResp.raw,
            };
          }
        }
      } catch {}

      // 回退：直接在前端发起 fetch
      const fd = new FormData();
      fd.set('flag', String(flag));

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        body: fd,
      });

      if (!res.ok) {
        const msg = `清空任务网络错误: ${res.status} ${res.statusText}`;
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
        return { success: false, message: msg };
      }

      const json: any = await res.json().catch(() => ({} as any));
      const ok = typeof json.state === 'boolean' ? json.state : true;
      if (!ok) {
        const msg = describe115Error(json) || json.message || json.error || '清空任务失败';
        await addLogV2({ timestamp: Date.now(), level: 'error', message: `清空任务失败：${msg}` });
        return { success: false, message: msg, raw: json };
      }

      await addLogV2({ timestamp: Date.now(), level: 'info', message: `清空任务成功（v2），类型：${flag}` });
      return { success: true, raw: json };
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '清空任务失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `清空任务异常：${msg}` });
      return { success: false, message: msg };
    }
  }

  /**
   * 返回：{ state?: boolean, message?: string, code?: number, data?: any[] }
   */
  async addTaskUrls(params: {
    accessToken: string;
    urls: string; // 多个URL以\n分隔
    wp_path_id?: string; // 目标目录，缺省为根目录
  }): Promise<{ success: boolean; message?: string; raw?: any } & { data?: any[] }> {
    try {
      const token = (params.accessToken || '').trim();
      if (!token) return { success: false, message: '缺少 access_token' };

      const base = await this.getBaseURL();
      const url = `${base}/open/offline/add_task_urls`;
      const context = (params as any)?.context || {};
      const taskId = String(context.taskId || '').trim();
      const correlationId = String(context.correlationId || '').trim();

      // 优先走后台代理，避免内容脚本在 javdb.com 环境的 CORS 限制
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
          const messageStartedAt = Date.now();
          await addLogV2({ timestamp: messageStartedAt, level: 'info', message: `115推送阶段：bg-message:start taskId=${taskId || '-'} correlationId=${correlationId || '-'} 目录=${params.wp_path_id ?? '未指定（根）'}` });
          const slowWarnMs = 10000;
          const slowWarnTimer = setTimeout(() => {
            void addLogV2({ timestamp: Date.now(), level: 'warn', message: `115推送阶段：bg-message:slow taskId=${taskId || '-'} correlationId=${correlationId || '-'} 已等待 ${Date.now() - messageStartedAt}ms` });
          }, slowWarnMs);
          const bgResp: any = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: 'drive115.add_task_urls_v2',
                  payload: {
                    accessToken: token,
                    urls: params.urls,
                    wp_path_id: params.wp_path_id,
                    baseUrl: base,
                    taskId,
                    correlationId,
                  },
                },
                (resp) => {
                  clearTimeout(slowWarnTimer);
                  void addLogV2({ timestamp: Date.now(), level: 'info', message: `115推送阶段：bg-message:end taskId=${taskId || '-'} correlationId=${correlationId || '-'} durationMs=${Date.now() - messageStartedAt}` });
                  resolve(resp);
                }
              );
            } catch {
              clearTimeout(slowWarnTimer);
              resolve(undefined);
            }
          });
          if (bgResp && typeof bgResp.success === 'boolean') {
            // 与原函数返回结构对齐
            return {
              success: !!bgResp.success,
              message: bgResp.message,
              raw: bgResp.raw,
              data: bgResp.data,
            } as any;
          }
        }
      } catch {
        // 忽略，继续走前台 fetch 回退
      }

      // 改为 multipart/form-data（FormData），便于携带 wp_path_id 且与官方接口一致
      const fd = new FormData();
      fd.set('urls', params.urls);
      // 当外部提供 wp_path_id（即使为 '0'）时，始终携带
      if (params.wp_path_id !== undefined) {
        fd.set('wp_path_id', String(params.wp_path_id));
      }

      const count = String(params.urls || '').split('\n').filter(s => s.trim()).length;
      await addLogV2({ timestamp: Date.now(), level: 'info', message: `开始添加离线任务（v2）：${count} 项，目录=${params.wp_path_id ?? '未指定（根）'}` });
      const fetchStartedAt = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          // 不手动设置 Content-Type，交由浏览器注入含 boundary 的 multipart/form-data
          'Accept': 'application/json'
        },
        body: fd,
      });

      if (!res.ok) {
        const msg = `添加离线任务网络错误: ${res.status} ${res.statusText}`;
        await addLogV2({ timestamp: Date.now(), level: 'warn', message: msg });
        return { success: false, message: msg };
      }

      const json: any = await res.json().catch(() => ({} as any));
      const ok = typeof json.state === 'boolean' ? json.state : true;
      if (!ok) {
        const msg = describe115Error(json) || json.message || json.error || '添加任务失败';
        await addLogV2({ timestamp: Date.now(), level: 'error', message: `添加离线任务失败：${msg}` });
        return { success: false, message: msg, raw: json };
      }
      const data: any[] | undefined = Array.isArray(json?.data) ? json.data : undefined;
      await addLogV2({ timestamp: Date.now(), level: 'info', message: `115推送阶段：direct-fetch:end taskId=${taskId || '-'} correlationId=${correlationId || '-'} durationMs=${Date.now() - fetchStartedAt}` });
      await addLogV2({ timestamp: Date.now(), level: 'info', message: `添加离线任务成功（v2）：返回 ${Array.isArray(data) ? data.length : 0} 项` });
      return { success: true, data, raw: json };
    } catch (e: any) {
      const msg = describe115Error(e) || e?.message || '添加任务失败';
      await addLogV2({ timestamp: Date.now(), level: 'error', message: `添加离线任务异常：${msg}` });
      return { success: false, message: msg };
    }
  }

  /**
   * 删除网盘文件（尝试 open API；成功则进回收站/删除）
   * 依次尝试常见路径：/open/rb/delete、/open/ufile/delete
   */
  async deleteFiles(params: {
    accessToken: string;
    fileIds: string[];
  }): Promise<{ success: boolean; message?: string; raw?: any; endpoint?: string }> {
    const token = (params.accessToken || '').trim();
    const ids = (params.fileIds || []).map((id) => String(id || '').trim()).filter(Boolean);
    if (!token) return { success: false, message: '缺少 access_token' };
    if (!ids.length) return { success: false, message: '缺少 file_id' };

    const base = await this.getBaseURL();
    const endpoints = [`${base}/open/rb/delete`, `${base}/open/ufile/delete`];

    // 后台代理优先（避免 CORS）
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
        const bgResp: any = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              {
                type: 'drive115.delete_files_v2',
                payload: { accessToken: token, fileIds: ids, baseUrl: base },
              },
              (resp) => resolve(resp),
            );
          } catch {
            resolve(undefined);
          }
        });
        if (bgResp && typeof bgResp.success === 'boolean') {
          return {
            success: !!bgResp.success,
            message: bgResp.message,
            raw: bgResp.raw,
            endpoint: bgResp.endpoint,
          };
        }
      }
    } catch { /* fall through */ }

    let lastMsg = '删除失败';
    for (const url of endpoints) {
      try {
        const fd = new FormData();
        // 常见字段名：file_id / file_ids
        fd.set('file_id', ids.join(','));
        fd.set('file_ids', ids.join(','));

        await addLogV2({ timestamp: Date.now(), level: 'debug', message: `尝试删除文件：${url}` });
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          body: fd,
        });
        const json: any = await res.json().catch(() => ({} as any));
        const ok = typeof json.state === 'boolean' ? json.state : res.ok;
        if (ok && res.ok) {
          await addLogV2({ timestamp: Date.now(), level: 'info', message: `删除文件成功：${ids.join(',')}` });
          return { success: true, raw: json, endpoint: url };
        }
        lastMsg = describe115Error(json) || json.message || json.error || `删除失败 (${res.status})`;
      } catch (e: any) {
        lastMsg = describe115Error(e) || e?.message || '删除请求异常';
      }
    }
    await addLogV2({ timestamp: Date.now(), level: 'warn', message: `删除文件失败：${lastMsg}` });
    return { success: false, message: lastMsg };
  }

  /**
   * 获取视频播放地址（尝试 open API）
   * 常见：/open/video/play?pick_code=
   */
  async getVideoPlayInfo(params: {
    accessToken: string;
    pickCode: string;
  }): Promise<{
    success: boolean;
    message?: string;
    streamUrl?: string;
    raw?: any;
    endpoint?: string;
  }> {
    const token = (params.accessToken || '').trim();
    const pickCode = String(params.pickCode || '').trim();
    if (!token) return { success: false, message: '缺少 access_token' };
    if (!pickCode) return { success: false, message: '缺少 pick_code' };

    const base = await this.getBaseURL();

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function') {
        const bgResp: any = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(
              {
                type: 'drive115.video_play_v2',
                payload: { accessToken: token, pickCode, baseUrl: base },
              },
              (resp) => resolve(resp),
            );
          } catch {
            resolve(undefined);
          }
        });
        if (bgResp && typeof bgResp.success === 'boolean') {
          return {
            success: !!bgResp.success,
            message: bgResp.message,
            streamUrl: bgResp.streamUrl,
            raw: bgResp.raw,
            endpoint: bgResp.endpoint,
          };
        }
      }
    } catch { /* fall through */ }

    const endpoints = [
      `${base}/open/video/play?pick_code=${encodeURIComponent(pickCode)}`,
      `${base}/open/video/play?pickcode=${encodeURIComponent(pickCode)}`,
      `${base}/open/ufile/downurl?pick_code=${encodeURIComponent(pickCode)}`,
    ];

    let lastMsg = '获取播放地址失败';
    for (const url of endpoints) {
      try {
        await addLogV2({ timestamp: Date.now(), level: 'debug', message: `尝试取流：${url.split('?')[0]}` });
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        const json: any = await res.json().catch(() => ({} as any));
        const ok = typeof json.state === 'boolean' ? json.state : res.ok;
        if (!ok || !res.ok) {
          lastMsg = describe115Error(json) || json.message || json.error || `取流失败 (${res.status})`;
          continue;
        }
        const streamUrl = extractStreamUrlFromPlayResponse(json);
        if (streamUrl) {
          await addLogV2({ timestamp: Date.now(), level: 'info', message: '获取播放地址成功' });
          return { success: true, streamUrl, raw: json, endpoint: url };
        }
        lastMsg = '响应中无可用播放地址';
      } catch (e: any) {
        lastMsg = describe115Error(e) || e?.message || '取流请求异常';
      }
    }
    return { success: false, message: lastMsg };
  }

  /**
   * 按 pick_code 获取任意文件的下载直链（用于下载 NFO 正文等非视频文件）。
   * 与 getVideoPlayInfo 区别：不假设是视频取流，直接走 downurl 端点取下载 URL。
   */
  async getFileDownloadUrl(params: {
    accessToken: string;
    pickCode: string;
  }): Promise<{ success: boolean; url?: string; message?: string; raw?: any }> {
    const token = (params.accessToken || '').trim();
    const pickCode = String(params.pickCode || '').trim();
    if (!token) return { success: false, message: '缺少 access_token' };
    if (!pickCode) return { success: false, message: '缺少 pick_code' };

    const base = await this.getBaseURL();
    const url = `${base}/open/ufile/downurl?pick_code=${encodeURIComponent(pickCode)}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      const json: any = await res.json().catch(() => ({} as any));
      const ok = typeof json.state === 'boolean' ? json.state : res.ok;
      if (!ok || !res.ok) {
        return {
          success: false,
          message: describe115Error(json) || json.message || json.error || `获取下载地址失败 (${res.status})`,
          raw: json,
        };
      }
      const downloadUrl = extractStreamUrlFromPlayResponse(json);
      if (!downloadUrl) return { success: false, message: '响应中无可用下载地址', raw: json };
      return { success: true, url: downloadUrl, raw: json };
    } catch (e: any) {
      return { success: false, message: describe115Error(e) || e?.message || '获取下载地址异常' };
    }
  }
}

/**
 * 从 115 播放/下载接口响应中尽量提取可播 URL
 */
export function extractStreamUrlFromPlayResponse(json: any): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const data = json.data ?? json.result ?? json;
  if (typeof data === 'string' && /^https?:\/\//i.test(data)) return data;
  if (!data || typeof data !== 'object') return undefined;

  const directKeys = ['url', 'video_url', 'down_url', 'download_url', 'src', 'play_url', 'm3u8'];
  for (const k of directKeys) {
    const v = (data as any)[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }

  // video_url 可能是对象 { "1": "https..." } 或数组
  const vu = (data as any).video_url || (data as any).video_urls;
  if (vu && typeof vu === 'object') {
    if (Array.isArray(vu)) {
      for (const item of vu) {
        if (typeof item === 'string' && /^https?:\/\//i.test(item)) return item;
        if (item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) return item.url;
      }
    } else {
      const vals = Object.values(vu);
      for (const v of vals) {
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
      }
    }
  }

  return undefined;
}

export function getDrive115V2Service(): Drive115V2Service {
  return Drive115V2Service.getInstance();
}
