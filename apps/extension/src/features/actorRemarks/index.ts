/**
 * @file index.ts
 * @description 演员备注（Wiki/xslist 数据获取与展示）统一导出
 * @module features/actorRemarks
 */
// src/features/actorRemarks/index.ts
// 演员备注（年龄/身高/罩杯/引退/外链）聚合服务

import { defaultHttpClient } from '../../platform/network/httpClient';
import { getValue, setValue } from '../../utils/storage';
import type { ExtensionSettings } from '../../types';

export type ActorRemarksSource = 'wikipedia' | 'xslist';
export interface ActorRemarks {
  name: string;
  age?: number;
  heightCm?: number;
  cup?: string;
  retired?: boolean;
  ig?: string;
  tw?: string;
  wikiUrl?: string;
  xslistUrl?: string;
  source: ActorRemarksSource;
  fetchedAt: number;
}

export interface ActorRemarksFailure {
  source: ActorRemarksSource;
  message: string;
  statusCode?: number;
  url?: string;
  reason?: 'cloudflare_challenge';
}

export interface ActorRemarksDiagnostics {
  data: ActorRemarks | null;
  failures: ActorRemarksFailure[];
}

interface ActorRemarksFetchResult {
  data: ActorRemarks | null;
  failure?: ActorRemarksFailure;
}

interface CacheEntry {
  data: ActorRemarks;
  ts: number;
}

const CACHE_KEY = 'actor_remarks_cache';
const REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const REQUEST_IN_FLIGHT_TTL_MS = 15_000;

function normalizeName(name: string): string {
  try {
    let n = (name || '').trim();
    if (!n) return n;
    // 处理常见括号/方括号及“無碼/无码”等后缀
    n = n.replace(/（.*?）/g, '')
         .replace(/\(.*?\)/g, '')
         .replace(/\[.*?\]/g, '')
         .replace(/\s*無碼\s*|\s*无码\s*/g, '')
         .replace(/\s+/g, ' ')
         .trim();
    // 逗号分隔时，取更可能的艺名
    if (n.includes(',')) {
      const parts = n.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) n = parts[1];
    }
    // 特例：三上悠亞 => 三上悠亜
    if (n === '三上悠亞') n = '三上悠亜';
    return n;
  } catch { return name; }
}

async function getCache(): Promise<Record<string, CacheEntry>> {
  try { return await getValue<Record<string, CacheEntry>>(CACHE_KEY, {}); } catch { return {}; }
}
async function setCache(obj: Record<string, CacheEntry>): Promise<void> {
  try { await setValue(CACHE_KEY, obj); } catch {}
}

async function getFromCache(name: string, ttlDays: number): Promise<ActorRemarks | null> {
  try {
    const cache = await getCache();
    const key = name;
    const hit = cache[key];
    if (!hit) return null;
    if (ttlDays <= 0) return null; // 以原脚本为准：默认不使用缓存
    const now = Date.now();
    if (now - hit.ts > ttlDays * 86400000) return null;
    return hit.data;
  } catch { return null; }
}

async function putToCache(name: string, data: ActorRemarks): Promise<void> {
  try {
    const cache = await getCache();
    cache[name] = { data, ts: Date.now() };
    await setCache(cache);
  } catch {}
}

function buildFailure(source: ActorRemarksSource, error: any): ActorRemarksFailure {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : undefined;
  const url = typeof error?.url === 'string' ? error.url : undefined;
  return {
    source,
    message,
    statusCode,
    url,
    ...(source === 'xslist' && statusCode === 403 ? { reason: 'cloudflare_challenge' as const } : {}),
  };
}

async function fetchWikipedia(name: string, opts: { timeoutMs: number } = { timeoutMs: 6500 }): Promise<ActorRemarksFetchResult> {
  const startTime = Date.now();
  try {
    const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(name)}`;
    console.log(`[actorRemarks] 开始请求 Wikipedia: ${name}`);
    // retries:0 —— 避免默认 3 次重试+指数退放把任务整体预算吃光（挂起场景下 4 次 6.5s 尝试 ≈ 33s）
    const doc = await defaultHttpClient.getDocument(url, { responseType: 'document', timeout: Math.max(200, opts.timeoutMs), retries: 0 });
    const info = (doc.querySelector('.infobox') || doc.querySelector('table.infobox')) as HTMLElement | null;
    if (!info) return { data: null };

    let age: number | undefined;
    let heightCm: number | undefined;
    let cup: string | undefined;
    let retired: boolean | undefined;
    let ig: string | undefined;
    let tw: string | undefined;

    const calcAgeFromDate = (y: number, m?: number, d?: number): number | undefined => {
      if (!y || y < 1900) return undefined;
      const now = new Date();
      let a = now.getFullYear() - y;
      if (typeof m === 'number' && typeof d === 'number') {
        const birthdayThisYear = new Date(now.getFullYear(), m - 1, d);
        if (now < birthdayThisYear) a -= 1;
      }
      return a >= 0 && a <= 120 ? a : undefined;
    };

    const rows = Array.from(info.querySelectorAll('tr')) as HTMLTableRowElement[];
    for (const tr of rows) {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (!td) continue;
      const key = (th?.textContent || '').trim();
      const text = (td.textContent || '').trim();
      const html = td.innerHTML || '';

      if (!age && /(生年月日|生誕)/.test(key)) {
        const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
        if (m && m[1]) {
          age = calcAgeFromDate(Number(m[1]), m[2] ? Number(m[2]) : undefined, m[3] ? Number(m[3]) : undefined);
        } else {
          const y = text.match(/(\d{4})\s*年/);
          if (y && y[1]) age = calcAgeFromDate(Number(y[1]));
        }
      }

      if (!heightCm && /(身長|身高)/.test(key)) {
        const m = text.match(/(\d{2,3})\s*cm/i);
        const v = m && m[1] ? Number(m[1]) : undefined;
        if (v && v >= 120 && v <= 200) heightCm = v;
      }

      if (!cup && /(ブラサイズ|カップ|バスト)/.test(key)) {
        const m = text.match(/[A-ZＡ-Ｚ]/i);
        if (m && m[0]) cup = m[0].toUpperCase();
      }

      if (!heightCm && /cm/.test(html)) {
        if (!/kg/.test(html) || /cm\s*\//.test(html)) {
          const m = text.match(/(\d{2,3})\s*cm/);
          const v = m && m[1] ? Number(m[1]) : undefined;
          if (v && v >= 120 && v <= 200) heightCm = v;
        }
      }
    }

    // 简易识别“引退”关键字（保守）
    const ps = Array.from(doc.querySelectorAll('p')) as HTMLParagraphElement[];
    retired = ps.some(p => /引退/.test(p.textContent || '')) || undefined;

    // 取社媒链接（若存在）
    const as = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    for (const a of as) {
      const href = a.getAttribute('href') || '';
      if (/instagram\.com\//i.test(href)) ig = href.startsWith('http') ? href : `https:${href}`;
      if (/(twitter|x\.com)\//i.test(href)) tw = href.startsWith('http') ? href : `https:${href}`;
    }

    const data: ActorRemarks = {
      name,
      age,
      heightCm,
      cup,
      retired,
      ig,
      tw,
      wikiUrl: url,
      source: 'wikipedia',
      fetchedAt: Date.now(),
    };
    console.log(`[actorRemarks] Wikipedia 成功: ${name}, 耗时: ${Date.now() - startTime}ms`);
    return { data };
  } catch (err) {
    console.log(`[actorRemarks] Wikipedia 失败: ${name}, 耗时: ${Date.now() - startTime}ms, 错误:`, err);
    return { data: null, failure: buildFailure('wikipedia', err) };
  }
}

async function fetchXslist(name: string, opts: { searchTimeoutMs: number; detailTimeoutMs: number } = { searchTimeoutMs: 5000, detailTimeoutMs: 5000 }): Promise<ActorRemarksFetchResult> {
  const startTime = Date.now();
  try {
    const searchUrl = `https://xslist.org/search?query=${encodeURIComponent(name)}&lg=zh`;
    console.log(`[actorRemarks] 开始请求 xslist 搜索: ${name}`);
    const searchDoc = await defaultHttpClient.getDocument(searchUrl, {
      responseType: 'document',
      timeout: Math.max(200, opts.searchTimeoutMs),
      retries: 0,
      referrer: 'https://xslist.org/',
    });
    const links = Array.from(searchDoc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    let targetUrl = '';

    const n1 = normalizeName(name).replace(/\s+/g, '');

    for (const a of links) {
      const text = (a.textContent || '').trim();
      const t1 = normalizeName(text).replace(/\s+/g, '');
      if (t1 && n1 && (t1 === n1 || t1.includes(n1) || n1.includes(t1))) {
        targetUrl = a.href;
        break;
      }
    }

    // 兜底：若文本匹配失败，尝试挑选 xslist 站内最可能的“人物详情页”链接
    if (!targetUrl) {
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (!href) continue;
        if (/^\//.test(href) && /(person|actress|actor)/i.test(href)) {
          targetUrl = a.href;
          break;
        }
        if (/xslist\.org\//i.test(href) && /(person|actress|actor)/i.test(href)) {
          targetUrl = a.href;
          break;
        }
      }
    }
    if (!targetUrl) {
      console.log(`[actorRemarks] xslist 未找到目标链接: ${name}, 耗时: ${Date.now() - startTime}ms`);
      return { data: null };
    }
    console.log(`[actorRemarks] 开始请求 xslist 详情: ${name}`);
    const doc = await defaultHttpClient.getDocument(targetUrl, {
      responseType: 'document',
      timeout: Math.max(200, opts.detailTimeoutMs),
      retries: 0,
      referrer: 'https://xslist.org/',
    });
    // 取首段或第二段（避开“别名”）
    let p = doc.querySelector('p');
    const ps = Array.from(doc.querySelectorAll('p')) as HTMLParagraphElement[];
    if (ps.length >= 2 && /别名/.test(ps[0].innerText)) p = ps[1];
    const text = (p?.innerText || '').trim();
    if (!text) return { data: null };

    const nowYear = new Date().getFullYear();
    let age: number | undefined;
    let heightCm: number | undefined;
    let cup: string | undefined;

    const dob = text.match(/出生\s*:\s*(\d{4})年/);
    if (dob && dob[1]) {
      const y = Number(dob[1]);
      if (y > 1900 && y <= nowYear) age = nowYear - y;
    }
    const hm = text.match(/身高\s*:\s*(\d{2,3})\s*cm/i);
    if (hm && hm[1]) {
      const v = Number(hm[1]);
      if (v >= 120 && v <= 200) heightCm = v;
    }
    const cm = text.match(/罩杯\s*:\s*([A-Z])\s*Cup/i);
    if (cm && cm[1]) cup = cm[1].toUpperCase();

    if (typeof age === 'number' || typeof heightCm === 'number') {
      const result = {
        name,
        age,
        heightCm,
        cup,
        xslistUrl: targetUrl,
        source: 'xslist',
        fetchedAt: Date.now(),
      } as ActorRemarks;
      console.log(`[actorRemarks] xslist 成功: ${name}, 耗时: ${Date.now() - startTime}ms`);
      return { data: result };
    }
    console.log(`[actorRemarks] xslist 无有效数据: ${name}, 耗时: ${Date.now() - startTime}ms`);
    return { data: null };
  } catch (err) {
    console.log(`[actorRemarks] xslist 失败: ${name}, 耗时: ${Date.now() - startTime}ms, 错误:`, err);
    return { data: null, failure: buildFailure('xslist', err) };
  }
}

class ActorExtraInfoService {
  private memCache: Map<string, ActorRemarks> = new Map();
  private requestCooldowns: Map<string, number> = new Map();
  private inFlight: Map<string, Promise<ActorRemarksDiagnostics>> = new Map();

  async getActorRemarks(rawName: string, settings?: ExtensionSettings, deadlineMs?: number): Promise<ActorRemarks | null> {
    const result = await this.getActorRemarksWithDiagnostics(rawName, settings, deadlineMs);
    return result.data;
  }

  /**
   * deadlineMs（可选）：整体获取截止时间（毫秒）。
   * 每一阶段（wiki / xslist 搜索 / xslist 详情）会按剩余时间收缩单请求超时；
   * 剩余时间耗尽即停止后续阶段，返回已有结果。
   */
  async getActorRemarksWithDiagnostics(rawName: string, settings?: ExtensionSettings, deadlineMs?: number): Promise<ActorRemarksDiagnostics> {
    const startTime = Date.now();
    const name = normalizeName(rawName);
    if (!name) return { data: null, failures: [] };
    const deadlineAt = typeof deadlineMs === 'number' && Number.isFinite(deadlineMs) && deadlineMs > 0
      ? Date.now() + deadlineMs
      : 0;
    const remainingMs = (): number => (deadlineAt > 0 ? deadlineAt - Date.now() : 0);
    const clamp = (defaultMs: number): number => (deadlineAt > 0 ? Math.min(defaultMs, Math.max(200, remainingMs())) : defaultMs);

    const cooldownUntil = this.requestCooldowns.get(name) || 0;
    if (Date.now() < cooldownUntil && this.memCache.has(name)) {
      console.log(`[actorRemarks] 冷却期命中: ${name}`);
      return { data: this.memCache.get(name)!, failures: [] };
    }

    if (this.memCache.has(name)) {
      console.log(`[actorRemarks] 内存缓存命中: ${name}`);
      return { data: this.memCache.get(name)!, failures: [] };
    }

    const pending = this.inFlight.get(name);
    if (pending) {
      console.log(`[actorRemarks] 请求去重命中: ${name}`);
      return pending;
    }

    // TTL：以原脚本为准，默认 0（不缓存）；若用户设置了 >0，则启用
    const ttlDays = Math.max(0, Number(((settings as any)?.videoEnhancement?.actorRemarksTTLDays) || 0));

    const cached = await getFromCache(name, ttlDays);
    if (cached) { 
      console.log(`[actorRemarks] 存储缓存命中: ${name}`);
      this.memCache.set(name, cached); 
      return { data: cached, failures: [] };
    }

    console.log(`[actorRemarks] 开始获取演员信息: ${name}`);
    const task = (async (): Promise<ActorRemarksDiagnostics> => {
      const failures: ActorRemarksFailure[] = [];
      // 数据源顺序：以原脚本为准 Wikipedia -> xslist
      const wikiResult = deadlineAt > 0 && remainingMs() <= 0
        ? { data: null }
        : await fetchWikipedia(name, { timeoutMs: clamp(6500) });
      if (wikiResult.failure) failures.push(wikiResult.failure);
      const wiki = wikiResult.data;

      const wikiHasFields = Boolean(
        wiki && (
          typeof wiki.age === 'number' ||
          typeof wiki.heightCm === 'number' ||
          Boolean(wiki.cup) ||
          Boolean(wiki.retired) ||
          Boolean(wiki.ig) ||
          Boolean(wiki.tw)
        )
      );

      // 若 Wiki 只有外链/空壳，则继续尝试 xslist（截止时间耗尽则跳过）
      const xsResult = (!wiki || !wikiHasFields) && (deadlineAt <= 0 || remainingMs() > 0)
        ? await fetchXslist(name, { searchTimeoutMs: clamp(5000), detailTimeoutMs: clamp(5000) })
        : { data: null };
      if (xsResult.failure) failures.push(xsResult.failure);
      const xs = xsResult.data;

      const data: ActorRemarks | null = (wiki || xs)
        ? {
            name,
            age: (wiki?.age ?? xs?.age),
            heightCm: (wiki?.heightCm ?? xs?.heightCm),
            cup: (wiki?.cup ?? xs?.cup),
            retired: (wiki?.retired ?? xs?.retired),
            ig: (wiki?.ig ?? xs?.ig),
            tw: (wiki?.tw ?? xs?.tw),
            wikiUrl: (wiki?.wikiUrl ?? undefined),
            xslistUrl: (xs?.xslistUrl ?? wiki?.xslistUrl ?? undefined),
            source: (wikiHasFields || !xs) ? (wiki?.source || 'wikipedia') : (xs?.source || 'xslist'),
            fetchedAt: Date.now(),
          }
        : null;
      if (data) {
        console.log(`[actorRemarks] 获取成功: ${name}, 总耗时: ${Date.now() - startTime}ms, 来源: ${data.source}`);
        this.memCache.set(name, data);
        this.requestCooldowns.set(name, Date.now() + REQUEST_COOLDOWN_MS);
        if (ttlDays > 0) await putToCache(name, data);
      } else {
        console.log(`[actorRemarks] 获取失败: ${name}, 总耗时: ${Date.now() - startTime}ms`);
      }
      return { data: data || null, failures };
    })();

    this.inFlight.set(name, task);
    try {
      return await task;
    } finally {
      setTimeout(() => {
        if (this.inFlight.get(name) === task) this.inFlight.delete(name);
      }, REQUEST_IN_FLIGHT_TTL_MS);
    }
  }
}

export const actorExtraInfoService = new ActorExtraInfoService();
