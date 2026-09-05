/**
 * @file backgroundMessages.ts
 * @description backgroundMessages
 * @module features/newWorks
 */
import { newWorksCollector, newWorksManager, newWorksScheduler } from './index';

type SendResponse = (response: any) => void;

const manualCheckCancel = { cancelled: false };

export function handleNewWorksRuntimeMessage(message: any, sendResponse: SendResponse): boolean | void {
  switch (message?.type) {
    case 'new-works-manual-check':
      handleManualCheck(sendResponse);
      return true;
    case 'new-works-check-single-actor':
      handleSingleActorCheck(message, sendResponse);
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
      newWorksScheduler.restart()
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

function handleManualCheck(sendResponse: SendResponse): void {
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

            if (det.works.length > 0) {
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
      sendResponse({ success: true, result: { discovered, errors, cancelled: manualCheckCancel.cancelled, identifiedTotal, effectiveTotal, savedTotal, failedTotal } });
    } catch (error: any) {
      sendResponse({ success: false, error: error?.message || 'manual check failed' });
    }
  })();
}

function handleSingleActorCheck(message: any, sendResponse: SendResponse): void {
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
      if (det.works.length > 0) {
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

      sendResponse({
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
      });
    } catch (error: any) {
      console.error('[Background] 检查单个演员失败:', error);
      sendResponse({
        success: false,
        error: error?.message || '检查失败'
      });
    }
  })();
}
