/**
 * @file newWorksDirectPersist.spec.ts
 * @description #42 真机回归：单个演员检查的新作品必须在 SW 内直接写入 IndexedDB，
 *              不再走 runtime 消息传递（旧路径在 SW 内无接收端，导致 0/N 持久化失败）。
 * 证据链：消息响应 saved>0 && failed===0；dashboard 页直读同源 IndexedDB
 *        (javdb_v1 / newWorks) 中该演员 id 集合 ⊇ unique(workIds)（直写落库的权威证据；
 *        discovered 可能大于唯一主键数——同番号原版/特典版共享主键，按 keyPath 覆盖属预期）。
 * SW 控制台日志仅作诊断：CDP 对 SW console 事件投递存在丢失/滞后（两轮实测
 * 直写日志 20s 内未送达），不做硬断言；"不走消息传递"由单测
 * manager.newWorksPersist.test.ts 覆盖。
 * @module tests/extension-e2e
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';
import {
  extensionPageUrl,
  launchExtensionContext,
  readExtensionId,
  resolveExtensionHarnessOptions,
} from '../../scripts/extensionHarness';

function resolveTestHarnessOptions(userDataDir: string): ReturnType<typeof resolveExtensionHarnessOptions> {
  return resolveExtensionHarnessOptions(
    {
      ...process.env,
      JAVDB_EXTENSION_USE_CHROME_DATA: '0',
      JAVDB_EXTENSION_PROFILE: path.resolve(userDataDir),
    },
    process.cwd(),
  );
}

const JAVDB_E2E_HOST = 'https://javdb570.com';
const NAV_ACTOR_IDS = new Set(['censored', 'uncensored', 'western']);

/** 本机环境代理不可达 javdb570，浏览器必须直连；node 侧 fetch 本来就不走代理 */
function stripProxyEnv(): void {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[key];
  }
}

interface E2eActor { actorId: string; actorName: string; }

/** 运行时从「发布日期排序」最新影片页取一位近期有作品的演员（网络不可用返回 null → skip） */
async function pickActorWithRecentWorks(): Promise<E2eActor | null> {
  try {
    const latestResp = await fetch(`${JAVDB_E2E_HOST}/?vst=1`, { signal: AbortSignal.timeout(30_000) });
    console.info(`[E2E #42] latest page status=${latestResp.status}`);
    if (!latestResp.ok) return null;
    const latestHtml = await latestResp.text();
    const videoMatch = latestHtml.match(/href="\/v\/([A-Za-z0-9]+)"/);
    if (!videoMatch) return null;

    const videoResp = await fetch(`${JAVDB_E2E_HOST}/v/${videoMatch[1]}`, { signal: AbortSignal.timeout(30_000) });
    if (!videoResp.ok) return null;
    const videoHtml = await videoResp.text();

    const actorLinks = Array.from(videoHtml.matchAll(/href="\/actors\/([A-Za-z0-9]+)"[^>]*>([^<]+)</g));
    for (const match of actorLinks) {
      const actorId = match[1];
      const actorName = match[2].trim();
      if (!NAV_ACTOR_IDS.has(actorId) && actorName) {
        return { actorId, actorName };
      }
    }
    return null;
  } catch (error) {
    console.info('[E2E #42] pick actor failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

test.describe('new works direct IndexedDB persist (#42)', () => {
  // 演员页后台 tab 解析含 3s 基础延迟 + 可能的分页，真机耗时较长
  test.setTimeout(240_000);

  test('single-actor check persists works via direct IDB write in service worker', async ({}, testInfo) => {
    const actor = await pickActorWithRecentWorks();
    test.skip(!actor, 'javdb570 网络不可用或页面结构变化，跳过真机检查');

    stripProxyEnv();
    const harnessOptions = resolveTestHarnessOptions(testInfo.outputPath('profile'));
    const context = await launchExtensionContext(harnessOptions, {
      headless: false,
      channel: process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
      // 本机环境代理不可达 javdb570，强制浏览器直连（SW 打开的后台 tab 同样生效）
      extraArgs: ['--no-proxy-server'],
    });

    try {
      const extensionId = await readExtensionId(context);
      const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://'))
        ?? await context.waitForEvent('serviceworker', { timeout: 20_000 });
      expect(worker).toBeTruthy();

      const consoleLogs: string[] = [];
      worker.on('console', (msg) => {
        consoleLogs.push(msg.text());
      });
      // 诊断探测：本环境下 SW console 投递是否可用（仅记录，不断言）
      void worker.evaluate(() => { console.log('[E2E #42] sw-console-probe'); }).catch(() => {});

      // 诊断：对 SW 通过 chrome.tabs.create 打开的后台 tab 做加载快照
      const swTabSnapshots: any[] = [];
      context.on('page', (page) => {
        void (async () => {
          const entry: any = { opened: page.url() };
          swTabSnapshots.push(entry);
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: 45_000 });
            entry.finalUrl = page.url();
            entry.title = await page.title();
            entry.items = await page.evaluate(() =>
              document.querySelectorAll('.movie-list .item, .grid-item .item').length,
            );
            entry.bodyLen = await page.evaluate(() => document.body?.innerHTML.length ?? -1);
          } catch (error) {
            entry.error = String(error).slice(0, 120);
          }
          console.info('[E2E #42] SW tab snapshot:', JSON.stringify(entry));
        })();
      });

      // 配置路由（保留既有 settings，仅覆盖 javdb 主线路）与订阅
      await worker.evaluate((primaryHost) => {
        return new Promise<void>((resolve, reject) => {
          chrome.storage.local.get('settings', (current) => {
            const settings = (current?.settings ?? {}) as Record<string, any>;
            chrome.storage.local.set({
              settings: {
                ...settings,
                routes: {
                  ...(settings.routes ?? {}),
                  javdb: {
                    ...(settings.routes?.javdb ?? {}),
                    primary: primaryHost,
                  },
                },
              },
            }, resolve);
          });
        });
      }, JAVDB_E2E_HOST);

      await worker.evaluate((sub) => chrome.storage.local.set({
        new_works_subscriptions: { [sub.actorId]: { ...sub, enabled: true, subscribedAt: Date.now() } },
      }), { actorId: actor!.actorId, actorName: actor!.actorName });

      console.info(`[E2E #42] 目标演员: ${actor!.actorName} (${actor!.actorId})`);

      // 注意：必须从页面侧发 runtime 消息——SW 自己 sendMessage 不会回环到自己的 onMessage
      // （这正是 #42 旧持久化路径在 SW 内 0/N 的根因），dashboard 页面是合法的发送源。
      const senderPage = await context.newPage();
      await senderPage.goto(extensionPageUrl(extensionId, 'dashboard/dashboard.html'), {
        waitUntil: 'domcontentloaded',
      });
      const response = await senderPage.evaluate(
        (sub) => new Promise<any>((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'new-works-check-single-actor', actorId: sub.actorId, actorName: sub.actorName },
            resolve,
          );
        }),
        { actorId: actor!.actorId, actorName: actor!.actorName },
      );

      expect(response?.success, `检查失败: ${JSON.stringify(response)}`).toBe(true);

      const { discovered, saved, failed } = response.result ?? {};
      console.info(`[E2E #42] 发现 ${discovered}，saved=${saved}，failed=${failed}`);
      if (!discovered) {
        console.info(`[E2E #42] 诊断 SW tab 快照: ${JSON.stringify(swTabSnapshots)}`);
        console.info(`[E2E #42] 诊断：SW 控制台最近 60 条：\n${consoleLogs.slice(-60).join('\n')}`);
      }
      expect(discovered).toBeGreaterThan(0);
      expect(saved, '必须全部直写成功').toBeGreaterThan(0);
      expect(failed).toBe(0);

      // 核心证据：dashboard 页与 SW 同源、共享 IndexedDB（javdb_v1 / newWorks），
      // 直接读库验证直写已落库——这是 #42「作品必须持久化到 IndexedDB」的权威证据。
      const idbVerify = await senderPage.evaluate(async (actorId) => {
        return new Promise<any>((resolve, reject) => {
          const openReq = indexedDB.open('javdb_v1');
          openReq.onsuccess = () => {
            const db = openReq.result;
            let tx: IDBTransaction;
            try {
              tx = db.transaction('newWorks', 'readonly');
            } catch (e) {
              reject(e);
              return;
            }
            const all = tx.objectStore('newWorks').getAll();
            all.onsuccess = () => {
              const records: any[] = all.result ?? [];
              const mine = records.filter((r) => r && r.actorId === actorId);
              resolve({
                total: records.length,
                mineCount: mine.length,
                mineIds: mine.map((r) => r.id),
                sample: mine.slice(0, 2).map((r) => ({
                  id: r.id,
                  title: String(r.title).slice(0, 40),
                  status: r.status,
                  discoveredAt: r.discoveredAt,
                })),
              });
            };
            all.onerror = () => reject(all.error);
          };
          openReq.onerror = () => reject(openReq.error);
        });
      }, actor!.actorId);
      console.info(`[E2E #42] IDB 验证: 库内共 ${idbVerify.total} 条, 该演员 ${idbVerify.mineCount} 条, 样例=${JSON.stringify(idbVerify.sample)}`);
      // 断言语义（#42 契约「无作品因写失败丢失」）：本次写入的所有作品主键必须全部落库。
      // 注意 discovered 可能大于唯一主键数：同一番号的原版/特典版共享主键
      // （如 START-287 与 START-287-V 均提取为 START-287），按 keyPath 覆盖是既有设计
      // 的预期行为，不属于写失败丢数据；因此按 unique(workIds) 而非 discovered 断言。
      const uniqueWorkIds = [...new Set((response.result?.workIds ?? []) as string[])];
      const mineIdSet = new Set(idbVerify.mineIds as string[]);
      const missingIds = uniqueWorkIds.filter((id) => !mineIdSet.has(id));
      expect(missingIds, `以下作品主键未落库: ${missingIds.join(', ')}`).toEqual([]);
      expect(
        (idbVerify.mineIds as string[]).length,
        `该演员 IDB 记录数 ${(idbVerify.mineIds as string[]).length} 应 >= 唯一主键数 ${uniqueWorkIds.length}`,
      ).toBeGreaterThanOrEqual(uniqueWorkIds.length);
      console.info(`[E2E #42] 直写校验: discovered=${discovered}, 唯一主键=${uniqueWorkIds.length}, IDB 该演员=${(idbVerify.mineIds as string[]).length}, 全部落库=${missingIds.length === 0}`);

      // SW 控制台直写日志仅作诊断（CDP 对 SW console 投递会丢失/滞后），命中则补充核对 X==Y
      const persistLog = await new Promise<string | null>((resolve) => {
        const findLog = () => consoleLogs.find((line) => /已保存 (\d+)\/(\d+) 个作品到 IndexedDB \(直接调用\)/.test(line)) ?? null;
        const hit = findLog();
        if (hit) {
          resolve(hit);
          return;
        }
        const started = Date.now();
        const timer = setInterval(() => {
          const h = findLog();
          if (h) {
            clearInterval(timer);
            resolve(h);
          } else if (Date.now() - started > 8_000) {
            clearInterval(timer);
            resolve(null);
          }
        }, 500);
      });
      if (persistLog) {
        console.info(`[E2E #42] SW 控制台直写日志已送达: ${persistLog}`);
        const m = persistLog.match(/已保存 (\d+)\/(\d+)/)!;
        expect(Number(m[1])).toBe(Number(m[2]));
      } else {
        console.info('[E2E #42] SW 控制台直写日志未送达（已知 CDP SW console 投递滞后），以 IDB 验证为准');
      }
      console.info(`[E2E #42] SW console 投递探测到达=${consoleLogs.some((l) => l.includes('sw-console-probe'))}, 共捕获 ${consoleLogs.length} 条`);

      // 订阅最后检查时间应已更新
      const subState = await worker.evaluate((id) => new Promise<any>((resolve) => {
        chrome.storage.local.get('new_works_subscriptions', (current) => resolve(current?.new_works_subscriptions?.[id] ?? null));
      }), actor!.actorId);
      expect(subState?.lastCheckTime, 'markSubscriptionChecked 未更新 lastCheckTime').toBeTruthy();
    } finally {
      await context.close();
    }
  });
});
