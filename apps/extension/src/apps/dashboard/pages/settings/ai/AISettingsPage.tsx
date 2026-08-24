/**
 * @file AISettingsPage.tsx
 * @description AI 设置 React 全页
 * @module apps/dashboard/pages/settings/ai
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import type { AIModel } from '../../../../../types/ai';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import { showConfirm } from '../../../../../dashboard/components/confirmModal';
import { useDebouncedSettingsSave } from '../shared/settingsPersist';
import {
  exportAiSettingsFile,
  loadAiModelsCached,
  loadAiSettingsFromService,
  persistAiForm,
  persistConversationParams,
  persistSelectedModel,
  pickImportAiSettingsFile,
  refreshAiModels,
  resetAiSettings,
  sendAiTestMessage,
  testAiConnection,
  toast,
} from './aiSettingsActions';
import {
  DEFAULT_AI_SETTINGS_FORM,
  formatModelOptionLabel,
  mergeImportedAiSettings,
  type AiSettingsFormState,
} from './aiSettingsModel';

const CONVERSATION_SAVE_MS = 400;

type ConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

type TestResultState =
  | { kind: 'idle' }
  | { kind: 'loading'; userMessage: string }
  | {
      kind: 'success';
      userMessage: string;
      reply: string;
      modelName: string;
      durationSec: number;
      tokens: number;
    }
  | { kind: 'error'; message: string; details: string[] };

/**
 * AI 设置完整页面
 */
export function AISettingsPage() {
  const [form, setForm] = useState<AiSettingsFormState>(DEFAULT_AI_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [models, setModels] = useState<AIModel[]>([]);
  const [testingConn, setTestingConn] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ kind: 'idle' });
  const [testInput, setTestInput] = useState('你好');
  const [testResult, setTestResult] = useState<TestResultState>({ kind: 'idle' });
  const [sendingTest, setSendingTest] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  const persistConversation = useCallback(async (nextForm: AiSettingsFormState) => {
    try {
      await persistConversationParams(nextForm);
      await toast('对话参数已自动保存', 'success');
    } catch (err) {
      console.error('[AISettingsPage] conversation save failed', err);
      await toast('对话参数保存失败', 'error');
    }
  }, []);

  const { scheduleSave: scheduleConversationSave, flush: flushConversationSave } =
    useDebouncedSettingsSave({
      delayMs: CONVERSATION_SAVE_MS,
      persist: persistConversation,
    });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadAiSettingsFromService();
        if (cancelled) return;
        formRef.current = next;
        setForm(next);

        if (next.selectedModel) {
          try {
            const list = await loadAiModelsCached();
            if (!cancelled && list.length > 0) {
              setModels(list);
            }
          } catch (err) {
            console.warn('[AISettingsPage] auto load models failed', err);
          }
        }
      } catch (err) {
        console.error('[AISettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({
      value: m.id,
      label: formatModelOptionLabel(m.id, m.name),
    }));
    if (form.selectedModel && !opts.some((o) => o.value === form.selectedModel)) {
      opts.unshift({
        value: form.selectedModel,
        label: formatModelOptionLabel(form.selectedModel),
      });
    }
    return [{ value: '', label: models.length ? '请选择模型' : '请先配置API并测试连接' }, ...opts];
  }, [models, form.selectedModel]);

  const disabled = !form.enabled;

  const patchForm = useCallback((patch: Partial<AiSettingsFormState>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
  }, []);

  const onEnabledChange = async (checked: boolean) => {
    const previous = form;
    const next = { ...form, enabled: checked };
    setForm(next);
    try {
      await persistAiForm(next);
      await toast(`AI功能已${checked ? '启用' : '禁用'}`, 'success');
    } catch (err) {
      console.error('[AISettingsPage] toggle enabled failed', err);
      setForm(previous);
      await toast('保存设置失败', 'error');
    }
  };

  const onCredentialChange = <K extends 'apiUrl' | 'apiKey'>(key: K, value: string) => {
    patchForm({ [key]: value } as Pick<AiSettingsFormState, K>);
  };

  const onCredentialBlur = async () => {
    try {
      await persistAiForm(formRef.current);
    } catch (err) {
      console.error('[AISettingsPage] credential blur save failed', err);
    }
  };

  const onModelChange = async (value: string) => {
    const previous = form.selectedModel;
    patchForm({ selectedModel: value });
    // 旧版允许通过首个空白项清除当前模型，空值也必须持久化。
    if (value === previous) return;
    try {
      await persistSelectedModel(value);
      await toast('模型选择已保存', 'success');
    } catch (err) {
      console.error('[AISettingsPage] save model failed', err);
      patchForm({ selectedModel: previous });
      await toast('保存模型选择失败', 'error');
    }
  };

  const onConversationNumber = (
    key: 'temperature' | 'maxTokens' | 'timeout' | 'autoRetryMax' | 'errorRetryMax',
    raw: string,
    immediate = false,
  ) => {
    const n =
      key === 'temperature' ? parseFloat(raw) : parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    const next = { ...formRef.current, [key]: n };
    formRef.current = next;
    setForm(next);
    if (immediate) {
      void flushConversationSave(next);
    } else {
      scheduleConversationSave(next);
    }
  };

  const onConversationToggle = (
    key: 'streamEnabled' | 'autoRetryEmpty' | 'errorRetryEnabled',
    value: boolean,
  ) => {
    const next = { ...formRef.current, [key]: value };
    formRef.current = next;
    setForm(next);
    scheduleConversationSave(next);
  };

  const onSystemPromptChange = (value: string) => {
    const next = { ...formRef.current, systemPrompt: value };
    formRef.current = next;
    setForm(next);
    scheduleConversationSave(next);
  };

  const onTestConnection = async () => {
    if (testingConn) return;
    setTestingConn(true);
    setConnectionStatus({ kind: 'testing' });
    try {
      const result = await testAiConnection(formRef.current);
      if (result.success) {
        setConnectionStatus({
          kind: 'success',
          message: result.responseTime
            ? `连接成功（${result.responseTime}ms${result.modelCount != null ? `，${result.modelCount} 个模型` : ''}）`
            : '连接成功',
        });
        await toast('AI连接测试成功', 'success');
      } else {
        setConnectionStatus({
          kind: 'error',
          message: result.error || '连接失败',
        });
        await toast(`AI连接测试失败: ${result.error}`, 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setConnectionStatus({ kind: 'error', message: msg });
      await toast('AI连接测试失败', 'error');
    } finally {
      setTestingConn(false);
    }
  };

  const onRefreshModels = async () => {
    if (refreshingModels) return;
    setRefreshingModels(true);
    try {
      const list = await refreshAiModels(formRef.current);
      setModels(list);
      await toast(`成功加载 ${list.length} 个模型`, 'success');
    } catch (err) {
      console.error('[AISettingsPage] refresh models failed', err);
      await toast('加载模型失败', 'error');
    } finally {
      setRefreshingModels(false);
    }
  };

  const runTestMessage = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) {
      await toast('请输入测试消息', 'warning');
      return;
    }
    if (sendingTest) return;

    // 发送前把当前表单（含 enabled/model）同步到 service
    try {
      await persistAiForm(formRef.current);
    } catch {
      /* 继续尝试 */
    }

    setSendingTest(true);
    setTestResult({ kind: 'loading', userMessage: trimmed });
    await toast('正在发送测试消息...', 'info');

    try {
      await sendAiTestMessage(trimmed, {
        onChunk: (_chunk, fullReply) => {
          setTestResult({
            kind: 'success',
            userMessage: trimmed,
            reply: fullReply,
            modelName: '',
            durationSec: 0,
            tokens: 0,
          });
        },
        onComplete: ({ fullReply, modelName, durationSec, tokens }) => {
          setTestResult({
            kind: 'success',
            userMessage: trimmed,
            reply: fullReply || '无回复内容',
            modelName,
            durationSec,
            tokens,
          });
          setTestInput('');
          void toast('测试消息发送成功', 'success');
          setSendingTest(false);
        },
        onError: (error) => {
          const errorMsg = error.message || '未知错误';
          const lines = errorMsg.split('\n');
          setTestResult({
            kind: 'error',
            message: lines[0] || errorMsg,
            details: lines.slice(1).filter((l) => l.trim()),
          });
          void toast(`测试失败: ${lines[0] || errorMsg}`, 'error');
          setSendingTest(false);
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err || '未知错误');
      setTestResult({ kind: 'error', message: errorMsg, details: [] });
      await toast(`测试失败: ${errorMsg}`, 'error');
      setSendingTest(false);
    }
  };

  const onExport = async () => {
    try {
      exportAiSettingsFile(formRef.current);
      await toast('AI设置已导出', 'success');
    } catch (err) {
      console.error('[AISettingsPage] export failed', err);
      await toast('导出AI设置失败', 'error');
    }
  };

  const onImport = async () => {
    try {
      const imported = await pickImportAiSettingsFile();
      if (!imported) return;
      const next = mergeImportedAiSettings(formRef.current, imported);
      setForm(next);
      await persistAiForm(next);
      await toast('AI设置已导入', 'success');
    } catch (err) {
      console.error('[AISettingsPage] import failed', err);
      await toast('导入AI设置失败', 'error');
    }
  };

  const onClearTest = async () => {
    setTestResult({ kind: 'idle' });
    setTestInput('');
    await toast('测试结果已清除', 'success');
  };

  const onReset = async () => {
    const confirmed = await showConfirm({
      title: '重置 AI 设置',
      message: '确定要重置所有AI设置吗？此操作不可撤销！',
      type: 'danger',
      confirmText: '重置',
    });
    if (!confirmed) return;
    try {
      await resetAiSettings();
      const next = await loadAiSettingsFromService();
      setForm(next);
      setModels([]);
      setConnectionStatus({ kind: 'idle' });
      setTestResult({ kind: 'idle' });
      await toast('AI设置已重置', 'success');
    } catch (err) {
      console.error('[AISettingsPage] reset failed', err);
      await toast('重置AI设置失败', 'error');
    }
  };

  return (
    <SettingsPageFrame
      title="AI设置"
      description="配置AI功能，对接New API兼容的AI服务，支持流式对话和多模型选择。"
      rootDataAttrs={{ 'data-ai-settings-react': '1' }}
      pageId="ai-settings"
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="ai-settings">
          <SettingSection title="基础配置" icon={<i className="fas fa-cog" />}>
            <SettingToggleRow
              id="aiEnabled"
              label="启用AI功能"
              description="开启后可以使用AI聊天和智能助手功能。"
              checked={form.enabled}
              onChange={(v) => void onEnabledChange(v)}
            />

            <SettingField
              id="aiApiUrl"
              label="API服务地址"
              description='支持OpenAI API或One API兼容的服务地址。（不需要加"/v1"）'
            >
              <Input
                id="aiApiUrl"
                type="url"
                disabled={disabled}
                placeholder="https://api.openai.com 或其他兼容服务地址"
                value={form.apiUrl}
                onChange={(e) => onCredentialChange('apiUrl', e.currentTarget.value)}
                onBlur={() => void onCredentialBlur()}
              />
            </SettingField>

            <SettingField
              id="aiApiKey"
              label="API密钥"
              description="从AI服务提供商获取的API密钥，用于身份验证。"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="aiApiKey"
                  type={apiKeyVisible ? 'text' : 'password'}
                  disabled={disabled}
                  className="min-w-0 flex-1"
                  placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={form.apiKey}
                  onChange={(e) => onCredentialChange('apiKey', e.currentTarget.value)}
                  onBlur={() => void onCredentialBlur()}
                />
                <Button
                  id="toggleApiKeyVisibility"
                  variant="secondary"
                  disabled={disabled}
                  aria-label={apiKeyVisible ? '隐藏密钥' : '显示密钥'}
                  onClick={() => setApiKeyVisible((v) => !v)}
                >
                  <i className={apiKeyVisible ? 'fas fa-eye-slash' : 'fas fa-eye'} aria-hidden="true" />{' '}
                  {apiKeyVisible ? '隐藏' : '显示'}
                </Button>
                <Button
                  id="testAiConnection"
                  variant="primary"
                  disabled={disabled || testingConn}
                  onClick={() => void onTestConnection()}
                >
                  <i className="fas fa-plug" aria-hidden="true" />{' '}
                  {testingConn ? '测试中…' : '测试连接'}
                </Button>
              </div>
            </SettingField>

            <div
              id="aiConnectionStatus"
              className={
                connectionStatus.kind === 'idle'
                  ? 'hidden'
                  : 'mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px]'
              }
              role="status"
            >
              {connectionStatus.kind === 'testing' ? (
                <span className="text-[var(--color-fg-muted)]">正在测试连接…</span>
              ) : null}
              {connectionStatus.kind === 'success' ? (
                <span className="text-[var(--color-success,#27ae60)]">{connectionStatus.message}</span>
              ) : null}
              {connectionStatus.kind === 'error' ? (
                <span className="text-[var(--color-danger,#c0392b)]">{connectionStatus.message}</span>
              ) : null}
            </div>
          </SettingSection>

          <SettingSection title="模型选择" icon={<i className="fas fa-brain" />}>
            <SettingField
              id="aiSelectedModel"
              label="当前模型"
              description="选择要使用的AI模型，不同模型有不同的能力和价格。"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SettingSelect
                    id="aiSelectedModel"
                    disabled={disabled}
                    value={form.selectedModel}
                    options={modelOptions}
                    onChange={(v) => void onModelChange(v)}
                  />
                </div>
                <Button
                  id="refreshModels"
                  variant="secondary"
                  disabled={disabled || refreshingModels}
                  onClick={() => void onRefreshModels()}
                >
                  <i className="fas fa-sync-alt" aria-hidden="true" />{' '}
                  {refreshingModels ? '加载中…' : '刷新'}
                </Button>
              </div>
            </SettingField>
            <div id="modelInfo" className="hidden" aria-hidden />
            <div id="modelStats" className="hidden" aria-hidden />
          </SettingSection>

          <SettingSection title="测试功能" icon={<i className="fas fa-vial" />}>
            <SettingField
              id="aiTestInput"
              label="测试对话"
              description="测试AI功能是否正常工作。"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="aiTestInput"
                  className="min-w-0 flex-1"
                  disabled={disabled || sendingTest}
                  placeholder="输入测试消息，例如：你好"
                  value={testInput}
                  onChange={(e) => setTestInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runTestMessage(testInput);
                    }
                  }}
                />
                <Button
                  id="sendTestMessage"
                  variant="primary"
                  disabled={disabled || sendingTest}
                  onClick={() => void runTestMessage(testInput)}
                >
                  <i className="fas fa-paper-plane" aria-hidden="true" />{' '}
                  {sendingTest ? '发送中…' : '发送'}
                </Button>
              </div>
            </SettingField>

            <div
              id="aiTestResult"
              className={
                testResult.kind === 'idle'
                  ? 'hidden'
                  : 'mx-2 mb-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-[13px] text-[var(--color-fg)]'
              }
            >
              {testResult.kind === 'loading' ? (
                <div className="flex flex-col gap-2">
                  <div className="rounded-[var(--radius-2)] bg-[var(--color-surface)] px-3 py-2">
                    <div className="text-[11px] text-[var(--color-fg-muted)]">你</div>
                    <div>{testResult.userMessage}</div>
                  </div>
                  <div className="rounded-[var(--radius-2)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-fg-muted)]">
                    AI 正在回复…
                  </div>
                </div>
              ) : null}
              {testResult.kind === 'success' ? (
                <div className="flex flex-col gap-2">
                  <div className="rounded-[var(--radius-2)] bg-[var(--color-surface)] px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[var(--color-fg-muted)]">你</span>
                      <button
                        type="button"
                        className="text-[11px] text-[var(--color-primary)] underline"
                        onClick={() => void runTestMessage(testResult.userMessage)}
                      >
                        重新发送
                      </button>
                    </div>
                    <div>{testResult.userMessage}</div>
                  </div>
                  <div className="rounded-[var(--radius-2)] bg-[var(--color-surface)] px-3 py-2">
                    <div className="mb-1 text-[11px] text-[var(--color-fg-muted)]">AI</div>
                    <div className="whitespace-pre-wrap">{testResult.reply || '无回复内容'}</div>
                    {testResult.durationSec > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--color-fg-muted)]">
                        {testResult.modelName ? <span>{testResult.modelName}</span> : null}
                        <span>约 {testResult.tokens} tokens</span>
                        <span>{testResult.durationSec.toFixed(2)}秒</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {testResult.kind === 'error' ? (
                <div>
                  <div className="font-semibold text-[var(--color-danger,#c0392b)]">测试失败</div>
                  <p className="m-0 mt-1">
                    <strong>错误:</strong> {testResult.message}
                  </p>
                  {testResult.details.map((line) => (
                    <p key={line} className="m-0 mt-1 text-[12px] text-[var(--color-fg-muted)]">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </SettingSection>

          <SettingSection title="对话参数" icon={<i className="fas fa-cog" />} description="参数变更后约 0.4 秒自动保存。">
            <div className="grid gap-2 sm:grid-cols-2">
              <SettingField
                id="aiTemperature"
                label={
                  <span>
                    创造性: <span id="temperatureValue">{form.temperature.toFixed(1)}</span>
                  </span>
                }
                description="控制AI回答的创造性，值越高越有创意，值越低越准确。"
              >
                <input
                  id="aiTemperature"
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.1}
                  disabled={disabled}
                  value={form.temperature}
                  className="w-full accent-[var(--color-primary)]"
                  onChange={(e) =>
                    onConversationNumber('temperature', e.currentTarget.value, false)
                  }
                />
              </SettingField>

              <SettingField
                id="aiMaxTokens"
                label="最大回复长度"
                description="限制AI单次回复的最大长度，1 token ≈ 0.75个英文单词。支持1-1,000,000 tokens。"
              >
                <Input
                  id="aiMaxTokens"
                  type="number"
                  min={1}
                  max={1_000_000}
                  disabled={disabled}
                  value={String(form.maxTokens)}
                  onChange={(e) => onConversationNumber('maxTokens', e.currentTarget.value, false)}
                  onBlur={(e) => onConversationNumber('maxTokens', e.currentTarget.value, true)}
                />
              </SettingField>

              <SettingField
                id="aiTimeout"
                label="超时时间 (秒)"
                description="API请求的超时时间，建议30-600秒。"
              >
                <Input
                  id="aiTimeout"
                  type="number"
                  min={5}
                  max={600}
                  disabled={disabled}
                  value={String(form.timeout)}
                  onChange={(e) => onConversationNumber('timeout', e.currentTarget.value, false)}
                  onBlur={(e) => onConversationNumber('timeout', e.currentTarget.value, true)}
                />
              </SettingField>

              <SettingField
                id="aiAutoRetryMax"
                label="最大重试次数"
                description="仅在开启自动重试时生效（建议 0-5 次）。"
              >
                <Input
                  id="aiAutoRetryMax"
                  type="number"
                  min={0}
                  max={10}
                  disabled={disabled}
                  value={String(form.autoRetryMax)}
                  onChange={(e) =>
                    onConversationNumber('autoRetryMax', e.currentTarget.value, false)
                  }
                  onBlur={(e) =>
                    onConversationNumber('autoRetryMax', e.currentTarget.value, true)
                  }
                />
              </SettingField>

              <SettingField
                id="aiErrorRetryMax"
                label="错误重试最大次数"
                description="建议 0-3 次。"
              >
                <Input
                  id="aiErrorRetryMax"
                  type="number"
                  min={0}
                  max={10}
                  disabled={disabled}
                  value={String(form.errorRetryMax)}
                  onChange={(e) =>
                    onConversationNumber('errorRetryMax', e.currentTarget.value, false)
                  }
                  onBlur={(e) =>
                    onConversationNumber('errorRetryMax', e.currentTarget.value, true)
                  }
                />
              </SettingField>
            </div>

            <SettingField
              id="aiSystemPrompt"
              label="系统提示词"
              description="定义AI的角色和行为方式，影响所有对话的回复风格。"
            >
              <textarea
                id="aiSystemPrompt"
                rows={2}
                disabled={disabled}
                className="min-h-[4rem] w-full resize-y rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus-visible:border-[var(--color-primary)] focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="你是一个有用的AI助手，请用中文回答问题。"
                value={form.systemPrompt}
                onChange={(e) => onSystemPromptChange(e.currentTarget.value)}
              />
            </SettingField>

            <SettingToggleRow
              id="aiStreamEnabled"
              label="启用流式输出"
              description="实时显示AI回复内容，类似ChatGPT的打字效果。"
              checked={form.streamEnabled}
              disabled={disabled}
              onChange={(v) => onConversationToggle('streamEnabled', v)}
            />
            <SettingToggleRow
              id="aiAutoRetryEmpty"
              label="自动重试（空回复）"
              description="当 AI 返回空内容时自动重新请求。"
              checked={form.autoRetryEmpty}
              disabled={disabled}
              onChange={(v) => onConversationToggle('autoRetryEmpty', v)}
            />
            <SettingToggleRow
              id="aiErrorRetryEnabled"
              label="错误重试（超时/网络/429/5xx）"
              description="开启后遇到可恢复错误将自动指数退避重试。"
              checked={form.errorRetryEnabled}
              disabled={disabled}
              onChange={(v) => onConversationToggle('errorRetryEnabled', v)}
            />
          </SettingSection>

          <SettingSection title="高级功能" icon={<i className="fas fa-tools" />}>
            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button id="exportAiSettings" variant="secondary" onClick={() => void onExport()}>
                <i className="fas fa-download" aria-hidden="true" /> 导出设置
              </Button>
              <Button id="importAiSettings" variant="secondary" onClick={() => void onImport()}>
                <i className="fas fa-upload" aria-hidden="true" /> 导入设置
              </Button>
              <Button id="clearTestResults" variant="secondary" onClick={() => void onClearTest()}>
                <i className="fas fa-eraser" aria-hidden="true" /> 清除测试结果
              </Button>
              <Button id="resetAiSettings" variant="danger" onClick={() => void onReset()}>
                <i className="fas fa-undo" aria-hidden="true" /> 重置为默认
              </Button>
            </div>
            <p className="m-0 px-2 pb-2 text-[12px] text-[var(--color-fg-muted)]">
              导出设置用于备份，导入设置用于恢复配置（不包含API密钥）。
            </p>
          </SettingSection>
        </div>
      )}
    </SettingsPageFrame>
  );
}
