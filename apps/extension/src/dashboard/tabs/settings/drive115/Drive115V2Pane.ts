interface IDrive115Pane {
  mount(): void;
  unmount(): void;
  show(): void;
  hide(): void;
  validate?(): string[];
}
import { getDrive115V2Service, type Drive115V2UserInfo } from '../../../../features/drive115/v2';
import { getSettings, saveSettings } from '../../../../utils/storage';
import { describe115Error } from '../../../../features/drive115/v2/errorCodes';
import { showToast } from '../../../../platform/browser/toast';
import { sendRuntimeMessage } from '../../../../platform/browser/runtimeMessages';
import { addLogV2 } from '../../../../features/drive115/v2/logs';
import { openDrive115FolderPicker } from '../../../components/drive115FolderPicker';
import {
  buildDrive115QrImageUrl,
  exchangeDrive115DeviceCode,
  generateDrive115PkcePair,
  pollDrive115DeviceStatus,
  requestDrive115DeviceCode,
} from '../../../../features/drive115/v2/pkce';

const OPENLIST_MANUAL_URL = 'https://api.oplist.org/';

type Drive115PaneContext = {
  update: (patch: Partial<any>) => void;
  updateUI: () => void;
  save?: () => void;
};

export class Drive115V2Pane implements IDrive115Pane {
  private el: HTMLElement | null = null;
  private authPollingTimer: number | undefined;
  private authSession: {
    clientId: string;
    codeVerifier: string;
    uid: string;
    time: string;
    sign: string;
    qrcode: string;
  } | null = null;
  constructor(
    private readonly elId: string = 'drive115V2Pane',
    private readonly ctx?: Drive115PaneContext
  ) {}

  private getOpenlistScanSeedParts(): number[] {
    return [5 + 6, 10 - 3, 20 - 1, 1 + 2];
  }

  private getOpenlistScanMaskAt(index: number): number {
    return [0x30 + 0x0a, 0x2f + 0x0b, 0x38 + 0x02][index % 3];
  }

  private getOpenlistScanCipherParts(): number[] {
    const left = [141, 135, 158];
    const middle = [144, 161, 164];
    const right = [185, 189, 183];
    return left.concat(middle, right);
  }

  private getOpenlistScanKeyBase(): number {
    return this.getOpenlistScanSeedParts()
      .reduce((acc, value, index) => acc + value * (index + 2), 0);
  }

  private decodeOpenlistScanChar(value: number, index: number): string {
    const key = (this.getOpenlistScanKeyBase() + index * 7) & 0xff;
    return String.fromCharCode((value ^ key) ^ this.getOpenlistScanMaskAt(index));
  }

  private decodeOpenlistScanClientId(): string {
    return this.getOpenlistScanCipherParts()
      .map((value, index) => this.decodeOpenlistScanChar(value, index))
      .join('');
  }

  private getCurrentAuthMode(): 'openlist_manual' | 'openlist_scan' | 'self_app' {
    const select = document.getElementById('drive115V2AuthMode') as HTMLSelectElement | null;
    const value = String(select?.value || '').trim();
    return value === 'self_app'
      ? 'self_app'
      : value === 'openlist_scan'
        ? 'openlist_scan'
        : 'openlist_manual';
  }

  private syncAuthClientIdUi(mode?: 'openlist_manual' | 'openlist_scan' | 'self_app'): void {
    const currentMode = mode || this.getCurrentAuthMode();
    const clientIdRow = document.getElementById('drive115V2ClientIdRow') as HTMLDivElement | null;
    const openlistScanHint = document.getElementById('drive115V2OpenlistScanHint') as HTMLDivElement | null;
    const sharedAuthActionRow = document.getElementById('drive115V2SharedAuthActionRow') as HTMLDivElement | null;
    const authFlowDesc = document.getElementById('drive115V2AuthFlowDesc') as HTMLParagraphElement | null;
    const clientIdInput = document.getElementById('drive115V2ClientId') as HTMLInputElement | null;

    if (clientIdRow) clientIdRow.style.display = currentMode === 'self_app' ? '' : 'none';
    if (openlistScanHint) openlistScanHint.style.display = currentMode === 'openlist_scan' ? '' : 'none';
    if (sharedAuthActionRow) sharedAuthActionRow.style.display = currentMode === 'openlist_scan' ? '' : 'none';

    if (authFlowDesc) {
      authFlowDesc.textContent = currentMode === 'openlist_scan'
        ? '流程：使用内置 OpenList APP ID → 生成二维码 → 用 115 手机客户端扫码并确认 → 自动保存新 token。'
        : '流程：输入 APP ID → 生成二维码 → 用 115 手机客户端扫码并确认 → 自动保存新 token。';
    }

    if (!clientIdInput) return;
    if (currentMode === 'openlist_scan') {
      clientIdInput.value = this.decodeOpenlistScanClientId();
    }
  }

  private autoResize(el?: HTMLTextAreaElement | null) {
    if (!el) return;
    // 先重置再按内容撑开
    el.style.height = 'auto';
    el.style.overflow = 'hidden';
    // 计算高度：scrollHeight 包含内边距，不含边框
    let target = el.scrollHeight;
    const cs = window.getComputedStyle(el);
    if (cs.boxSizing === 'border-box') {
      const borderTop = parseFloat(cs.borderTopWidth || '0') || 0;
      const borderBottom = parseFloat(cs.borderBottomWidth || '0') || 0;
      target += borderTop + borderBottom;
    }
    // 最小高度保护：至少容纳 rows 行（若未设置 rows，则按 2 行），避免出现第二行被裁切
    const lineHeight = parseFloat(cs.lineHeight || '0') || 0;
    const paddingTop = parseFloat(cs.paddingTop || '0') || 0;
    const paddingBottom = parseFloat(cs.paddingBottom || '0') || 0;
    const rowsAttr = parseInt(el.getAttribute('rows') || '0', 10);
    const minRows = rowsAttr > 0 ? rowsAttr : 2;
    if (lineHeight > 0) {
      const minHeight = minRows * lineHeight + paddingTop + paddingBottom + (cs.boxSizing === 'border-box' ? (parseFloat(cs.borderTopWidth||'0')||0) + (parseFloat(cs.borderBottomWidth||'0')||0) : 0);
      target = Math.max(target, minHeight);
    }
    // 像素取整并加 1px 余量，避免渲染取整造成的裁切
    const finalH = Math.ceil(target) + 1;
    el.style.height = `${finalH}px`;
  }

  private scheduleAutoResize(ids: string[]) {
    const run = () => {
      ids.forEach((id) => this.autoResize(document.getElementById(id) as HTMLTextAreaElement | null));
    };
    // 立即执行一次
    run();
    // 下一帧
    requestAnimationFrame(run);
    // 稍后再执行几次，覆盖异步填充值的场景
    setTimeout(run, 100);
    setTimeout(run, 300);
  }

  private getElement(): HTMLElement | null {
    if (!this.el) this.el = document.getElementById(this.elId);
    return this.el;
  }

  private syncClientIdValue(value?: string): void {
    const clientId = String(value || '').trim();
    this.ctx?.update?.({ v2ClientId: clientId } as any);
    const input = document.getElementById('drive115V2ClientId') as HTMLInputElement | null;
    if (input && input.value !== clientId) input.value = clientId;
  }

  private setAuthStatus(message: string, kind: 'idle' | 'info' | 'success' | 'error' = 'idle'): void {
    const el = document.getElementById('drive115V2AuthStatus') as HTMLDivElement | null;
    if (!el) return;
    el.textContent = message;
    const palette = {
      idle: { color: '#616161', bg: '#f5f5f5' },
      info: { color: '#1565c0', bg: '#e3f2fd' },
      success: { color: '#2e7d32', bg: '#e8f5e9' },
      error: { color: '#c62828', bg: '#ffebee' },
    } as const;
    const style = palette[kind];
    el.style.color = style.color;
    el.style.background = style.bg;
  }

  private setAuthDeviceMeta(text: string): void {
    const el = document.getElementById('drive115V2DeviceCodeMeta') as HTMLDivElement | null;
    if (el) el.textContent = text;
  }

  private setAuthQrContent(qrImageUrl?: string): void {
    const img = document.getElementById('drive115V2QrImage') as HTMLImageElement | null;
    const placeholder = document.getElementById('drive115V2QrPlaceholder') as HTMLDivElement | null;
    if (img) {
      if (qrImageUrl) {
        img.src = qrImageUrl;
        img.style.display = '';
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
      }
    }
    if (placeholder) {
      placeholder.style.display = qrImageUrl ? 'none' : '';
    }
  }

  private updateAuthModePanels(mode?: 'openlist_manual' | 'openlist_scan' | 'self_app'): void {
    const currentMode = mode === 'self_app'
      ? 'self_app'
      : mode === 'openlist_scan'
        ? 'openlist_scan'
        : 'openlist_manual';
    const openlistPanel = document.getElementById('drive115V2OpenlistPanel') as HTMLDivElement | null;
    const selfAppPanel = document.getElementById('drive115V2SelfAppPanel') as HTMLDivElement | null;
    if (openlistPanel) openlistPanel.style.display = currentMode === 'openlist_manual' ? '' : 'none';
    if (selfAppPanel) selfAppPanel.style.display = currentMode === 'self_app' || currentMode === 'openlist_scan' ? '' : 'none';
    this.syncAuthClientIdUi(currentMode);
    if (currentMode === 'openlist_manual') {
      this.clearAuthPolling();
    }
  }

  private async syncAuthModePanelsFromStorage(): Promise<void> {
    try {
      const settings = await getSettings();
      const mode = settings?.drive115?.v2AuthMode === 'self_app'
        ? 'self_app'
        : settings?.drive115?.v2AuthMode === 'openlist_scan'
          ? 'openlist_scan'
          : 'openlist_manual';
      this.updateAuthModePanels(mode);
    } catch {
      this.updateAuthModePanels('openlist_manual');
    }
  }

  private clearAuthPolling(): void {
    if (this.authPollingTimer) {
      clearTimeout(this.authPollingTimer);
      this.authPollingTimer = undefined;
    }
  }

  private resetAuthSession(options?: { keepQr?: boolean; keepStatus?: boolean }): void {
    this.clearAuthPolling();
    this.authSession = null;
    if (!options?.keepQr) {
      this.setAuthQrContent('');
      this.setAuthDeviceMeta('');
    }
    if (!options?.keepStatus) {
      this.setAuthStatus('未开始授权', 'idle');
    }
  }

  private async persistAuthTokens(
    token: { access_token: string; refresh_token: string; expires_at: number | null },
    clientId: string,
    options?: { persistClientId?: boolean }
  ): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const patch: any = {
      v2AccessToken: (token.access_token || '').trim(),
      v2RefreshToken: (token.refresh_token || '').trim(),
      v2TokenExpiresAt: typeof token.expires_at === 'number' ? token.expires_at : null,
      v2RefreshTokenIssuedAtSec: nowSec,
      v2RefreshTokenStatus: 'valid',
      v2RefreshTokenLastError: undefined,
      v2RefreshTokenLastErrorCode: undefined,
      v2AccessTokenStatus: 'valid',
      v2AccessTokenLastError: undefined,
      v2AccessTokenLastErrorCode: undefined,
    };
    if (options?.persistClientId !== false) {
      patch.v2ClientId = clientId;
    }
    this.ctx?.update?.(patch);
    await this.ctx?.save?.();
    this.ctx?.updateUI?.();

    const accessTokenInput = document.getElementById('drive115V2AccessToken') as HTMLTextAreaElement | HTMLInputElement | null;
    const refreshTokenInput = document.getElementById('drive115V2RefreshToken') as HTMLTextAreaElement | HTMLInputElement | null;
    if (accessTokenInput) (accessTokenInput as any).value = patch.v2AccessToken;
    if (refreshTokenInput) (refreshTokenInput as any).value = patch.v2RefreshToken;
    this.scheduleAutoResize(['drive115V2AccessToken', 'drive115V2RefreshToken']);
    await this.updateRefreshIntervalUIFromStorage();
    await this.updateRefreshTokenStatusUI();
    await this.updateAccessTokenStatusUI();
  }

  private async startPkceAuthFlow(): Promise<void> {
    const currentMode = this.getCurrentAuthMode();
    const clientIdInput = document.getElementById('drive115V2ClientId') as HTMLInputElement | null;
    const clientId = currentMode === 'openlist_scan'
      ? this.decodeOpenlistScanClientId()
      : String(clientIdInput?.value || '').trim();
    if (!clientId) {
      this.setAuthStatus('请先填写 APP ID', 'error');
      showToast('请先填写 APP ID', 'error');
      return;
    }

    try {
      if (currentMode === 'self_app') {
        this.syncClientIdValue(clientId);
        await this.ctx?.save?.();
      }
      this.resetAuthSession({ keepStatus: true });
      this.setAuthStatus('正在生成二维码…', 'info');
      this.setAuthDeviceMeta('');
      const { codeVerifier, codeChallenge } = await generateDrive115PkcePair();
      const deviceCode = await requestDrive115DeviceCode(clientId, codeChallenge, 'sha256');
      this.authSession = {
        clientId,
        codeVerifier,
        uid: deviceCode.uid,
        time: deviceCode.time,
        sign: deviceCode.sign,
        qrcode: deviceCode.qrcode,
      };
      this.setAuthQrContent(buildDrive115QrImageUrl(deviceCode.qrcode));
      this.setAuthStatus('二维码已生成，请使用 115 手机客户端扫码', 'info');
      this.setAuthDeviceMeta(`设备码：${deviceCode.uid}`);
      this.pollPkceAuthStatus().catch(() => {});
    } catch (error: any) {
      const message = describe115Error(error) || error?.message || '生成二维码失败';
      this.resetAuthSession({ keepQr: false, keepStatus: true });
      this.setAuthStatus(message, 'error');
      showToast(message, 'error');
    }
  }

  private async finalizePkceAuth(session: NonNullable<Drive115V2Pane['authSession']>): Promise<void> {
    try {
      this.setAuthStatus('授权已确认，正在换取 token…', 'info');
      const token = await exchangeDrive115DeviceCode(session.uid, session.codeVerifier);
      await this.persistAuthTokens(token, session.clientId, {
        persistClientId: this.getCurrentAuthMode() === 'self_app',
      });

      const svc = getDrive115V2Service();
      const userInfo = await svc.fetchUserInfo(token.access_token);
      if (userInfo.success && userInfo.data) {
        this.renderUserInfo(userInfo.data);
        this.setUserInfoStatus('账号信息已更新', 'ok');
      } else {
        this.setUserInfoStatus(userInfo.message || 'token 已保存，账号信息待刷新', 'info');
      }

      this.setAuthStatus('授权成功，token 已保存', 'success');
      showToast('115 授权成功，token 已保存', 'success');
      this.resetAuthSession({ keepQr: true, keepStatus: true });
    } catch (error: any) {
      const message = describe115Error(error) || error?.message || '换取 token 失败';
      this.setAuthStatus(message, 'error');
      showToast(message, 'error');
      this.clearAuthPolling();
    }
  }

  private async pollPkceAuthStatus(): Promise<void> {
    const session = this.authSession;
    if (!session) return;

    try {
      const result = await pollDrive115DeviceStatus(session.uid, session.time, session.sign);
      if (!this.authSession || this.authSession.uid !== session.uid) return;

      if (result.state === 0) {
        this.setAuthStatus(result.msg || '二维码已失效，请重新生成', 'error');
        this.clearAuthPolling();
        return;
      }

      if (result.status === 1) {
        this.setAuthStatus(result.msg || '已扫码，请在 115 客户端确认授权', 'info');
      } else if (result.status === 2) {
        this.clearAuthPolling();
        await this.finalizePkceAuth(session);
        return;
      } else if (result.msg) {
        this.setAuthStatus(result.msg, 'info');
      }
    } catch (error: any) {
      const message = describe115Error(error) || error?.message || '轮询扫码状态失败';
      this.setAuthStatus(message, 'error');
      this.clearAuthPolling();
      return;
    }

    this.authPollingTimer = window.setTimeout(() => {
      this.pollPkceAuthStatus().catch(() => {});
    }, 1500);
  }


  private mediaLibraryBound = false;

  private async loadMediaLibraryRoots(): Promise<Array<{ cid: string; name?: string; path?: string; enabled: boolean }>> {
    try {
      const settings: any = await getSettings();
      const raw = settings?.drive115?.mediaLibraryRoots;
      if (!Array.isArray(raw)) return [];
      const byCid = new Map<string, { cid: string; name?: string; path?: string; enabled: boolean }>();
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const cid = String((item as any).cid || '').trim();
        if (!cid) continue;
        byCid.set(cid, {
          cid,
          name: typeof (item as any).name === 'string' ? (item as any).name : undefined,
          path: typeof (item as any).path === 'string' ? (item as any).path : undefined,
          enabled: (item as any).enabled !== false,
        });
      }
      return Array.from(byCid.values());
    } catch {
      return [];
    }
  }

  private async saveMediaLibraryRoots(
    roots: Array<{ cid: string; name?: string; path?: string; enabled: boolean }>,
  ): Promise<void> {
    const settings: any = await getSettings();
    const ns: any = { ...settings };
    ns.drive115 = { ...(settings?.drive115 || {}), mediaLibraryRoots: roots };
    await saveSettings(ns);
  }

  private normalizeMediaLibraryScanDepth(raw: unknown): number {
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed)) return 2;
    return Math.min(8, Math.max(1, parsed));
  }

  private async loadMediaLibraryScanDepth(): Promise<number> {
    try {
      const settings: any = await getSettings();
      return this.normalizeMediaLibraryScanDepth(settings?.drive115?.mediaLibraryScanDepth ?? 2);
    } catch {
      return 2;
    }
  }

  private async saveMediaLibraryScanDepth(depth: number): Promise<void> {
    const settings: any = await getSettings();
    const ns: any = { ...settings };
    ns.drive115 = { ...(settings?.drive115 || {}), mediaLibraryScanDepth: this.normalizeMediaLibraryScanDepth(depth) };
    await saveSettings(ns);
  }

  private syncMediaLibraryScanDepthUi(depth: number): void {
    const normalized = this.normalizeMediaLibraryScanDepth(depth);
    const input = document.getElementById('drive115MediaLibraryScanDepth') as HTMLInputElement | null;
    const hint = document.getElementById('drive115MediaLibraryScanDepthHint');
    if (input) input.value = String(normalized);
    if (hint) hint.textContent = `当前会向下扫描 ${normalized} 层目录。`;
  }

  private async renderMediaLibraryMeta(): Promise<void> {
    const lastEl = document.getElementById('drive115MediaLibraryLastIndex');
    const errEl = document.getElementById('drive115MediaLibraryLastError') as HTMLElement | null;
    try {
      const settings: any = await getSettings();
      const ts = Number(settings?.drive115?.mediaLibraryLastIndexAt || 0);
      if (lastEl) {
        lastEl.textContent = ts
          ? `上次索引：${new Date(ts).toLocaleString()}`
          : '上次索引：尚未索引';
      }
      const err = String(settings?.drive115?.mediaLibraryLastIndexError || '').trim();
      if (errEl) {
        if (err) {
          errEl.style.display = '';
          errEl.textContent = `上次错误：${err}`;
        } else {
          errEl.style.display = 'none';
          errEl.textContent = '';
        }
      }
    } catch {
      /* ignore */
    }
  }

  private async renderMediaLibraryRoots(): Promise<void> {
    const listEl = document.getElementById('drive115MediaLibraryRootsList');
    const emptyEl = document.getElementById('drive115MediaLibraryRootsEmpty') as HTMLElement | null;
    if (!listEl) return;
    const roots = await this.loadMediaLibraryRoots();
    listEl.innerHTML = '';
    if (!roots.length) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    for (const root of roots) {
      const li = document.createElement('li');
      li.className = 'drive115-media-library-root-item';
      li.dataset.cid = root.cid;
      const title = root.name || root.path || root.cid;
      const pathHtml =
        root.path && root.path !== root.name
          ? `<span class="root-path">${this.escapeHtml(root.path)}</span>`
          : '';
      li.innerHTML = `
        <label class="drive115-toggle-label" style="margin:0; display:inline-flex; align-items:center; gap:6px;">
          <input type="checkbox" class="drive115-ml-enabled" ${root.enabled !== false ? 'checked' : ''} />
          <span class="drive115-toggle-text" style="font-size:12.5px;">启用</span>
        </label>
        <div class="root-main">
          <div class="root-title">${this.escapeHtml(title)}</div>
          <div class="root-meta">
            ${pathHtml}
            <code>${this.escapeHtml(root.cid)}</code>
          </div>
        </div>
        <button type="button" class="button-like secondary drive115-ml-remove">移除</button>
      `;
      listEl.appendChild(li);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
  }

  private bindMediaLibrarySection(): void {
    if (this.mediaLibraryBound) {
      void this.renderMediaLibraryRoots();
      void this.renderMediaLibraryMeta();
      return;
    }
    this.mediaLibraryBound = true;

    const addBtn = document.getElementById('drive115AddMediaLibraryRoot') as HTMLButtonElement | null;
    addBtn?.addEventListener('click', () => {
      openDrive115FolderPicker({
        initialCid: '',
        onSelect: async (selection) => {
          const cid = String(selection.cid || '').trim();
          if (!cid) return;
          const roots = await this.loadMediaLibraryRoots();
          const next = roots.filter((r) => r.cid !== cid);
          next.push({
            cid,
            name: selection.name || undefined,
            path: selection.path || undefined,
            enabled: true,
          });
          await this.saveMediaLibraryRoots(next);
          await this.renderMediaLibraryRoots();
          showToast(`已添加片库目录：${selection.path || selection.name || cid}`, 'success');
        },
      });
    });

    const listEl = document.getElementById('drive115MediaLibraryRootsList');
    listEl?.addEventListener('click', async (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const item = target.closest('.drive115-media-library-root-item') as HTMLElement | null;
      if (!item) return;
      const cid = String(item.dataset.cid || '').trim();
      if (!cid) return;
      if (target.closest('.drive115-ml-remove')) {
        const roots = (await this.loadMediaLibraryRoots()).filter((r) => r.cid !== cid);
        await this.saveMediaLibraryRoots(roots);
        await this.renderMediaLibraryRoots();
        showToast('已移除片库目录', 'success');
      }
    });

    listEl?.addEventListener('change', async (ev) => {
      const target = ev.target as HTMLInputElement | null;
      if (!target || !target.classList.contains('drive115-ml-enabled')) return;
      const item = target.closest('.drive115-media-library-root-item') as HTMLElement | null;
      if (!item) return;
      const cid = String(item.dataset.cid || '').trim();
      if (!cid) return;
      const roots = await this.loadMediaLibraryRoots();
      const next = roots.map((r) => (r.cid === cid ? { ...r, enabled: target.checked } : r));
      await this.saveMediaLibraryRoots(next);
    });

    const scanDepthInput = document.getElementById('drive115MediaLibraryScanDepth') as HTMLInputElement | null;
    const persistScanDepth = async (forceBackfill = false): Promise<void> => {
      if (!scanDepthInput) return;
      const raw = (scanDepthInput.value || '').trim();
      if (!forceBackfill && raw === '') return;
      const depth = this.normalizeMediaLibraryScanDepth(raw || 2);
      this.syncMediaLibraryScanDepthUi(depth);
      await this.saveMediaLibraryScanDepth(depth);
    };
    scanDepthInput?.addEventListener('input', () => {
      persistScanDepth(false).catch(() => {});
    });
    scanDepthInput?.addEventListener('change', () => {
      persistScanDepth(true).catch(() => {});
    });

    const indexBtn = document.getElementById('drive115IndexMediaLibrary') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('drive115CancelMediaLibraryIndex') as HTMLButtonElement | null;
    const progressEl = document.getElementById('drive115MediaLibraryProgress') as HTMLElement | null;
    const originalIndexHtml = indexBtn?.innerHTML || '<i class="fas fa-sync"></i> 立即索引';
    const setIndexingUi = (running: boolean): void => {
      if (indexBtn) {
        indexBtn.disabled = running;
        indexBtn.innerHTML = running ? '<i class="fas fa-spinner fa-spin"></i> 索引中…' : originalIndexHtml;
      }
      if (cancelBtn) {
        cancelBtn.style.display = running ? '' : 'none';
        cancelBtn.disabled = false;
      }
      if (scanDepthInput) scanDepthInput.disabled = running;
    };

    cancelBtn?.addEventListener('click', async () => {
      if (!cancelBtn || cancelBtn.disabled) return;
      cancelBtn.disabled = true;
      if (progressEl) {
        progressEl.style.display = '';
        progressEl.textContent = '正在取消索引…';
      }
      try {
        const resp: any = await sendRuntimeMessage({ type: 'DRIVE115_MEDIA_LIBRARY_CANCEL_INDEX' });
        if (resp?.success) {
          const msg = resp.message || '已请求取消索引，正在保存已扫结果…';
          if (progressEl) progressEl.textContent = msg;
          if (resp.running === false) setIndexingUi(false);
          showToast(msg, resp.running === false ? 'info' : 'success');
        } else {
          const msg = resp?.message || '取消索引失败';
          if (progressEl) progressEl.textContent = msg;
          showToast(msg, 'error');
          cancelBtn.disabled = false;
        }
      } catch (e: any) {
        const msg = e?.message || String(e) || '取消索引失败';
        if (progressEl) progressEl.textContent = msg;
        showToast(msg, 'error');
        cancelBtn.disabled = false;
      }
    });

    indexBtn?.addEventListener('click', async () => {
      if (!indexBtn || indexBtn.disabled) return;
      const roots = (await this.loadMediaLibraryRoots()).filter((r) => r.enabled !== false);
      if (!roots.length) {
        showToast('请先添加并启用至少一个片库根目录', 'error');
        return;
      }
      await persistScanDepth(true);
      setIndexingUi(true);
      if (progressEl) {
        progressEl.style.display = '';
        progressEl.textContent = `正在按 ${this.normalizeMediaLibraryScanDepth(scanDepthInput?.value || 2)} 层深度限频索引…`;
      }
      try {
        const resp: any = await sendRuntimeMessage({ type: 'DRIVE115_MEDIA_LIBRARY_INDEX' }).catch((e: any) => ({
          success: false,
          message: e?.message || String(e),
        }));
        await this.renderMediaLibraryMeta();
        if (resp?.cancelled) {
          const msg = resp.message || '索引已取消';
          if (progressEl) progressEl.textContent = msg;
          showToast(msg, 'info');
        } else if (resp?.success) {
          const stats = resp.stats || resp.state?.stats;
          const detail = stats
            ? `入库 ${stats.indexed || 0}，跳过 ${stats.skipped || 0}，API ${stats.apiCalls || 0}`
            : resp.message || '完成';
          if (progressEl) progressEl.textContent = detail;
          showToast(`115 索引完成：${detail}`, 'success');
        } else {
          const msg = resp?.message || '索引失败';
          if (progressEl) progressEl.textContent = msg;
          const kept = resp?.keptPrevious ? '（已保留上一份索引）' : '';
          showToast(`${msg}${kept}`, 'error');
        }
      } finally {
        setIndexingUi(false);
      }
    });

    void this.loadMediaLibraryScanDepth().then((depth) => this.syncMediaLibraryScanDepthUi(depth));
    void this.renderMediaLibraryRoots();
    void this.renderMediaLibraryMeta();
  }


  private bindEvents(): void {
    this.bindMediaLibrarySection();
    // 工具：自适应高度（封装为类方法）

    // v2 接口域名输入
    const v2ApiBaseUrlInput = document.getElementById('drive115V2ApiBaseUrl') as HTMLInputElement | null;
    v2ApiBaseUrlInput?.addEventListener('input', () => {
      const val = (v2ApiBaseUrlInput?.value || '').trim();
      this.ctx?.update({ v2ApiBaseUrl: val });
      this.ctx?.save?.();
    });

    // 自动刷新开关
    const v2ClientIdInput = document.getElementById('drive115V2ClientId') as HTMLInputElement | null;
    v2ClientIdInput?.addEventListener('input', () => {
      if (this.getCurrentAuthMode() !== 'self_app') return;
      const val = (v2ClientIdInput?.value || '').trim();
      this.syncClientIdValue(val);
      this.ctx?.save?.();
    });

    const authModeSelect = document.getElementById('drive115V2AuthMode') as HTMLSelectElement | null;
    const onAuthModeChange = async (mode: 'openlist_manual' | 'openlist_scan' | 'self_app') => {
      this.ctx?.update?.({ v2AuthMode: mode } as any);
      this.updateAuthModePanels(mode);
      await this.ctx?.save?.();
      this.ctx?.updateUI?.();
    };
    authModeSelect?.addEventListener('change', () => {
      const value = authModeSelect.value;
      const mode = value === 'self_app'
        ? 'self_app'
        : value === 'openlist_scan'
          ? 'openlist_scan'
          : 'openlist_manual';
      onAuthModeChange(mode).catch(() => {});
    });

    const openlistManualOpenBtn = document.getElementById('drive115V2OpenlistManualOpen') as HTMLButtonElement | null;
    openlistManualOpenBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
          chrome.tabs.create({ url: OPENLIST_MANUAL_URL, active: true });
          return;
        }
      } catch {}
      window.open(OPENLIST_MANUAL_URL, '_blank');
    });

    const openlistManualCopyBtn = document.getElementById('drive115V2OpenlistManualCopy') as HTMLButtonElement | null;
    openlistManualCopyBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(OPENLIST_MANUAL_URL);
        showToast('已复制 OpenList 获取地址', 'success');
      } catch {
        showToast('复制失败，请手动复制地址', 'error');
      }
    });

    const startAuthBtn = document.getElementById('drive115V2StartAuth') as HTMLButtonElement | null;
    const onStartAuth = async (e: Event) => {
      e.preventDefault();
      if (startAuthBtn) startAuthBtn.disabled = true;
      const sharedStartBtn = document.getElementById('drive115V2StartAuthShared') as HTMLButtonElement | null;
      if (sharedStartBtn) sharedStartBtn.disabled = true;
      try {
        await this.startPkceAuthFlow();
      } finally {
        if (startAuthBtn) startAuthBtn.disabled = false;
        if (sharedStartBtn) sharedStartBtn.disabled = false;
      }
    };
    startAuthBtn?.addEventListener('click', onStartAuth);
    const startAuthSharedBtn = document.getElementById('drive115V2StartAuthShared') as HTMLButtonElement | null;
    startAuthSharedBtn?.addEventListener('click', onStartAuth);

    const cancelAuthBtn = document.getElementById('drive115V2CancelAuth') as HTMLButtonElement | null;
    const onCancelAuth = (e: Event) => {
      e.preventDefault();
      this.resetAuthSession();
    };
    cancelAuthBtn?.addEventListener('click', onCancelAuth);
    const cancelAuthSharedBtn = document.getElementById('drive115V2CancelAuthShared') as HTMLButtonElement | null;
    cancelAuthSharedBtn?.addEventListener('click', onCancelAuth);

    const v2AutoRefreshCheckbox = document.getElementById('drive115V2AutoRefresh') as HTMLInputElement | null;
    v2AutoRefreshCheckbox?.addEventListener('change', () => {
      const v = !!v2AutoRefreshCheckbox.checked;
      this.ctx?.update({ v2AutoRefresh: v });
      this.ctx?.save?.();
    });
    // 限制点击范围：点击文字不触发切换，仅允许点击开关
    try {
      const toggleText = document.querySelector('#drive115V2Pane .drive115-toggle-text') as HTMLElement | null;
      toggleText?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
    } catch {}

    // 提前刷新秒数
    const v2AutoRefreshSkewInput = document.getElementById('drive115V2AutoRefreshSkewSec') as HTMLInputElement | null;
    const onSkewChange = () => {
      const raw = (v2AutoRefreshSkewInput?.value || '').trim();
      const n = Math.max(0, Math.floor(Number(raw) || 0));
      this.ctx?.update({ v2AutoRefreshSkewSec: n });
      this.ctx?.save?.();
      // 更新“下次自动刷新时间”
      this.updateRefreshIntervalUIFromStorage();
      this.bindMediaLibrarySection();
    };
    v2AutoRefreshSkewInput?.addEventListener('change', onSkewChange);
    v2AutoRefreshSkewInput?.addEventListener('input', onSkewChange);

    // 动态注入：最小自动刷新间隔（分钟，60-120）+ 最近/下次自动刷新时间（只读展示）
    this.injectRefreshIntervalUI();

    // access_token 输入（兼容 input 或 textarea）
    const v2AccessTokenInput = document.getElementById('drive115V2AccessToken') as (HTMLInputElement | HTMLTextAreaElement | null);
    v2AccessTokenInput?.addEventListener('input', () => {
      const val = (v2AccessTokenInput as any).value || '';
      const trimmed = (val as string).trim();
      // 当手动修改 access_token 时：
      // 1) 持久化新的 access_token
      // 2) 清空到期时间，避免把“手动填写”误显示成“已验证且 2 小时后过期”
      // 3) 后续由真实接口调用结果回填到期时间与状态
      this.ctx?.update({
        v2AccessToken: trimmed,
        v2TokenExpiresAt: (trimmed ? ((this.ctx as any)?.settings?.v2TokenExpiresAt ?? null) : null),
        v2AccessTokenStatus: trimmed ? 'unknown' : 'unknown',
        v2AccessTokenLastError: undefined,
        v2AccessTokenLastErrorCode: undefined,
        v2UserInfoExpired: false as any,
      } as any);
      this.ctx?.save?.();
      this.ctx?.updateUI?.();
      this.updateAccessTokenStatusUI();
      if (v2AccessTokenInput && 'rows' in v2AccessTokenInput) this.autoResize(v2AccessTokenInput as HTMLTextAreaElement);
    });
    // 初始也调整一次高度
    if (v2AccessTokenInput && 'rows' in v2AccessTokenInput) this.autoResize(v2AccessTokenInput as HTMLTextAreaElement);

    // refresh_token 输入（兼容 input 或 textarea）
    const v2RefreshTokenInput = document.getElementById('drive115V2RefreshToken') as (HTMLInputElement | HTMLTextAreaElement | null);
    v2RefreshTokenInput?.addEventListener('input', () => {
      const val = (v2RefreshTokenInput as any).value || '';
      const trimmed = (val as string).trim();
      const nowSec = Math.floor(Date.now() / 1000);
      this.ctx?.update({ 
        v2RefreshToken: trimmed,
        v2RefreshTokenIssuedAtSec: trimmed ? nowSec : null,
        v2RefreshTokenStatus: 'unknown',
        v2RefreshTokenLastError: undefined,
        v2RefreshTokenLastErrorCode: undefined,
      } as any);
      this.ctx?.save?.();
      this.updateRefreshTokenStatusUI();
      this.updateAccessTokenStatusUI();
      this.scheduleRefreshTokenValidation();
      if (v2RefreshTokenInput && 'rows' in v2RefreshTokenInput) this.autoResize(v2RefreshTokenInput as HTMLTextAreaElement);
    });
    if (v2RefreshTokenInput && 'rows' in v2RefreshTokenInput) this.autoResize(v2RefreshTokenInput as HTMLTextAreaElement);
    
    // 初始化时显示 token 状态
    this.updateRefreshTokenStatusUI();
    this.updateAccessTokenStatusUI();

    // 绑定后调度多次自适应，覆盖异步填充值
    this.scheduleAutoResize(['drive115V2AccessToken', 'drive115V2RefreshToken']);

    // 窗口大小变化时也重新计算
    window.addEventListener('resize', () => {
      this.scheduleAutoResize(['drive115V2AccessToken', 'drive115V2RefreshToken']);
    });

    const validateTokenBtn = document.getElementById('drive115V2ValidateToken') as HTMLButtonElement | null;
    validateTokenBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const originalText = validateTokenBtn.textContent || '验证有效性';
      try {
        validateTokenBtn.disabled = true;
        validateTokenBtn.textContent = '验证中...';
        this.setUserInfoStatus('获取用户信息中…', 'info');
        const svc = getDrive115V2Service();
        const userInfo = await svc.fetchUserInfoAuto({ forceAutoRefresh: true });
        if (!userInfo.success || !userInfo.data) {
          const msg = describe115Error((userInfo as any).raw) || userInfo.message || '验证失败';
          this.setUserInfoStatus(msg, 'error');
          showToast(msg, 'error');
          this.updateRefreshTokenStatusUI();
          this.updateAccessTokenStatusUI();
          return;
        }

        const latestSettings = await getSettings();
        const drv = (latestSettings?.drive115 || {}) as any;
        if (v2AccessTokenInput) (v2AccessTokenInput as any).value = drv.v2AccessToken || '';
        if (v2RefreshTokenInput) (v2RefreshTokenInput as any).value = drv.v2RefreshToken || '';
        this.ctx?.update?.({
          v2AccessToken: (drv.v2AccessToken || '').trim(),
          v2RefreshToken: (drv.v2RefreshToken || '').trim(),
          v2TokenExpiresAt: (typeof drv.v2TokenExpiresAt === 'number' ? drv.v2TokenExpiresAt : null),
          v2RefreshTokenIssuedAtSec: Number(drv.v2RefreshTokenIssuedAtSec || drv.v2LastTokenRefreshAtSec || 0) || null,
          v2RefreshTokenStatus: 'valid',
          v2RefreshTokenLastError: undefined,
          v2RefreshTokenLastErrorCode: undefined,
          v2AccessTokenStatus: 'valid',
          v2AccessTokenLastError: undefined,
          v2AccessTokenLastErrorCode: undefined,
        } as any);
        await this.ctx?.save?.();
        this.ctx?.updateUI?.();
        this.scheduleAutoResize(['drive115V2AccessToken', 'drive115V2RefreshToken']);
        this.updateRefreshTokenStatusUI();
        this.updateAccessTokenStatusUI();
        this.renderUserInfo(userInfo.data);
        this.setUserInfoStatus('已验证并更新用户信息', 'ok');
        showToast('已验证有效性', 'success');
      } catch (err: any) {
        const msg = describe115Error(err) || err?.message || '验证失败';
        this.setUserInfoStatus(msg, 'error');
        showToast(msg, 'error');
      } finally {
        validateTokenBtn.disabled = false;
        validateTokenBtn.textContent = originalText;
      }
    });

    // 手动刷新按钮：调用刷新接口，成功后回填两个 token 并记录过期时间
    const manualRefreshBtn = document.getElementById('drive115V2ManualRefresh') as HTMLButtonElement | null;
    manualRefreshBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const rt = (((v2RefreshTokenInput as any)?.value) || '').trim();
      // 当缺少 refresh_token 时：给出指引页
      if (!rt) {
        try {
          const masked = '（未填写）';
          const helpHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>115 手动刷新帮助</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Microsoft YaHei',sans-serif;padding:16px;line-height:1.6;color:#1f2937} code{background:#f3f4f6;padding:2px 4px;border-radius:4px} .ok{color:#16a34a} .warn{color:#d97706} .err{color:#dc2626}</style></head><body><h2>115 手动刷新指引</h2><ol><li>refresh_token：<strong class="err">${masked}</strong></li><li>请返回设置页填写 refresh_token 后再试。</li></ol></body></html>`;
          const url = 'data:text/html;charset=UTF-8,' + encodeURIComponent(helpHtml);
          window.open(url, '_blank');
        } catch {}
        this.setUserInfoStatus('请先填写 refresh_token', 'error');
        return;
      }
      // 已填写 refresh_token：不打开新窗口，直接在当前页执行刷新
      try {
        await navigator.clipboard.writeText(rt);
        showToast('已复制 refresh_token 到剪贴板', 'success');
      } catch {}
      // 限频校验：手动刷新也受“最小自动刷新间隔(分钟)”限制（不低于30）
      const allow = await this.isManualRefreshAllowed_();
      if (!allow) return;
      this.setUserInfoStatus('刷新中…', 'info');
      try {
        const svc = getDrive115V2Service();
        const ret = await svc.refreshToken(rt);
        if (!ret.success || !ret.token) {
          const msg = describe115Error((ret as any).raw) || ret.message || '刷新失败';
          this.setUserInfoStatus(msg, 'error');
          showToast(msg, 'error');
          return;
        }
        // 回填新的 token
        const { access_token, refresh_token, expires_at } = ret.token as any;
        if (v2AccessTokenInput) (v2AccessTokenInput as any).value = access_token || '';
        if (v2RefreshTokenInput) (v2RefreshTokenInput as any).value = refresh_token || '';
        // 同步到上下文并保存
        this.ctx?.update({ 
          v2AccessToken: (access_token || '').trim(), 
          v2RefreshToken: (refresh_token || '').trim(),
          v2TokenExpiresAt: (typeof expires_at === 'number' ? expires_at : null),
          v2RefreshTokenIssuedAtSec: Math.floor(Date.now() / 1000),
          v2RefreshTokenStatus: 'valid',
          v2RefreshTokenLastError: undefined,
          v2RefreshTokenLastErrorCode: undefined,
          v2AccessTokenStatus: 'valid',
          v2AccessTokenLastError: undefined,
          v2AccessTokenLastErrorCode: undefined,
        });
        this.ctx?.save?.();
        // 写入“最近接口刷新时间”，并确保最小间隔配置不低于30
        try {
          const nowSec = Math.floor(Date.now() / 1000);
          const settings: any = await getSettings();
          const ns: any = { ...settings };
          const rawMin = Number((settings?.drive115 || {}).v2MinRefreshIntervalMin ?? 60) || 60;
          const minMin = Math.min(120, Math.max(60, rawMin));
          ns.drive115 = {
            ...(settings?.drive115 || {}),
            v2LastTokenRefreshAtSec: nowSec,
            v2RefreshTokenIssuedAtSec: nowSec,
            v2MinRefreshIntervalMin: minMin,
          };
          await saveSettings(ns);
          // 同步刷新 UI 的“最近/下次自动刷新时间”
          await this.updateRefreshIntervalUIFromStorage();
        } catch {}
        // 立即刷新UI以更新到期时间显示
        this.ctx?.updateUI?.();
        // 自适应高度
        this.scheduleAutoResize(['drive115V2AccessToken', 'drive115V2RefreshToken']);
        // 更新 refresh_token 状态显示
        this.updateRefreshTokenStatusUI();
        this.updateAccessTokenStatusUI();
        this.setUserInfoStatus('已刷新 access_token', 'ok');
        showToast('已刷新 access_token', 'success');
      } catch (err: any) {
        const msg = describe115Error(err) || err?.message || '刷新失败';
        this.setUserInfoStatus(msg, 'error');
        showToast(msg, 'error');
      }
    });

    const downloadDirInput = document.getElementById('drive115DownloadDir') as HTMLInputElement | null;
    const downloadDirSummary = document.getElementById('drive115DownloadDirSummary') as HTMLDivElement | null;
    const skipManualPickerInput = document.getElementById('drive115SkipManualPushDirectoryPicker') as HTMLInputElement | null;
    const syncSkipManualPickerAvailability = (): void => {
      if (!skipManualPickerInput) return;
      const cid = (downloadDirInput?.value || '').trim();
      const hasDefaultDirectory = cid !== '' && cid !== '0';
      skipManualPickerInput.disabled = !hasDefaultDirectory;
      if (!hasDefaultDirectory) skipManualPickerInput.checked = false;
    };
    const renderDownloadDirSummary = (name?: string, path?: string, cid?: string) => {
      if (!downloadDirSummary) return;
      const displayName = String(name || '').trim();
      const displayPath = String(path || '').trim();
      const displayCid = String(cid || '').trim();
      if (!displayName && !displayPath) {
        downloadDirSummary.style.display = 'none';
        downloadDirSummary.textContent = '';
        return;
      }
      downloadDirSummary.style.display = 'flex';
      downloadDirSummary.innerHTML = `
        <i class="fas fa-folder-open"></i>
        <span>${displayName || displayPath}</span>
        ${displayCid ? `<code>${displayCid}</code>` : ''}
      `;
      downloadDirSummary.title = displayPath || displayName;
    };

    // 下载目录 ID 是全局默认推送目录；旧 defaultWpPathId 仅用于首次回填兼容。
    if (downloadDirInput) {
      // 初次回填默认值
      getSettings().then((settings: any) => {
        const def = (settings?.drive115?.downloadDir ?? settings?.drive115?.defaultWpPathId ?? '').toString();
        downloadDirInput.value = def;
        if (skipManualPickerInput) {
          skipManualPickerInput.checked = settings?.drive115?.skipManualPushDirectoryPicker === true;
        }
        syncSkipManualPickerAvailability();
        renderDownloadDirSummary(settings?.drive115?.downloadDirName, settings?.drive115?.downloadDirPath, def);
      }).catch(() => {});
      // 变更时保存
      const onDownloadDirChange = async () => {
        try {
          const val = (downloadDirInput.value || '').trim();
          const settings: any = await getSettings();
          const ns: any = { ...settings };
          ns.drive115 = { ...(settings?.drive115 || {}), downloadDir: val };
          delete ns.drive115.defaultWpPathId;
          delete ns.drive115.downloadDirName;
          delete ns.drive115.downloadDirPath;
          await saveSettings(ns);
          syncSkipManualPickerAvailability();
          renderDownloadDirSummary('', '', val);
        } catch {}
      };
      downloadDirInput.addEventListener('input', onDownloadDirChange);
      downloadDirInput.addEventListener('change', onDownloadDirChange);
    }

    skipManualPickerInput?.addEventListener('change', async () => {
      try {
        const cid = (downloadDirInput?.value || '').trim();
        const enabled = skipManualPickerInput.checked && cid !== '' && cid !== '0';
        skipManualPickerInput.checked = enabled;
        const settings: any = await getSettings();
        const ns: any = { ...settings };
        ns.drive115 = {
          ...(settings?.drive115 || {}),
          skipManualPushDirectoryPicker: enabled,
        };
        await saveSettings(ns);
      } catch {}
    });

    const chooseDownloadDirBtn = document.getElementById('drive115ChooseDownloadDir') as HTMLButtonElement | null;
    chooseDownloadDirBtn?.addEventListener('click', () => {
      openDrive115FolderPicker({
        initialCid: (downloadDirInput?.value || '').trim(),
        onSelect: async (selection) => {
          if (downloadDirInput) downloadDirInput.value = selection.cid;
          const settings: any = await getSettings();
          const ns: any = { ...settings };
          ns.drive115 = {
            ...(settings?.drive115 || {}),
            downloadDir: selection.cid,
            downloadDirName: selection.name,
            downloadDirPath: selection.path,
          };
          delete ns.drive115.defaultWpPathId;
          await saveSettings(ns);
          syncSkipManualPickerAvailability();
          renderDownloadDirSummary(selection.name, selection.path, selection.cid);
          showToast(`已选择目录：${selection.path}`, 'success');
        },
      });
    });
  }

  mount(): void {
    this.getElement();
    this.bindEvents();
    this.syncAuthModePanelsFromStorage().catch(() => {});
    this.setAuthStatus('未开始授权', 'idle');
    this.setAuthQrContent('');
    this.setAuthDeviceMeta('');
  }

  unmount(): void {
    this.resetAuthSession();
    // 目前为直接绑定，卸载时不做特殊清理（面板整体销毁时由容器负责）
  }

  show(): void {
    const el = this.getElement();
    if (el) {
      el.style.display = '';
      this.syncAuthModePanelsFromStorage().catch(() => {});
      // 面板从隐藏转为可见后再计算高度，避免 hidden 状态下 scrollHeight 过小
      setTimeout(() => {
        this.scheduleAutoResize(['drive115V2AccessToken', 'drive115V2RefreshToken']);
      }, 0);
      // 显示时优先渲染已缓存的 115 用户信息，并尝试后台刷新
      this.renderCachedAndMaybeRefresh();
      // 同步刷新限频UI显示
      this.updateRefreshIntervalUIFromStorage();
      // 更新 refresh_token 状态显示
      this.updateRefreshTokenStatusUI();
    }
  }

  private refreshTokenValidationTimer: number | undefined;

  private scheduleRefreshTokenValidation(): void {
    if (this.refreshTokenValidationTimer) {
      clearTimeout(this.refreshTokenValidationTimer);
    }
    this.refreshTokenValidationTimer = window.setTimeout(() => {
      this.validateRefreshTokenFromUserInput().catch(() => {});
    }, 500);
  }

  private async validateRefreshTokenFromUserInput(): Promise<void> {
    try {
      const rtInput = document.getElementById('drive115V2RefreshToken') as HTMLTextAreaElement | HTMLInputElement | null;
      const refreshToken = ((rtInput as any)?.value || '').trim();
      if (!refreshToken) {
        this.ctx?.update?.({
          v2RefreshTokenStatus: 'unknown',
          v2RefreshTokenLastError: undefined,
          v2RefreshTokenLastErrorCode: undefined,
        } as any);
        this.ctx?.save?.();
        this.updateRefreshTokenStatusUI();
        this.updateAccessTokenStatusUI();
        return;
      }

      const settings = await getSettings();
      const accessToken = ((settings as any)?.drive115?.v2AccessToken || '').trim();
      if (!accessToken) {
        this.ctx?.update?.({
          v2RefreshTokenStatus: 'unknown',
          v2RefreshTokenLastError: undefined,
          v2RefreshTokenLastErrorCode: undefined,
        } as any);
        await this.ctx?.save?.();
        this.updateRefreshTokenStatusUI();
        this.updateAccessTokenStatusUI();
        this.setUserInfoStatus('已填写 refresh_token，等待 access_token 验证', 'info');
        return;
      }

      this.setUserInfoStatus('校验 access_token…', 'info');
      const svc = getDrive115V2Service();
      const startedAt = Date.now();
      const userInfo = await svc.fetchUserInfo(accessToken);
      if (!userInfo.success || !userInfo.data) {
        const msg = describe115Error((userInfo as any).raw) || userInfo.message || 'access_token 校验失败';
        this.setUserInfoStatus(msg, 'error');
        this.updateRefreshTokenStatusUI();
        this.updateAccessTokenStatusUI();
        return;
      }

      const elapsedSec = Math.max(1, Math.ceil((Date.now() - startedAt) / 1000));
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = nowSec + Math.max(0, 7200 - elapsedSec);
      this.ctx?.update?.({
        v2RefreshTokenStatus: 'valid',
        v2RefreshTokenLastError: undefined,
        v2RefreshTokenLastErrorCode: undefined,
        v2AccessTokenStatus: 'valid',
        v2AccessTokenLastError: undefined,
        v2AccessTokenLastErrorCode: undefined,
        v2TokenExpiresAt: expiresAt,
      } as any);
      await this.ctx?.save?.();
      this.ctx?.updateUI?.();
      this.updateRefreshTokenStatusUI();
      this.updateAccessTokenStatusUI();
      this.renderUserInfo(userInfo.data);
      this.setUserInfoStatus('已验证并更新用户信息', 'ok');
    } catch (e: any) {
      this.setUserInfoStatus(describe115Error(e) || e?.message || 'refresh_token 校验失败', 'error');
    }
  }

  /**
   * 更新 refresh_token 状态显示
   */
  private async updateRefreshTokenStatusUI(): Promise<void> {
    try {
      const settings = await getSettings();
      const drv = (settings?.drive115 || {}) as any;
      const status = drv.v2RefreshTokenStatus || 'unknown';
      const lastError = drv.v2RefreshTokenLastError;
      const lastErrorCode = drv.v2RefreshTokenLastErrorCode;
      const refreshToken = (drv.v2RefreshToken || '').trim();
      const nowSec = Math.floor(Date.now() / 1000);
      const issuedAt = Number(drv.v2RefreshTokenIssuedAtSec || drv.v2LastTokenRefreshAtSec || 0) || 0;
      const refreshExpireAt = issuedAt > 0 ? (issuedAt + 365 * 24 * 60 * 60) : 0;

      // 查找 label 元素
      const formGroup = document.getElementById('drive115V2RefreshToken')?.closest('.form-group');
      const label = formGroup?.querySelector('label[for="drive115V2RefreshToken"]');
      if (!label) return;
      label.childNodes[0] && ((label.childNodes[0] as any).textContent = 'refresh_token:');
      const statusRow = document.getElementById('drive115V2RefreshTokenStatusRow');
      if (!statusRow) return;
      
      let statusEl = document.getElementById('drive115V2RefreshTokenStatus') as HTMLSpanElement | null;
      if (!statusEl) {
        statusEl = document.createElement('span');
        statusEl.id = 'drive115V2RefreshTokenStatus';
        statusEl.style.cssText = 'display:inline-block; margin-left:8px; font-size:11px; padding:2px 8px; border-radius:4px; vertical-align:middle;';
        statusRow.appendChild(statusEl);
      }

      if (!refreshToken) {
        statusEl.textContent = '未填写';
        statusEl.style.color = '#757575';
        statusEl.style.background = '#f5f5f5';
        statusEl.title = '请填写 refresh_token 以便刷新 access_token';
        return;
      }

      if (status === 'invalid') {
        statusEl.textContent = '无效';
        statusEl.style.color = '#c62828';
        statusEl.style.background = '#ffebee';
        statusEl.title = lastError ? `${lastError}${lastErrorCode ? ` (错误码 ${lastErrorCode})` : ''}` : '需要重新授权获取 refresh_token';
        return;
      }

      if (status === 'expired') {
        statusEl.textContent = '已过期';
        statusEl.style.color = '#d84315';
        statusEl.style.background = '#fbe9e7';
        statusEl.title = lastError ? `${lastError}${lastErrorCode ? ` (错误码 ${lastErrorCode})` : ''}` : '需要重新授权获取 refresh_token';
        return;
      }

      if (refreshExpireAt > nowSec) {
        statusEl.textContent = `${this.formatDateOnly(refreshExpireAt)}（${this.formatRemainingDays(refreshExpireAt - nowSec)}）有效`;
        statusEl.style.color = '#2e7d32';
        statusEl.style.background = '#e8f5e9';
        statusEl.title = `refresh_token 预计有效至 ${this.formatLocalDateTime(refreshExpireAt)}`;
        return;
      }

      if (status === 'valid') {
        statusEl.textContent = '有效';
        statusEl.style.color = '#2e7d32';
        statusEl.style.background = '#e8f5e9';
        statusEl.title = 'refresh_token 当前可用于刷新 access_token';
        return;
      }

      statusEl.textContent = '未验证';
      statusEl.style.color = '#8d6e63';
      statusEl.style.background = '#efebe9';
      statusEl.title = '已填写 refresh_token，但尚未通过脚本校验；你可以点击验证有效性，或在自动刷新 access_token 时触发校验';
    } catch (e) {
      // 静默失败
    }
  }

  private async updateAccessTokenStatusUI(): Promise<void> {
    const statusEl = document.getElementById('drive115V2AccessTokenStatus') as HTMLSpanElement | null;
    if (!statusEl) return;
    const settings = await getSettings();
    const drv = (settings?.drive115 || {}) as any;
    const token = String(drv.v2AccessToken || '').trim();
    const status = drv.v2AccessTokenStatus || 'unknown';

    if (!token) {
      statusEl.textContent = '';
      statusEl.style.display = 'none';
      return;
    }

    statusEl.style.display = 'inline-flex';
    if (status === 'valid') {
      statusEl.textContent = '可用';
      statusEl.style.color = '#2e7d32';
      statusEl.style.background = '#e8f5e9';
      return;
    }

    if (status === 'expired') {
      statusEl.textContent = '已过期';
      statusEl.style.color = '#d84315';
      statusEl.style.background = '#fbe9e7';
      return;
    }

    if (status === 'rate_limited') {
      statusEl.textContent = '刷新受限';
      statusEl.style.color = '#8d6e63';
      statusEl.style.background = '#efebe9';
      return;
    }

    statusEl.textContent = '待验证';
    statusEl.style.color = '#616161';
    statusEl.style.background = '#f5f5f5';
  }

  hide(): void {
    this.clearAuthPolling();
    const el = this.getElement();
    if (el) el.style.display = 'none';
  }

  // 优先渲染缓存，并在后台尝试刷新 + 持久化
  private refreshing = false; // 防止并发刷新
  
  private async renderCachedAndMaybeRefresh() {
    try {
      const settings: any = await getSettings();
      const s = settings?.drive115 || {};
      const enabled = !!(s.enabled);
      const autoRefresh = s.v2AutoRefresh !== false; // 默认开启
      const cachedUser: Drive115V2UserInfo | undefined = s.v2UserInfo;
      const expired: boolean = !!s.v2UserInfoExpired;
      const tokenExpiresAt = s.v2TokenExpiresAt || 0;
      const skewSec = Math.max(0, Number(s.v2AutoRefreshSkewSec ?? 60) || 0);

      if (!enabled) return;
      
      // 先渲染缓存
      if (cachedUser && Object.keys(cachedUser).length > 0) {
        this.renderUserInfo(cachedUser);
        this.setUserInfoStatus(expired ? '已过期（缓存）' : '已缓存', 'info');
        await addLogV2({ 
          timestamp: Date.now(), 
          level: 'debug', 
          message: `设置页已渲染缓存的用户信息（过期=${expired}）` 
        });
      }
      
      // 如果开启了自动刷新，在后台尝试刷新
      if (autoRefresh) {
        // 防止并发刷新
        if (this.refreshing) {
          await addLogV2({ 
            timestamp: Date.now(), 
            level: 'debug', 
            message: '设置页跳过刷新：已有刷新任务在进行中' 
          });
          return;
        }
        
        // 检查是否需要刷新：只在token即将过期或已过期时刷新
        const nowSec = Math.floor(Date.now() / 1000);
        const needRefresh = expired || 
                           (typeof tokenExpiresAt === 'number' && tokenExpiresAt > 0 && tokenExpiresAt - skewSec <= nowSec);
        
        if (!needRefresh) {
          // token仍有效且未过期，跳过刷新
          const remainSec = typeof tokenExpiresAt === 'number' && tokenExpiresAt > 0 
            ? tokenExpiresAt - nowSec 
            : 0;
          const remainMin = remainSec > 0 ? Math.floor(remainSec / 60) : 0;
          await addLogV2({ 
            timestamp: Date.now(), 
            level: 'debug', 
            message: `设置页跳过刷新：token仍有效（剩余约 ${remainMin} 分钟）` 
          });
          return;
        }
        
        // 需要刷新，依赖 getValidAccessToken 内部的官方限制（60-120分钟间隔、2小时3次）
        // 不在这里额外限制，避免时间戳不同步导致绕过官方限制
        this.refreshing = true;
        await addLogV2({ 
          timestamp: Date.now(), 
          level: 'info', 
          message: '设置页开始后台刷新用户信息（token即将过期或已过期）' 
        });
        
        try {
          const svc = getDrive115V2Service();
          
          // 重试机制：最多重试2次（共3次尝试）
          let userAuto: any = null;
          let lastError: string = '';
          const maxRetries = 2;
          
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
              // 重试前等待，使用指数退避：1秒、2秒
              const delayMs = Math.pow(2, attempt - 1) * 1000;
              await addLogV2({ 
                timestamp: Date.now(), 
                level: 'info', 
                message: `设置页第 ${attempt + 1} 次尝试刷新用户信息（等待 ${delayMs}ms）` 
              });
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            try {
              userAuto = await svc.fetchUserInfoAuto({ forceAutoRefresh: true });
              
              if (userAuto.success && userAuto.data) {
                await addLogV2({ 
                  timestamp: Date.now(), 
                  level: 'info', 
                  message: `设置页用户信息刷新成功（尝试次数=${attempt + 1}）` 
                });
                break; // 成功，跳出重试循环
              } else {
                lastError = userAuto.message || '未知错误';
                await addLogV2({ 
                  timestamp: Date.now(), 
                  level: 'warn', 
                  message: `设置页第 ${attempt + 1} 次刷新失败：${lastError}` 
                });
                
                // 如果是官方限制（频率限制、次数限制），立即停止重试
                if (lastError.includes('间隔') || lastError.includes('上限') || lastError.includes('频率')) {
                  await addLogV2({ 
                    timestamp: Date.now(), 
                    level: 'info', 
                    message: '设置页检测到官方限制，停止重试' 
                  });
                  break;
                }
                
                // 如果是token失效或权限问题，也停止重试
                if (lastError.includes('token') || lastError.includes('授权') || lastError.includes('权限')) {
                  await addLogV2({ 
                    timestamp: Date.now(), 
                    level: 'info', 
                    message: '设置页检测到认证问题，停止重试' 
                  });
                  break;
                }
              }
            } catch (err: any) {
              lastError = err?.message || '网络异常';
              await addLogV2({ 
                timestamp: Date.now(), 
                level: 'error', 
                message: `设置页第 ${attempt + 1} 次刷新异常：${lastError}` 
              });
              
              // 最后一次尝试也失败了
              if (attempt === maxRetries) {
                userAuto = { success: false, message: lastError };
              }
            }
          }
          
          if (userAuto && userAuto.success && userAuto.data) {
            // 刷新成功，更新显示和缓存
            this.renderUserInfo(userAuto.data);
            this.setUserInfoStatus('已更新', 'ok');
            await addLogV2({ 
              timestamp: Date.now(), 
              level: 'info', 
              message: '设置页用户信息已更新到UI' 
            });
            
            // 重新读取最新的 settings，避免覆盖 fetchUserInfoAuto 内部的 token 更新
            const latestSettings: any = await getSettings();
            const newSettings: any = { ...latestSettings };
            newSettings.drive115 = {
              ...(latestSettings.drive115 || {}),
              v2UserInfo: userAuto.data,
              v2UserInfoUpdatedAt: Date.now(),
              v2UserInfoExpired: false,
            };
            await saveSettings(newSettings);
            await addLogV2({ 
              timestamp: Date.now(), 
              level: 'info', 
              message: '设置页用户信息已持久化到存储' 
            });
          } else if (expired) {
            // 刷新失败且缓存已过期，保持显示缓存但标记为过期
            const msg = lastError || '刷新失败';
            this.setUserInfoStatus(`刷新失败（${msg}）`, 'error');
            await addLogV2({ 
              timestamp: Date.now(), 
              level: 'error', 
              message: `设置页刷新失败且缓存已过期：${msg}` 
            });
          } else {
            // 刷新失败但缓存未过期，静默失败
            await addLogV2({ 
              timestamp: Date.now(), 
              level: 'warn', 
              message: `设置页刷新失败但缓存仍有效，继续使用缓存：${lastError}` 
            });
          }
        } finally {
          this.refreshing = false;
          await addLogV2({ 
            timestamp: Date.now(), 
            level: 'debug', 
            message: '设置页刷新任务结束' 
          });
        }
      }
    } catch (e: any) {
      // 静默失败（不打断设置页操作）
      await addLogV2({ 
        timestamp: Date.now(), 
        level: 'error', 
        message: `设置页 renderCachedAndMaybeRefresh 异常：${e?.message || '未知错误'}` 
      });
      this.refreshing = false;
    }
  }

  // 校验 v2 相关字段（可选填：若填写则简单长度校验）
  validate?(): string[] {
    const errors: string[] = [];
    const enabled = (document.getElementById('drive115Enabled') as HTMLInputElement | null)?.checked ?? false;
    if (!enabled) return errors;

    // 基础域名校验（可留空；若填写需 http(s) 且不可以/结尾）
    const baseUrl = ((document.getElementById('drive115V2ApiBaseUrl') as any)?.value || '').trim();
    if (baseUrl) {
      if (!/^https?:\/\//i.test(baseUrl)) errors.push('v2 接口域名必须以 http(s):// 开头');
      if (/\/$/.test(baseUrl)) errors.push('v2 接口域名末尾不要带 /');
    }

    const at = ((document.getElementById('drive115V2AccessToken') as any)?.value || '').trim();
    const rt = ((document.getElementById('drive115V2RefreshToken') as any)?.value || '').trim();
    if (at && at.length < 8) errors.push('access_token 看起来不正确（长度过短）');
    if (rt && rt.length < 8) errors.push('refresh_token 看起来不正确（长度过短）');
    return errors;
  }

  private setUserInfoStatus(msg: string, kind: 'ok' | 'error' | 'info' = 'info') {
    const el = document.getElementById('drive115V2UserInfoStatus');
    if (!el) return;
    el.textContent = msg;
    el.setAttribute('data-kind', kind);
    el['style'] && (el['style'].color = kind === 'ok' ? '#2e7d32' : kind === 'error' ? '#c62828' : '#888');
  }

  private renderUserInfo(user: Drive115V2UserInfo) {
    const boxEl = document.getElementById('drive115V2UserInfoBox');
    if (!boxEl) return;

    const u: any = user || {};
    // 兼容字段映射
    const uid = u.uid || u.user_id || u.id || '-';
    const name = u.user_name || u.name || u.nick || u.username || `UID ${uid}`;
    const avatar = u.user_face_m || u.user_face_l || u.user_face_s || u.avatar_middle || u.avatar || u.avatar_small || '';

    // VIP 信息
    const vip = u.vip_info || {};
    const vipLevelName: string = vip.level_name || '';
    const vipExpireTs: number | undefined = typeof vip.expire === 'number' ? vip.expire : undefined;
    const vipExpireText = vipExpireTs ? this.formatExpire(vipExpireTs) : (u.vip_expire || '');
    const isVip = vipLevelName ? '是' : ((typeof u.is_vip === 'boolean') ? (u.is_vip ? '是' : '否') : (typeof u.is_vip === 'number' ? (u.is_vip > 0 ? '是' : '否') : (vipLevelName ? '是' : '否')));

    // 空间信息（优先使用 rt_space_info -> size 与 size_format）
    const space = u.rt_space_info || {};
    const totalSize: number | undefined = space?.all_total?.size;
    const usedSize: number | undefined = space?.all_use?.size;
    const freeSize: number | undefined = space?.all_remain?.size;
    const totalText: string = space?.all_total?.size_format || this.formatBytes(u.space_total);
    const usedText: string = space?.all_use?.size_format || this.formatBytes(u.space_used);
    const freeText: string = space?.all_remain?.size_format || this.formatBytes(u.space_free);
    const percent = ((): number => {
      if (typeof usedSize === 'number' && typeof totalSize === 'number' && totalSize > 0) return Math.max(0, Math.min(100, Math.round((usedSize / totalSize) * 100)));
      // 回退：尝试根据 free/total 推算
      if (typeof freeSize === 'number' && typeof totalSize === 'number' && totalSize > 0) return Math.max(0, Math.min(100, Math.round(((totalSize - freeSize) / totalSize) * 100)));
      return 0;
    })();

    // 渲染卡片
    boxEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        ${avatar ? `<img src="${avatar}" alt="avatar" style="width:48px; height:48px; border-radius:50%; object-fit:cover; box-shadow:0 1px 3px rgba(0,0,0,.15);">` : ''}
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary);">${this.escapeHtml(name)}</div>
            ${isVip === '是' ? `
              <span title="${this.escapeHtml(vipLevelName || 'VIP')}" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:11px; color:#fff; background: linear-gradient(135deg,#f2b01e,#e89f0e); box-shadow:0 0 0 1px rgba(0,0,0,.06) inset;">
                <i class="fas fa-crown" style="color:#fff; font-size:11px;"></i>
                ${this.escapeHtml(vipLevelName || 'VIP')}
              </span>
            ` : ''}
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">UID: ${this.escapeHtml(String(uid))}${vipExpireText ? ` · 到期：${this.escapeHtml(String(vipExpireText))}` : ''}</div>
        </div>
      </div>

      <div style="margin-top:10px;">
        <div style="height:8px; background:var(--bg-secondary); border-radius:6px; overflow:hidden;">
          <div style="width:${percent}%; height:100%; background:linear-gradient(90deg, #42a5f5, #1e88e5);"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-secondary); margin-top:6px;">
          <span>已用：${this.escapeHtml(usedText)}</span>
          <span>剩余：${this.escapeHtml(freeText)}</span>
          <span>总计：${this.escapeHtml(totalText)}</span>
        </div>
      </div>
    `;
  }

  private formatExpire(tsSec: number): string {
    if (!tsSec || isNaN(tsSec)) return '';
    try {
      const d = new Date(tsSec * 1000);
      const y = d.getFullYear();
      const m = `${d.getMonth() + 1}`.padStart(2, '0');
      const day = `${d.getDate()}`.padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return '';
    }
  }

  private formatBytes(n?: number): string {
    if (typeof n !== 'number' || isNaN(n)) return '-';
    const units = ['B','KB','MB','GB','TB','PB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
  }

  // 动态注入“最小自动刷新间隔(分钟)”与“最近自动刷新时间”UI
  private async injectRefreshIntervalUI(): Promise<void> {
    try {
      // 优先锚定在“提前刷新秒数”控件所在行附近
      const skewEl = document.getElementById('drive115V2AutoRefreshSkewSec') as HTMLElement | null;
      const atEl = document.getElementById('drive115V2AccessToken') as HTMLElement | null;
      let host: HTMLElement | null = null;

      const findRow = (el: HTMLElement | null): HTMLElement | null => {
        if (!el) return null;
        let cur: HTMLElement | null = el;
        for (let i = 0; i < 4 && cur; i++) {
          if (cur.classList && (cur.classList.contains('form-row') || cur.classList.contains('settings-row') || cur.classList.contains('form-group') || cur.id === 'drive115V2Pane')) return cur;
          cur = cur.parentElement as HTMLElement | null;
        }
        return el.parentElement as HTMLElement | null;
      };

      host = findRow(skewEl) || findRow(atEl);
      if (!host) return;

      // 若已存在则刷新显示；兼容老版本：
      // 1) 若缺少“下次自动刷新时间”一行，则升级为多行块
      // 2) 若信息块已存在但被放在同一行(wrapper)内，则移动到下一行（wrapper 之后），实现换行
      if (document.getElementById('drive115V2MinRefreshIntervalMin')) {
        try {
          const hasNext = !!document.getElementById('drive115V2NextRefreshAt');
          if (!hasNext) {
            // 移除旧版单行展示（含“最近… 2小时内已刷新…”在同一行）
            const oldLast = document.getElementById('drive115V2LastRefreshAt') as HTMLSpanElement | null;
            if (oldLast) {
              const oldLine = oldLast.closest('div') as HTMLElement | null;
              if (oldLine && oldLine.parentElement) {
                oldLine.parentElement.removeChild(oldLine);
              }
            }
            // 注入新版三行块
            const infoBlock = document.createElement('div');
            infoBlock.id = 'drive115V2RefreshInfoBlock';
            infoBlock.style.cssText = 'font-size:12px; color:#666; display:flex; flex-direction:column; gap:4px;';
            infoBlock.innerHTML = `
              <div>最近自动刷新时间：<span id="drive115V2LastRefreshAt" style="color:#444;">-</span></div>
              <div>下次自动刷新时间：<span id="drive115V2NextRefreshAt" style="color:#444;">-</span></div>
              <div>2小时内已刷新：<span id="drive115V2Refresh2hStat" style="color:#444;">-</span></div>
            `;
            host.appendChild(infoBlock);
          }
          // 若信息块已存在但仍位于同一行容器内，则移出到下一行
          const infoBlock = document.getElementById('drive115V2RefreshInfoBlock');
          if (infoBlock && infoBlock.parentElement) {
            const parent = infoBlock.parentElement as HTMLElement;
            const hasMinInput = !!parent.querySelector('#drive115V2MinRefreshIntervalMin');
            if (hasMinInput && parent !== host) {
              parent.removeChild(infoBlock);
              infoBlock.style.marginTop = '6px';
              infoBlock.style.flexBasis = '100%';
              (infoBlock as any).style && (infoBlock.style.width = '100%');
              host.appendChild(infoBlock);
            }
          }
        } catch {}
        await this.updateRefreshIntervalUIFromStorage();
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.style.marginTop = '8px';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '10px';
      wrapper.innerHTML = `
        <label style="font-size:12px; color:#555; display:flex; align-items:center; gap:6px;">
          最小自动刷新间隔(分钟)
          <input id="drive115V2MinRefreshIntervalMin" type="number" min="60" max="120" step="1" style="width:96px; padding:4px 6px;" />
          <span style="font-size:12px; color:#888;">范围 60-120</span>
        </label>
        <div style="font-size:12px; color:#555; display:flex; align-items:center; gap:6px;">
          <span>2小时自动刷新上限(次)</span>
          <span style="font-weight:600; color:#444;">3（固定）</span>
        </div>
      `;
      host.appendChild(wrapper);

      // 在单独一行渲染信息块，强制换行展示
      const infoBlock = document.createElement('div');
      infoBlock.id = 'drive115V2RefreshInfoBlock';
      infoBlock.style.cssText = 'font-size:12px; color:#666; display:flex; flex-direction:column; gap:4px; margin-top:6px;';
      infoBlock.innerHTML = `
        <div>最近自动刷新时间：<span id="drive115V2LastRefreshAt" style="color:#444;">-</span></div>
        <div>下次自动刷新时间：<span id="drive115V2NextRefreshAt" style="color:#444;">-</span></div>
        <div>2小时内已刷新：<span id="drive115V2Refresh2hStat" style="color:#444;">-</span></div>
      `;
      host.appendChild(infoBlock);

      const input = wrapper.querySelector('#drive115V2MinRefreshIntervalMin') as HTMLInputElement | null;
      // 输入时不强制覆盖输入框，允许清空再输入；值合法时实时保存
      input?.addEventListener('input', async () => {
        try {
          const str = (input.value ?? '').trim();
          if (str === '') return; // 允许清空
          const raw = Math.floor(Number(str));
          if (!Number.isFinite(raw)) return;
          const val = Math.min(120, Math.max(60, raw));
          const settings: any = await getSettings();
          const ns: any = { ...settings };
          ns.drive115 = { ...(settings?.drive115 || {}), v2MinRefreshIntervalMin: val };
          await saveSettings(ns);
        } catch {}
      });
      // 失焦时进行兜底与回填
      input?.addEventListener('change', async () => {
        try {
          const raw = Math.floor(Number((input.value ?? '').trim() || 60));
          const val = Math.min(120, Math.max(60, Number.isFinite(raw) ? raw : 60));
          input.value = String(val);
          const settings: any = await getSettings();
          const ns: any = { ...settings };
          ns.drive115 = { ...(settings?.drive115 || {}), v2MinRefreshIntervalMin: val };
          await saveSettings(ns);
        } catch {}
      });

      await this.updateRefreshIntervalUIFromStorage();
    } catch {}
  }

  private async updateRefreshIntervalUIFromStorage(): Promise<void> {
    try {
      const input = document.getElementById('drive115V2MinRefreshIntervalMin') as HTMLInputElement | null;
      const lastEl = document.getElementById('drive115V2LastRefreshAt') as HTMLSpanElement | null;
      const nextEl = document.getElementById('drive115V2NextRefreshAt') as HTMLSpanElement | null;
      const statEl = document.getElementById('drive115V2Refresh2hStat') as HTMLSpanElement | null;
      const settings: any = await getSettings();
      const s = settings?.drive115 || {};
      const minMin = Math.min(120, Math.max(60, Number(s.v2MinRefreshIntervalMin ?? 60) || 60));
      if (input) input.value = String(minMin);
      const last = Number(s.v2LastTokenRefreshAtSec || 0) || 0;
      if (lastEl) lastEl.textContent = last > 0 ? this.formatLocalDateTime(last) : '-';
      const maxPer2h = 3; // 固定上限
      // 计算“下次自动刷新时间”：受最小间隔与到期-提前秒数共同约束
      try {
        const skewSec = Math.max(0, Number(s.v2AutoRefreshSkewSec ?? 60) || 0);
        const expAt = typeof s.v2TokenExpiresAt === 'number' ? s.v2TokenExpiresAt : 0;
        const nextByInterval = last > 0 ? (last + minMin * 60) : 0;
        const nextByExpiry = expAt > 0 ? Math.max(0, expAt - skewSec) : 0;
        const positives = [nextByInterval, nextByExpiry].filter(v => v > 0);
        let next = 0;
        if (positives.length === 1) next = positives[0];
        else if (positives.length === 2) next = Math.max(positives[0], positives[1]); // 需要同时满足两条件，取较晚者
        if (nextEl) nextEl.textContent = next > 0 ? this.formatLocalDateTime(next) : '-';
      } catch {}
      // 2小时窗口统计
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const histRaw: any[] = Array.isArray(s.v2TokenRefreshHistorySec) ? s.v2TokenRefreshHistorySec : [];
        const hist: number[] = histRaw.map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
        const twoHoursAgo = nowSec - 7200;
        const cnt = hist.filter(ts => ts >= twoHoursAgo).length;
        if (statEl) statEl.textContent = `${cnt}/${maxPer2h}`;
      } catch {}
    } catch {}
  }

  private formatLocalDateTime(tsSec: number): string {
    if (!tsSec || isNaN(tsSec as any)) return '-';
    const d = new Date(tsSec * 1000);
    const Y = d.getFullYear();
    const M = d.getMonth() + 1;
    const D = d.getDate();
    const hh = `${d.getHours()}`.padStart(2, '0');
    const mm = `${d.getMinutes()}`.padStart(2, '0');
    const ss = `${d.getSeconds()}`.padStart(2, '0');
    return `${Y}/${M}/${D}  ${hh}:${mm}:${ss}`;
  }

  private formatDateOnly(tsSec: number): string {
    if (!tsSec || isNaN(tsSec as any)) return '-';
    const d = new Date(tsSec * 1000);
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}/${m}/${day}`;
  }

  private formatRemainingDays(sec: number): string {
    if (!Number.isFinite(sec) || sec <= 0) return '0天';
    return `${Math.ceil(sec / 86400)}天`;
  }

  // 手动刷新限频判断（与服务层自动刷新一致，最小间隔不低于30分钟）
  private async isManualRefreshAllowed_(): Promise<boolean> {
    try {
      const settings: any = await getSettings();
      const s = settings?.drive115 || {};
      const minMin = Math.min(120, Math.max(60, Number(s.v2MinRefreshIntervalMin ?? 60) || 60));
      const last = Number(s.v2LastTokenRefreshAtSec || 0) || 0;
      if (last <= 0) return true;
      const nowSec = Math.floor(Date.now() / 1000);
      const remainSec = minMin * 60 - (nowSec - last);
      if (remainSec > 0) {
        const remainMin = Math.ceil(remainSec / 60);
        const msg = `距离上次刷新不足最小间隔（${minMin}分钟），请稍后再试（剩余约 ${remainMin} 分钟）`;
        this.setUserInfoStatus(msg, 'error');
        showToast(msg, 'error');
        return false;
      }
      // 2小时窗口限制（与服务层一致）
      try {
        const maxPer2h = 3; // 固定上限
        const histRaw: any[] = Array.isArray(s.v2TokenRefreshHistorySec) ? s.v2TokenRefreshHistorySec : [];
        const hist: number[] = histRaw.map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
        const twoHoursAgo = nowSec - 7200;
        const cnt = hist.filter(ts => ts >= twoHoursAgo).length;
        if (cnt >= maxPer2h) {
          const msg = `2小时内刷新次数已达上限（${maxPer2h} 次），请稍后再试`;
          this.setUserInfoStatus(msg, 'error');
          showToast(msg, 'error');
          return false;
        }
      } catch {}
      return true;
    } catch {
      // 出错时不阻断
      return true;
    }
  }
}
