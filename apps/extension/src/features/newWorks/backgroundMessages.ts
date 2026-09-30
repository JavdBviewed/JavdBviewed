/**
 * @file backgroundMessages.ts
 * @description backgroundMessages
 * @module features/newWorks
 */
import { newWorksCollector, newWorksManager, newWorksScheduler } from './index';
import type { NewWorkRecord } from '../../types';

/** 手动确认入库单次上限（防御性截断，正常 maxWorksPerCheck 远小于此值） */
const MAX_MANUAL_COMMIT_WORKS = 5000;

type SendResponse = (response: any) => void;

const manualCheckCancel = { cancelled: false };

export function handleNewWorksRuntimeMessage(message: any, sendResponse: SendResponse): boolean | void {
  switch (message?.type) {
    case 'new-works-manual-check':
      // confirmRequired=true（新作品页「立刻检查」）走「收集-确认-入库」新链；无标记=旧当场直写
      handleManualCheck(sendResponse, message?.confirmRequired === true);
      return true;
    case 'new-works-check-single-actor':
      // 同上：只有新作品页订阅弹窗带标记，其余调用方（演员选择器 / 演员页扫描按钮）语义逐字保留
      handleSingleActorCheck(message, sendResponse, message?.confirmRequired === true);
      return true;
    case 'new-works-manual-commit':
      handleManualCommit(message, sendResponse);
      return true;
    case 'new-works-manual-cancel':
      try {
        manualCheckCancel.cancelled = true;
        sendResponse({ success: true });
      } catch (error: any) {
        sendResponse({ success: false, error: error?.message || 'cancel failed' });
      }
      return true;
    case 'new-works-scheduler-restart':
      // 批 3a：dashboard 保存配置后发此消息；restart() 的 start() 会读内存配置定 alarm 周期，
      // 不先 reload 会拿到旧周期 → 先 reloadGlobalConfig 再 restart。
      // 与 storage.onChanged('new_works_config') 的 reload 为有意冗余（双入口消除竞态，幂等）。
      newWorksManager.reloadGlobalConfig()
        .then(() => newWorksScheduler.restart())
        .then(() => sendResponse({ success: true }))
        .catch((error: any) => sendResponse({ success: false, error: error?.message || 'restart failed' }));
      return true;
    case 'new-works-scheduler-status':
      try {
        const status = newWorksScheduler.getStatus();
        sendResponse({ success: true, status });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      return false;
    default:
      return false;
  }
}

function handleManualCheck(sendResponse: SendResponse, confirmRequired = false): void {
  (async () => {
    try {
      manualCheckCancel.cancelled = false;

      const config = await newWorksManager.getGlobalConfig();
      const subs = await newWorksManager.getSubscriptions();
      const active = subs.filter(s => s.enabled);
      const total = active.length;
      let processed = 0;
      let discovered = 0;
      let identifiedTotal = 0;
      let effectiveTotal = 0;
      const errors: string[] = [];
      let savedTotal = 0;
      let failedTotal = 0;
      // confirm 模式：只收集不入库，弹窗确认后由 new-works-manual-commit 落库
      const pendingWorks: NewWorkRecord[] = [];
      const breakdown = { dateRange: 0, viewed: 0, browsed: 0, want: 0, ar: 0, categoryBlack: 0 };
      let existingCount = 0;

      const cfg = {
        ...config,
        filters: {
          ...config.filters,
          excludeViewed: true,
          excludeBrowsed: true,
          excludeWant: true,
        },
      } as any;

      const concurrency = Math.max(1, Number(cfg.concurrency) || 1);
      console.log(`[Background] 开始手动检查，并发数: ${concurrency}`);

      const emitProgress = (activeActorNames: string[], actorName?: string) => {
        try {
          chrome.runtime.sendMessage({
            type: 'new-works-progress',
            payload: {
              processed,
              total,
              discovered,
              identifiedTotal,
              effectiveTotal,
              // 进度期与确认弹窗同一口径：可入库 = 已收集条数
              pendingTotal: pendingWorks.length,
              actorName,
              activeActorNames,
              concurrency,
            },
          });
        } catch {}
      };

      // 初始进度：让前端立刻知道即将按并发批次推进
      emitProgress([]);

      for (let i = 0; i < active.length; i += concurrency) {
        if (manualCheckCancel.cancelled) break;

        const batch = active.slice(i, i + concurrency);
        console.log(`[Background] 处理批次 ${Math.floor(i / concurrency) + 1}，包含 ${batch.length} 个演员`);

        // 当前批次内“正在检查”的演员（按 actorId 去重，支持并发多人同时显示）
        const activeById = new Map(batch.map((sub) => [sub.actorId, sub.actorName]));
        emitProgress([...activeById.values()]);

        const batchPromises = batch.map(async (sub) => {
          if (manualCheckCancel.cancelled) return null;

          try {
            const det = await newWorksCollector.checkActorNewWorksDetailed(sub, cfg);

            if (confirmRequired) {
              // 收集完整 NewWorkRecord（不裁剪字段）：确认后落库的记录形状与自动检查链一致，
              // 裁剪会丢 coverImage / releaseDate / tags
              pendingWorks.push(...det.works);
              const fb: any = det.filterBreakdown || {};
              (Object.keys(breakdown) as Array<keyof typeof breakdown>).forEach((key) => {
                breakdown[key] += Number(fb[key] || 0);
              });
              existingCount += det.existingCount || 0;
            } else if (det.works.length > 0) {
              console.log(`[Background] 准备保存 ${det.works.length} 个新作品到数据库`);
              try {
                const stats = await newWorksManager.addNewWorks(det.works);
                savedTotal += stats.saved;
                failedTotal += stats.failed;
                console.log(`[Background] 保存新作品: 成功 ${stats.saved}/${stats.total}${stats.failed > 0 ? `，失败 ${stats.failed}` : ''}`);
                if (stats.failed > 0) {
                  errors.push(`${sub.actorName}: ${stats.saved}/${stats.total} 个新作品未持久化到 IndexedDB`);
                }
              } catch (e) {
                console.error('[Background] 保存新作品失败:', e);
                failedTotal += det.works.length;
                errors.push(`${sub.actorName}: 新作品持久化异常 ${e?.message || String(e)}`);
              }
            }

            identifiedTotal += det.identified || 0;
            effectiveTotal += det.effective || 0;
            discovered += det.works.length;
            processed++;

            activeById.delete(sub.actorId);
            emitProgress([...activeById.values()], sub.actorName);

            return {
              success: true,
              identified: det.identified,
              effective: det.effective,
              discovered: det.works.length,
              actorId: sub.actorId,
              actorName: sub.actorName
            };
          } catch (e: any) {
            processed++;
            const errorMsg = `检查演员 ${sub.actorName} 失败: ${e?.message || String(e)}`;
            errors.push(errorMsg);

            activeById.delete(sub.actorId);
            emitProgress([...activeById.values()], sub.actorName);

            return {
              success: false,
              error: errorMsg,
              actorId: sub.actorId,
              actorName: sub.actorName
            };
          }
        });

        await Promise.all(batchPromises);

        if (i + concurrency < active.length && !manualCheckCancel.cancelled) {
          const gap = Math.max(0, Number(cfg.requestInterval || 0)) * 1000;
          if (gap > 0) {
            console.log(`[Background] 批次间延迟 ${cfg.requestInterval} 秒`);
            await new Promise(r => setTimeout(r, gap));
          }
        }
      }

      try { await newWorksManager.updateGlobalConfig({ lastGlobalCheck: Date.now() }); } catch {}
      const result: any = {
        discovered,
        errors,
        cancelled: manualCheckCancel.cancelled,
        identifiedTotal,
        effectiveTotal,
        savedTotal,
        failedTotal,
      };
      if (confirmRequired) {
        // 纯增量字段：旧字段语义不变，pendingWorks 缺失即代表后台是旧版（UI 走 legacy 提示分支）
        result.pendingWorks = pendingWorks;
        result.breakdown = breakdown;
        result.existingCount = existingCount;
      }
      sendResponse({ success: true, result });
    } catch (error: any) {
      sendResponse({ success: false, error: error?.message || 'manual check failed' });
    }
  })();
}

function handleSingleActorCheck(message: any, sendResponse: SendResponse, confirmRequired = false): void {
  (async () => {
    try {
      const { actorId, actorName } = message;
      if (!actorId || !actorName) {
        sendResponse({ success: false, error: '缺少演员信息' });
        return;
      }

      console.log(`[Background] 开始检查单个演员: ${actorName} (${actorId})`);

      const config = await newWorksManager.getGlobalConfig();
      const cfg = {
        ...config,
        filters: {
          ...config.filters,
          excludeViewed: true,
          excludeBrowsed: true,
          excludeWant: true,
        },
      } as any;

      const subscription = {
        actorId,
        actorName,
        enabled: true,
        subscribedAt: Date.now()
      };

      const det = await newWorksCollector.checkActorNewWorksDetailed(subscription, cfg);

      console.log(`[Background] 演员 ${actorName} 检查结果:`, {
        identified: det.identified,
        effective: det.effective,
        filteredOut: det.filteredOut,
        existingCount: det.existingCount,
        filterBreakdown: det.filterBreakdown,
        newWorks: det.works.length
      });

      try {
        chrome.runtime.sendMessage({
          type: 'new-works-single-progress',
          payload: {
            actorId,
            actorName,
            identified: det.identified,
            effective: det.effective
          }
        });
      } catch (e) {
        console.warn('[Background] 发送进度消息失败:', e);
      }

      let saved = 0;
      let failed = 0;
      if (!confirmRequired && det.works.length > 0) {
        console.log(`[Background] 准备保存 ${det.works.length} 个新作品`);
        const stats = await newWorksManager.addNewWorks(det.works);
        saved = stats.saved;
        failed = stats.failed;
        console.log(`[Background] 保存新作品: 成功 ${stats.saved}/${stats.total}${stats.failed > 0 ? `，失败 ${stats.failed}` : ''}`);
      }

      // 更新订阅的"最后检查"时间（仅当该演员已存在订阅时）
      try {
        await newWorksManager.markSubscriptionChecked(actorId);
      } catch (e) {
        console.warn('[Background] 更新订阅最后检查时间失败:', e);
      }

      const singleResult: any = {
        success: true,
        result: {
          discovered: det.works.length,
          identified: det.identified,
          effective: det.effective,
          filteredOut: det.filteredOut,
          existingCount: det.existingCount,
          filterBreakdown: det.filterBreakdown,
          // 本次写入的作品主键（番号或 JavDB ID）。同一番号的原版/特典版会共享主键，
          // 调用方按 workIds 去重后才是应落库的唯一记录数（#42 E2E 断言依据）
          workIds: det.works.map((w) => w.id),
          saved,
          failed
        }
      };
      if (confirmRequired) {
        // 纯增量字段（同上）：完整记录交 UI 确认后 commit
        singleResult.result.pendingWorks = det.works;
        singleResult.result.breakdown = det.filterBreakdown;
      }
      sendResponse(singleResult);
    } catch (error: any) {
      console.error('[Background] 检查单个演员失败:', error);
      sendResponse({
        success: false,
        error: error?.message || '检查失败'
      });
    }
  })();
}

/**
 * 手动确认入库：UI 确认弹窗点「确认入库」后统一批量写。
 * 消息往返内存里的 pendingWorks 由 UI 原样回传，这里做白名单重建（不信任入参形状/多余字段），
 * 仅保留 NewWorkRecord 合法字段并规范化，幂等性由 addNewWorks（已有 id 不覆盖）保证。
 */
function handleManualCommit(message: any, sendResponse: SendResponse): void {
  (async () => {
    try {
      const raw = Array.isArray(message?.works) ? message.works : [];
      const seen = new Set<string>();
      const works: NewWorkRecord[] = [];

      for (const item of raw.slice(0, MAX_MANUAL_COMMIT_WORKS)) {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        if (!id || seen.has(id)) continue;
        const record: NewWorkRecord = {
          id,
          actorId: typeof item?.actorId === 'string' ? item.actorId.trim() : '',
          actorName: typeof item?.actorName === 'string' ? item.actorName.trim() : '',
          title: typeof item?.title === 'string' ? item.title.trim() : '',
          javdbUrl: typeof item?.javdbUrl === 'string' ? item.javdbUrl.trim() : '',
          tags: Array.isArray(item?.tags) ? item.tags.filter((tag: unknown) => typeof tag === 'string') : [],
          discoveredAt: Number.isFinite(Number(item?.discoveredAt)) ? Number(item.discoveredAt) : Date.now(),
          isRead: item?.isRead === true,
          status: 'new',
        };
        if (typeof item?.releaseDate === 'string' && item.releaseDate.trim()) record.releaseDate = item.releaseDate.trim();
        if (typeof item?.coverImage === 'string' && item.coverImage.trim()) record.coverImage = item.coverImage.trim();
        seen.add(id);
        works.push(record);
      }

      if (works.length === 0) {
        sendResponse({ success: true, result: { requested: raw.length, total: 0, saved: 0, failed: 0 } });
        return;
      }

      const stats = await newWorksManager.addNewWorks(works);
      console.log(`[Background] 手动确认入库: 成功 ${stats.saved}/${stats.total}${stats.failed > 0 ? `，失败 ${stats.failed}` : ''}`);
      sendResponse({
        success: true,
        result: { requested: raw.length, total: stats.total, saved: stats.saved, failed: stats.failed },
      });
    } catch (error: any) {
      console.error('[Background] 手动确认入库失败:', error);
      sendResponse({ success: false, error: error?.message || '手动确认入库失败' });
    }
  })();
}
