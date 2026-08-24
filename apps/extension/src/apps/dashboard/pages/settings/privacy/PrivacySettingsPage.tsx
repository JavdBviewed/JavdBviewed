/**
 * @file PrivacySettingsPage.tsx
 * @description 隐私保护 React 全页
 * @module apps/dashboard/pages/settings/privacy
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { BlurArea } from '../../../../../types/privacy';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { getSettings } from '../shared/settingsPersist';
import {
  changePassword,
  generateBackupCode,
  loadRecoveryStatus,
  removePassword,
  setPassword,
  setContentPagesScreenshotEnabled,
  setRequirePassword,
  setScreenshotModeEnabled,
  setupSecurityQuestions,
  togglePrivateMode,
  updateAutoBlurTrigger,
  updateBlurAreas,
  updateBlurIntensity,
  updatePrivateModeOptions,
  type RecoveryStatus,
} from './privacySettingsActions';
import {
  AUTO_BLUR_TRIGGER_OPTIONS,
  BLUR_AREA_OPTIONS,
  DEFAULT_PRIVACY_SETTINGS_FORM,
  mapSettingsToPrivacyForm,
  toggleBlurArea,
  type PrivacySettingsFormState,
} from './privacySettingsModel';

/**
 * 隐私保护完整页面
 */
export function PrivacySettingsPage() {
  const [form, setForm] = useState<PrivacySettingsFormState>(DEFAULT_PRIVACY_SETTINGS_FORM);
  const [recovery, setRecovery] = useState<RecoveryStatus>({
    hasSecurityQuestions: false,
    hasBackupCode: false,
  });
  const [loading, setLoading] = useState(true);
  const formRef = useRef(form);
  formRef.current = form;

  const reload = useCallback(async () => {
    const settings = await getSettings();
    setForm(mapSettingsToPrivacyForm(settings));
    setRecovery(await loadRecoveryStatus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (err) {
        console.error('[PrivacySettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const onScreenshotToggle = async (checked: boolean) => {
    const prev = form.screenshotEnabled;
    setForm((f) => ({ ...f, screenshotEnabled: checked }));
    const ok = await setScreenshotModeEnabled(checked);
    if (!ok) setForm((f) => ({ ...f, screenshotEnabled: prev }));
  };

  const onBlurIntensity = async (raw: string) => {
    const value = Math.max(1, Math.min(10, parseInt(raw, 10) || form.blurIntensity));
    setForm((f) => ({ ...f, blurIntensity: value }));
    await updateBlurIntensity(value);
  };

  const onContentPagesScreenshotToggle = async (checked: boolean) => {
    const previous = form.contentPagesScreenshotEnabled;
    setForm((current) => ({ ...current, contentPagesScreenshotEnabled: checked }));
    const ok = await setContentPagesScreenshotEnabled(checked);
    if (!ok) setForm((current) => ({ ...current, contentPagesScreenshotEnabled: previous }));
  };

  const onAutoBlurTrigger = async (value: string) => {
    setForm((f) => ({ ...f, autoBlurTrigger: value }));
    await updateAutoBlurTrigger(value);
  };

  const onBlurArea = async (area: BlurArea, enabled: boolean) => {
    const blurAreas = toggleBlurArea(formRef.current.blurAreas, area, enabled);
    const next = { ...formRef.current, blurAreas };
    formRef.current = next;
    setForm(next);
    await updateBlurAreas(blurAreas);
  };

  const onPrivateModeToggle = async (checked: boolean) => {
    const previous = form.privateModeEnabled;
    const finalEnabled = await togglePrivateMode(checked, previous, () => {
      void onSetPassword();
    });
    setForm((f) => ({ ...f, privateModeEnabled: finalEnabled }));
  };

  const onRequirePassword = async (checked: boolean) => {
    const prev = form.requirePassword;
    setForm((f) => ({ ...f, requirePassword: checked }));
    const ok = await setRequirePassword(checked);
    if (!ok) setForm((f) => ({ ...f, requirePassword: prev }));
  };

  const persistPrivateOptions = async (
    patch: Partial<Pick<PrivacySettingsFormState, 'sessionTimeout' | 'lockOnTabLeave' | 'lockOnExtensionClose'>>,
  ) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    await updatePrivateModeOptions({
      sessionTimeout: next.sessionTimeout,
      lockOnTabLeave: next.lockOnTabLeave,
      lockOnExtensionClose: next.lockOnExtensionClose,
    });
  };

  const onSetPassword = async () => {
    const ok = await setPassword();
    if (ok) {
      setForm((f) => ({ ...f, hasPassword: true }));
      await reload();
    }
  };

  const onChangePassword = async () => {
    await changePassword();
  };

  const onRemovePassword = async () => {
    const ok = await removePassword();
    if (ok) {
      setForm((f) => ({
        ...f,
        hasPassword: false,
        privateModeEnabled: false,
        requirePassword: false,
      }));
    }
  };

  const onSetupSecurityQuestions = async () => {
    const ok = await setupSecurityQuestions();
    if (ok) setRecovery(await loadRecoveryStatus());
  };

  const onGenerateBackupCode = async () => {
    const ok = await generateBackupCode();
    if (ok) setRecovery(await loadRecoveryStatus());
  };

  return (
    <SettingsPageFrame
      title="隐私保护设置"
      description="配置截图模式和私密模式，保护您的隐私数据不被意外泄露。"
      rootDataAttrs={{ 'data-privacy-settings-react': '1' }}
      pageId="privacy-settings"
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="privacy-settings">
          <SettingSection
            title="截图模式"
            icon={<i className="fas fa-camera" />}
            description="对敏感内容应用模糊效果，防止截图时泄露隐私。"
          >
            <SettingToggleRow
              id="screenshotModeEnabled"
              label="启用截图模式"
              checked={form.screenshotEnabled}
              onChange={(v) => void onScreenshotToggle(v)}
            />

            <SettingToggleRow
              id="contentPagesScreenshotEnabled"
              label="普通内容页截图模糊（JavDB / JavBus）"
              description="仅模糊影片、搜索和演员内容，不启用锁屏或密码保护。"
              checked={form.contentPagesScreenshotEnabled}
              onChange={(v) => void onContentPagesScreenshotToggle(v)}
            />

            <SettingField
              id="blurIntensity"
              label={
                <span>
                  模糊强度: <span id="blurIntensityValue">{form.blurIntensity}</span>
                </span>
              }
              description="范围 1-10，数值越大模糊越强。"
            >
              <input
                id="blurIntensity"
                type="range"
                min={1}
                max={10}
                value={form.blurIntensity}
                className="w-full accent-[var(--color-primary)]"
                onChange={(e) => void onBlurIntensity(e.currentTarget.value)}
              />
            </SettingField>

            <SettingField id="autoBlurTrigger" label="自动模糊触发条件">
              <SettingSelect
                id="autoBlurTrigger"
                value={String(form.autoBlurTrigger)}
                options={[...AUTO_BLUR_TRIGGER_OPTIONS]}
                onChange={(v) => void onAutoBlurTrigger(v)}
              />
            </SettingField>

            <div className="px-2 py-2">
              <div className="mb-2 text-[13.5px] font-semibold text-[var(--color-fg)]">
                选择要模糊的区域
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {BLUR_AREA_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 rounded-[var(--radius-2)] px-2 py-1.5 text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
                  >
                    <input
                      id={opt.id}
                      type="checkbox"
                      data-area={opt.area}
                      checked={form.blurAreas.includes(opt.area)}
                      onChange={(e) => void onBlurArea(opt.area, e.currentTarget.checked)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </SettingSection>

          <SettingSection
            title="私密模式"
            icon={<i className="fas fa-lock" />}
            description="在截图模式基础上增加密码验证，适用于公共电脑环境。"
          >
            <SettingToggleRow
              id="privateModeEnabled"
              label="启用私密模式"
              checked={form.privateModeEnabled}
              onChange={(v) => void onPrivateModeToggle(v)}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2">
              <div>
                <div className="text-[13.5px] font-semibold text-[var(--color-fg)]">密码状态</div>
                <span
                  id="passwordStatus"
                  className={`text-[12.5px] ${
                    form.hasPassword
                      ? 'text-[var(--color-success,#27ae60)]'
                      : 'text-[var(--color-warning,#d68910)]'
                  }`}
                >
                  {form.hasPassword ? '已设置' : '未设置'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {form.hasPassword ? (
                  <>
                    <button id="setPasswordBtn" type="button" className="hidden" aria-hidden />
                    <Button
                      id="changePasswordBtn"
                      variant="secondary"
                      onClick={() => void onChangePassword()}
                    >
                      <i className="fas fa-edit" aria-hidden="true" /> 更改密码
                    </Button>
                    <Button
                      id="removePasswordBtn"
                      variant="danger"
                      onClick={() => void onRemovePassword()}
                    >
                      <i className="fas fa-trash" aria-hidden="true" /> 取消密码
                    </Button>
                  </>
                ) : (
                  <>
                    <Button id="setPasswordBtn" variant="primary" onClick={() => void onSetPassword()}>
                      <i className="fas fa-lock" aria-hidden="true" /> 设置密码
                    </Button>
                    <button id="changePasswordBtn" type="button" className="hidden" aria-hidden />
                    <button id="removePasswordBtn" type="button" className="hidden" aria-hidden />
                  </>
                )}
              </div>
            </div>
            <p className="m-0 px-2 pb-2 text-[12px] text-[var(--color-fg-muted)]">
              密码要求：至少6位，支持纯数字或字母数字组合
            </p>

            <SettingField
              id="sessionTimeout"
              label="无操作超时时间（分钟）"
              description="超过此时间无任何操作将自动锁定"
            >
              <Input
                id="sessionTimeout"
                type="number"
                min={5}
                max={1440}
                value={String(form.sessionTimeout)}
                onChange={(e) => {
                  const n = parseInt(e.currentTarget.value, 10);
                  if (!Number.isFinite(n)) return;
                  void persistPrivateOptions({ sessionTimeout: n });
                }}
              />
            </SettingField>

            <SettingToggleRow
              id="requirePassword"
              label="需要密码验证"
              checked={form.requirePassword}
              onChange={(v) => void onRequirePassword(v)}
            />
            <SettingToggleRow
              id="lockOnTabLeave"
              label="离开标签页时自动锁定"
              checked={form.lockOnTabLeave}
              onChange={(v) => void persistPrivateOptions({ lockOnTabLeave: v })}
            />
            <SettingToggleRow
              id="lockOnExtensionClose"
              label="关闭拓展时自动锁定"
              checked={form.lockOnExtensionClose}
              onChange={(v) => void persistPrivateOptions({ lockOnExtensionClose: v })}
            />
          </SettingSection>

          <SettingSection title="密码恢复" icon={<i className="fas fa-life-ring" />} description="设置密码恢复选项，以防忘记密码。">
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2">
              <div>
                <div className="text-[13.5px] font-semibold text-[var(--color-fg)]">安全问题</div>
                <span
                  id="securityQuestionsStatus"
                  className={`text-[12.5px] ${
                    recovery.hasSecurityQuestions
                      ? 'text-[var(--color-success,#27ae60)]'
                      : 'text-[var(--color-warning,#d68910)]'
                  }`}
                >
                  {recovery.hasSecurityQuestions ? '已设置' : '未设置'}
                </span>
              </div>
              <Button
                id="setupSecurityQuestionsBtn"
                variant="secondary"
                onClick={() => void onSetupSecurityQuestions()}
              >
                <i className="fas fa-cog" aria-hidden="true" />{' '}
                {recovery.hasSecurityQuestions ? '修改安全问题' : '设置安全问题'}
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2">
              <div>
                <div className="text-[13.5px] font-semibold text-[var(--color-fg)]">备份恢复码</div>
                <span
                  id="backupCodeStatus"
                  className={`text-[12.5px] ${
                    recovery.hasBackupCode
                      ? 'text-[var(--color-success,#27ae60)]'
                      : 'text-[var(--color-warning,#d68910)]'
                  }`}
                >
                  {recovery.hasBackupCode ? '已生成' : '未生成'}
                </span>
              </div>
              <Button
                id="generateBackupCodeBtn"
                variant="secondary"
                onClick={() => void onGenerateBackupCode()}
              >
                <i className="fas fa-key" aria-hidden="true" />{' '}
                {recovery.hasBackupCode ? '重置备份恢复码' : '生成备份恢复码'}
              </Button>
            </div>

            <div className="mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-warning,#d68910)]/40 bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] text-[var(--color-fg)]">
              <strong>重要提醒：</strong>
              <ul className="mb-0 mt-1 pl-4">
                <li>请妥善保存备份恢复码，它只会显示一次</li>
                <li>如果忘记密码且没有恢复选项，只能重置所有数据</li>
                <li>建议至少设置一种恢复方式</li>
              </ul>
            </div>
          </SettingSection>
        </div>
      )}
    </SettingsPageFrame>
  );
}
