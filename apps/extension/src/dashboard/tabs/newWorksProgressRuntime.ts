import type { ManualScanResultSummary } from '../../features/newWorks/newWorksScanState';

export interface NewWorksProgressData {
  processed?: number;
  total?: number;
  identifiedTotal?: number;
  /** 内部字段：含"已在新作品库"的生效条数，不进进度文案（与弹窗「可入库」口径易混淆） */
  effectiveTotal?: number;
  /** 已收集的可入库条数：进度期与确认弹窗同一口径、同一个词 */
  pendingTotal?: number;
  /** 最近完成/上报的单个演员（兼容旧字段） */
  actorName?: string;
  /** 当前并发批次中仍在检查的演员名单 */
  activeActorNames?: string[];
  concurrency?: number;
  done?: boolean;
  /** SW 终态广播：本次扫描已结束（完成/取消/异常） */
  finished?: boolean;
  /** 终态为取消 */
  cancelled?: boolean;
  /** 终态为 SW 侧异常 */
  error?: boolean;
  /** 完成摘要（计数，非记录）：页面离线期间完成时补一次性提示 */
  resultSummary?: ManualScanResultSummary;
}

export interface NewWorksProgressRuntimeDeps {
  sendCancelMessage(): void;
  doc?: Document;
}

export interface NewWorksProgressMessageBus {
  onMessage: {
    addListener(listener: (message: any) => void): void;
    removeListener(listener: (message: any) => void): void;
  };
}

function normalizeActorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function formatActiveActorsLabel(activeActorNames?: string[], actorName?: string): string {
  const names = normalizeActorNames(activeActorNames);
  if (names.length > 0) {
    if (names.length === 1) return `，正在检查：${names[0]}`;
    return `，正在检查（${names.length}）：${names.join('、')}`;
  }
  if (actorName && actorName.trim()) {
    return `，当前：${actorName.trim()}`;
  }
  return '';
}

export function ensureNewWorksProgressUI(
  currentEl: HTMLElement | undefined,
  deps: NewWorksProgressRuntimeDeps,
): HTMLElement | undefined {
  const doc = deps.doc || document;
  if (currentEl && doc.body.contains(currentEl)) {
    return currentEl;
  }

  const host = doc.querySelector('.new-works-controls')
    || doc.getElementById('newWorksStatsContainer')
    || doc.getElementById('tab-new-works');
  if (!host) {
    return undefined;
  }

  const el = doc.createElement('div');
  el.id = 'newWorksProgress';
  el.style.cssText = 'margin:10px 0;padding:12px;border:1px dashed #999;border-radius:6px;background:rgba(0,0,0,0.03);font-size:13px;';
  el.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <i class="fas fa-tasks"></i>
                <span class="text">准备中...</span>
                <button id="newWorksCancelBtn" class="btn-secondary" style="margin-left:auto;">取消</button>
            </div>
            <div class="progress-active-actors" style="display:none;margin:0 0 8px;color:var(--text-secondary,#64748b);font-size:12px;line-height:1.5;"></div>
            <div class="progress-bar-container" style="width:100%;height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden;">
                <div class="progress-bar-fill" style="width:0%;height:100%;background:linear-gradient(90deg, #4caf50, #66bb6a);transition:width 0.3s ease;"></div>
            </div>
        `;
  host.appendChild(el);

  const cancelBtn = el.querySelector('#newWorksCancelBtn') as HTMLButtonElement | null;
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (cancelBtn.disabled) return;
      cancelBtn.disabled = true;
      cancelBtn.textContent = '取消中...';
      deps.sendCancelMessage();
    }, { once: true });
  }

  return el;
}

export function updateNewWorksProgressUI(progressEl: HTMLElement | undefined, data: NewWorksProgressData): void {
  if (!progressEl) return;

  const text = progressEl.querySelector('.text') as HTMLElement | null;
  const progressBar = progressEl.querySelector('.progress-bar-fill') as HTMLElement | null;
  const activeLine = progressEl.querySelector('.progress-active-actors') as HTMLElement | null;
  if (!text) return;

  if (data.done) {
    text.textContent = '检查完成';
    if (progressBar) {
      progressBar.style.width = '100%';
    }
    if (activeLine) {
      activeLine.style.display = 'none';
      activeLine.textContent = '';
    }
    return;
  }

  const processed = typeof data.processed === 'number' ? data.processed : undefined;
  const total = typeof data.total === 'number' ? data.total : undefined;
  const identifiedTotal = typeof data.identifiedTotal === 'number' ? data.identifiedTotal : undefined;
  const pendingTotal = typeof data.pendingTotal === 'number' ? data.pendingTotal : undefined;
  const activeActorNames = normalizeActorNames(data.activeActorNames);
  const actor = formatActiveActorsLabel(activeActorNames, data.actorName);

  if (progressBar && processed !== undefined && total !== undefined && total > 0) {
    progressBar.style.width = `${Math.round((processed / total) * 100)}%`;
  }

  const segmentProgress = processed !== undefined && total !== undefined ? `进度 ${processed}/${total}` : '进行中';
  const segmentIdentified = identifiedTotal !== undefined ? `，已识别 ${identifiedTotal}` : '';
  const segmentPending = pendingTotal !== undefined ? `，可入库 ${pendingTotal}` : '';
  text.textContent = `${segmentProgress}${segmentIdentified}${segmentPending}${actor}`;

  if (activeLine) {
    if (activeActorNames.length > 0) {
      activeLine.style.display = 'block';
      activeLine.textContent = activeActorNames.length === 1
        ? `并发进行中：${activeActorNames[0]}`
        : `并发进行中（${activeActorNames.length}）：${activeActorNames.join('、')}`;
    } else {
      activeLine.style.display = 'none';
      activeLine.textContent = '';
    }
  }
}

export function hideNewWorksProgressUIAfter(
  progressEl: HTMLElement | undefined,
  ms: number,
  onRemoved: () => void,
  win: Window = window,
  /** 延迟到期时校验元素是否仍属当前扫描（窗口内重开新扫描 = 复用同一元素，旧延迟不得拆新 UI） */
  isStillCurrent?: () => boolean,
): void {
  if (!progressEl) return;
  win.setTimeout(() => {
    if (isStillCurrent && !isStillCurrent()) return;
    progressEl.remove();
    onRemoved();
  }, Math.max(0, ms));
}

export function attachNewWorksProgressListener(
  currentListener: ((message: any) => void) | undefined,
  onProgress: (data: NewWorksProgressData) => void,
  bus: NewWorksProgressMessageBus,
): (message: any) => void {
  detachNewWorksProgressListener(currentListener, bus);

  const handler = (message: any) => {
    try {
      if (message && message.type === 'new-works-progress') {
        const payload = message.payload || {};
        const finished = payload.finished === true;
        const data: NewWorksProgressData = {
          processed: payload.processed,
          total: payload.total,
          identifiedTotal: payload.identifiedTotal,
          effectiveTotal: payload.effectiveTotal,
          pendingTotal: payload.pendingTotal,
          actorName: payload.actorName,
          activeActorNames: normalizeActorNames(payload.activeActorNames),
          concurrency: typeof payload.concurrency === 'number' ? payload.concurrency : undefined,
        };
        // 终态广播（issue#52）：合并 done 语义（进度 UI 收口「检查完成」）+ 终态标记透传；
        // 常规进度消息保持原字段形状（无多余键），既有断言零位移
        if (payload.done === true || finished) data.done = true;
        if (finished) data.finished = true;
        if (payload.cancelled === true) data.cancelled = true;
        if (payload.error === true) data.error = true;
        if (payload.resultSummary) data.resultSummary = payload.resultSummary;
        onProgress(data);
      }
    } catch {}
  };
  bus.onMessage.addListener(handler);
  return handler;
}

export function detachNewWorksProgressListener(
  listener: ((message: any) => void) | undefined,
  bus: NewWorksProgressMessageBus,
): undefined {
  if (listener) {
    try { bus.onMessage.removeListener(listener); } catch {}
  }
  return undefined;
}
