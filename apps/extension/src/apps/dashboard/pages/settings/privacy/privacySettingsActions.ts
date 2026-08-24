/**
 * @file privacySettingsActions.ts
 * @description 隐私设置动作（调用 PrivacyManager / Password / Recovery，不重实现加密）
 * @module apps/dashboard/pages/settings/privacy
 */
import type { BlurArea } from '../../../../../types/privacy';
import { showConfirm } from '../../../../../dashboard/components/confirmModal';
import { getSettings, saveSettings } from '../shared/settingsPersist';

async function toast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' = 'info',
): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type as any);
  } catch {
    /* ignore */
  }
}

export type RecoveryStatus = {
  hasSecurityQuestions: boolean;
  hasBackupCode: boolean;
};

/**
 * 读取恢复选项状态
 */
export async function loadRecoveryStatus(): Promise<RecoveryStatus> {
  try {
    const { getRecoveryService } = await import('../../../../../features/privacy');
    const recoveryService = getRecoveryService();
    const hasSecurityQuestions = await recoveryService.hasSecurityQuestions();
    const hasBackupCode = await recoveryService.hasBackupCode();
    return { hasSecurityQuestions, hasBackupCode };
  } catch (err) {
    console.error('[PrivacySettings] loadRecoveryStatus failed', err);
    return { hasSecurityQuestions: false, hasBackupCode: false };
  }
}

/**
 * 切换截图模式
 */
export async function setScreenshotModeEnabled(enabled: boolean): Promise<boolean> {
  try {
    const { getPrivacyManager } = await import('../../../../../features/privacy');
    const privacyManager = getPrivacyManager();
    if (enabled) {
      await privacyManager.enableScreenshotMode();
      await toast('截图模式已启用', 'success');
    } else {
      await privacyManager.disableScreenshotMode();
      await toast('截图模式已禁用', 'success');
    }
    return true;
  } catch (err) {
    console.error('[PrivacySettings] toggle screenshot failed', err);
    await toast('切换截图模式失败', 'error');
    return false;
  }
}

/**
 * 普通 JavDB/JavBus 内容页的截图模糊范围独立保存，不触发锁屏或密码流程。
 */
export async function setContentPagesScreenshotEnabled(enabled: boolean): Promise<boolean> {
  try {
    const settings = await getSettings();
    const current = settings.privacy?.screenshotMode?.contentPages;
    settings.privacy.screenshotMode.contentPages = {
      ...current,
      enabled,
      sites: {
        javdb: current?.sites?.javdb !== false,
        javbus: current?.sites?.javbus !== false,
      },
    };
    await saveSettings(settings);
    await toast(enabled ? '普通内容页截图模糊已启用' : '普通内容页截图模糊已禁用', 'success');
    return true;
  } catch (err) {
    console.error('[PrivacySettings] toggle content-page screenshot failed', err);
    await toast('切换普通内容页截图模糊失败', 'error');
    return false;
  }
}

/**
 * 更新模糊强度
 */
export async function updateBlurIntensity(value: number): Promise<boolean> {
  try {
    const { getPrivacyManager } = await import('../../../../../features/privacy');
    await getPrivacyManager().updateScreenshotSettings({ blurIntensity: value });
    await toast('模糊强度已更新', 'success');
    return true;
  } catch (err) {
    console.error('[PrivacySettings] update blur intensity failed', err);
    await toast('更新模糊强度失败', 'error');
    return false;
  }
}

/**
 * 更新自动模糊触发条件
 */
export async function updateAutoBlurTrigger(value: string): Promise<boolean> {
  try {
    const { getPrivacyManager } = await import('../../../../../features/privacy');
    await getPrivacyManager().updateScreenshotSettings({ autoBlurTrigger: value });
    await toast('自动模糊触发条件已更新', 'success');
    return true;
  } catch (err) {
    console.error('[PrivacySettings] update auto blur trigger failed', err);
    await toast('更新自动模糊触发条件失败', 'error');
    return false;
  }
}

/**
 * 更新模糊区域
 */
export async function updateBlurAreas(areas: BlurArea[]): Promise<boolean> {
  try {
    const { getPrivacyManager } = await import('../../../../../features/privacy');
    await getPrivacyManager().updateScreenshotSettings({ blurAreas: areas as any });
    await toast('模糊区域已更新', 'success');
    return true;
  } catch (err) {
    console.error('[PrivacySettings] update blur areas failed', err);
    await toast('更新模糊区域失败', 'error');
    return false;
  }
}

/**
 * 切换私密模式（含密码校验流）
 * @returns 最终启用状态；失败时返回 previous
 */
export async function togglePrivateMode(
  nextEnabled: boolean,
  previousEnabled: boolean,
  onNeedSetPassword?: () => void,
): Promise<boolean> {
  try {
    const settings = await getSettings();
    const { getPrivacyManager } = await import('../../../../../features/privacy');
    const privacyManager = getPrivacyManager();

    if (nextEnabled) {
      if (!settings.privacy?.privateMode?.passwordHash) {
        await toast('请先设置密码才能启用私密模式', 'warning');
        if (onNeedSetPassword) {
          window.setTimeout(() => onNeedSetPassword(), 500);
        }
        return previousEnabled;
      }

      const { showPasswordModal } = await import(
        '../../../../../dashboard/components/privacy/PasswordModal'
      );
      const result = await showPasswordModal('verify');
      if (!result.success) {
        await toast('密码验证失败，无法启用私密模式', 'error');
        return previousEnabled;
      }

      await privacyManager.enablePrivateMode();
      await toast('私密模式已启用', 'success');
      return true;
    }

    if (settings.privacy?.privateMode?.passwordHash) {
      const { showPasswordModal } = await import(
        '../../../../../dashboard/components/privacy/PasswordModal'
      );
      const result = await showPasswordModal('verify');
      if (!result.success) {
        await toast('密码验证失败，无法关闭私密模式', 'error');
        return previousEnabled;
      }
    }

    await privacyManager.disablePrivateMode();
    await toast('私密模式已禁用', 'success');
    return false;
  } catch (err) {
    console.error('[PrivacySettings] toggle private mode failed', err);
    await toast('切换私密模式失败', 'error');
    return previousEnabled;
  }
}

/**
 * 更新 requirePassword
 */
export async function setRequirePassword(checked: boolean): Promise<boolean> {
  try {
    const { getPrivacyManager } = await import('../../../../../features/privacy');
    await getPrivacyManager().updatePrivateModeSettings({ requirePassword: checked });
    await toast(checked ? '已启用密码保护' : '已禁用密码保护', 'success');
    return true;
  } catch (err) {
    console.error('[PrivacySettings] toggle require password failed', err);
    await toast('切换密码要求失败', 'error');
    return false;
  }
}

/**
 * 更新会话超时 / 离开锁定等
 */
export async function updatePrivateModeOptions(input: {
  sessionTimeout: number;
  lockOnTabLeave: boolean;
  lockOnExtensionClose: boolean;
}): Promise<boolean> {
  try {
    const { getPrivacyManager } = await import('../../../../../features/privacy');
    await getPrivacyManager().updatePrivateModeSettings({
      sessionTimeout: input.sessionTimeout,
      idleTimeout: input.sessionTimeout,
      lockOnTabLeave: input.lockOnTabLeave,
      lockOnExtensionClose: input.lockOnExtensionClose,
    });
    await toast('私密模式设置已更新', 'success');
    return true;
  } catch (err) {
    console.error('[PrivacySettings] update private mode settings failed', err);
    await toast('更新私密模式设置失败', 'error');
    return false;
  }
}

/**
 * 设置密码
 */
export async function setPassword(): Promise<boolean> {
  try {
    const { getPasswordService } = await import('../../../../../features/privacy');
    const success = await getPasswordService().showSetPasswordDialog();
    if (success) {
      await toast('密码设置成功', 'success');
    }
    return !!success;
  } catch (err) {
    console.error('[PrivacySettings] set password failed', err);
    await toast('设置密码失败', 'error');
    return false;
  }
}

/**
 * 修改密码
 */
export async function changePassword(): Promise<boolean> {
  try {
    const { getPasswordService } = await import('../../../../../features/privacy');
    const success = await getPasswordService().showChangePasswordDialog();
    if (success) {
      await toast('密码修改成功', 'success');
    }
    return !!success;
  } catch (err) {
    console.error('[PrivacySettings] change password failed', err);
    await toast('修改密码失败', 'error');
    return false;
  }
}

/**
 * 取消密码并关闭私密模式
 */
export async function removePassword(): Promise<boolean> {
  try {
    const confirmed = await showConfirm({
      title: '取消密码',
      message:
        '确定要取消密码吗？\n\n' +
        '取消密码后：\n' +
        '• 私密模式将自动关闭\n' +
        '• 所有密码保护功能将失效\n' +
        '• 恢复方式（安全问题、备份码）将被保留\n\n' +
        '此操作不可撤销，确定继续吗？',
      type: 'danger',
      confirmText: '取消密码',
    });
    if (!confirmed) return false;

    const settings = await getSettings();
    if (settings.privacy?.privateMode) {
      settings.privacy.privateMode.passwordHash = '';
      settings.privacy.privateMode.passwordSalt = '';
      settings.privacy.privateMode.requirePassword = false;
      settings.privacy.privateMode.enabled = false;
    }
    await saveSettings(settings);
    await toast('密码已取消，私密模式已关闭', 'success');
    return true;
  } catch (err) {
    console.error('[PrivacySettings] remove password failed', err);
    await toast('取消密码失败', 'error');
    return false;
  }
}

/**
 * 设置/修改安全问题
 */
export async function setupSecurityQuestions(): Promise<boolean> {
  try {
    const { getRecoveryService } = await import('../../../../../features/privacy');
    const success = await getRecoveryService().showSecurityQuestionsDialog();
    if (success) {
      await toast('安全问题设置成功', 'success');
    }
    return !!success;
  } catch (err) {
    console.error('[PrivacySettings] setup security questions failed', err);
    await toast('设置安全问题失败', 'error');
    return false;
  }
}

/**
 * 生成备份码并展示弹窗
 */
export async function generateBackupCode(): Promise<boolean> {
  try {
    const { getRecoveryService } = await import('../../../../../features/privacy');
    const backupCode = await getRecoveryService().generateBackupCode();
    if (backupCode) {
      showBackupCodeModal(backupCode);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[PrivacySettings] generate backup code failed', err);
    await toast('生成备份码失败', 'error');
    return false;
  }
}

/**
 * 备份码展示弹窗（对齐遗留 imperative DOM 实现）
 */
export function showBackupCodeModal(backupCode: string): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: Arial, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 580px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    ">
      <div style="text-align: center; padding: 20px 0;">
        <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 24px; font-weight: 700;">备份恢复码已生成</h3>
        <p style="color: #6b7280; margin: 0 0 32px 0; line-height: 1.6; font-size: 15px;">
          请妥善保存此恢复码，它只会显示一次
        </p>
      </div>

      <div style="
        background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
        border: 2px solid #e5e7eb;
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 24px;
      ">
        <div style="
          font-family: 'Courier New', monospace;
          font-size: 24px;
          font-weight: 700;
          color: #111827;
          text-align: center;
          letter-spacing: 4px;
          padding: 16px;
          background: white;
          border-radius: 12px;
          border: 2px dashed #d1d5db;
          user-select: all;
          word-break: break-all;
        " id="backup-code-display">${backupCode}</div>

        <button id="copy-backup-code-btn" type="button" style="
          width: 100%;
          margin-top: 16px;
          padding: 14px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
        ">
          <span id="copy-btn-text">复制到剪贴板</span>
        </button>
      </div>

      <div style="
        background: #fef3c7;
        border-radius: 12px;
        padding: 16px 18px;
        margin-bottom: 24px;
      ">
        <p style="margin: 0 0 8px 0; color: #92400e; font-size: 14px; font-weight: 600;">重要提示</p>
        <ul style="margin: 0; padding-left: 20px; color: #92400e; font-size: 13px; line-height: 1.6;">
          <li>此恢复码只显示一次，请务必保存</li>
          <li>建议将其保存在安全的地方（如密码管理器）</li>
          <li>使用后该恢复码将失效，需重新生成</li>
        </ul>
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button type="button" class="confirm-backup-btn" style="
          padding: 12px 32px;
          border: none;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          border-radius: 10px;
          cursor: pointer;
          font-size: 15px;
          font-weight: 600;
        ">我已保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const copyBtn = overlay.querySelector('#copy-backup-code-btn') as HTMLButtonElement | null;
  const confirmBtn = overlay.querySelector('.confirm-backup-btn') as HTMLButtonElement | null;
  const copyBtnText = overlay.querySelector('#copy-btn-text') as HTMLSpanElement | null;

  const close = () => {
    overlay.remove();
  };

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(backupCode);
      if (copyBtnText) copyBtnText.textContent = '✓ 已复制';
      await toast('备份码已复制到剪贴板', 'success');
      window.setTimeout(() => {
        if (copyBtnText) copyBtnText.textContent = '复制到剪贴板';
      }, 2000);
    } catch {
      await toast('复制失败，请手动复制', 'error');
    }
  });

  confirmBtn?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

export { toast };
