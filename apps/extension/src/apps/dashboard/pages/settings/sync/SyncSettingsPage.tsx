/**
 * @file SyncSettingsPage.tsx
 * @description 同步设置 React 全页
 * @module apps/dashboard/pages/settings/sync
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingToggleRow } from '../../../../../ui/patterns/SettingToggleRow/SettingToggleRow';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  testActorSyncConnection,
  testActorSyncParsing,
  type SyncTestResult,
} from './syncSettingsActions';
import {
  applySyncFormToSettings,
  DEFAULT_SYNC_SETTINGS_FORM,
  mapSettingsToSyncForm,
  validateSyncForm,
  type SyncSettingsFormState,
} from './syncSettingsModel';

const AUTO_SAVE_MS = 500;

function parseNum(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 同步设置完整页面
 */
export function SyncSettingsPage() {
  const [form, setForm] = useState<SyncSettingsFormState>(DEFAULT_SYNC_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SyncTestResult | null>(null);
  const [testingConn, setTestingConn] = useState(false);
  const [testingParse, setTestingParse] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  const persist = useCallback(async (nextForm: SyncSettingsFormState) => {
    const v = validateSyncForm(nextForm);
    if (!v.isValid) {
      setSaveError(v.errors[0] || '校验失败');
      return;
    }
    try {
      const current = await getSettings();
      const next = applySyncFormToSettings(current, nextForm);
      await saveSettings(next);
      await syncDashboardState(next);
      setSaveError(null);
    } catch (err) {
      console.error('[SyncSettingsPage] save failed', err);
      setSaveError(err instanceof Error ? err.message : '保存失败');
    }
  }, []);

  const { scheduleSave } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        const next = mapSettingsToSyncForm(settings);
        formRef.current = next;
        setForm(next);
      } catch (err) {
        console.error('[SyncSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    <K extends keyof SyncSettingsFormState>(key: K, value: SyncSettingsFormState[K]) => {
      const next = { ...formRef.current, [key]: value };
      formRef.current = next;
      setForm(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const actorDisabled = !form.actorEnabled;

  const onTestConnection = async () => {
    setTestingConn(true);
    try {
      const r = await testActorSyncConnection(form.actorCollectionUrl);
      setTestResult(r);
    } finally {
      setTestingConn(false);
    }
  };

  const onTestParsing = async () => {
    setTestingParse(true);
    try {
      const r = await testActorSyncParsing();
      setTestResult(r);
    } finally {
      setTestingParse(false);
    }
  };

  return (
    <SettingsPageFrame
      title="同步设置"
      description="配置从JavDB同步观看记录、想看列表和演员数据的URL地址和行为参数。"
      rootDataAttrs={{ 'data-sync-settings-react': '1' }}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="sync-settings">
          <SettingSection
            title="视频数据同步配置"
            icon={<i className="fas fa-video" />}
            description="配置观看记录和想看列表的同步URL地址，页码参数将由程序自动添加。"
          >
            <SettingField
              id="dataSyncWantWatchUrl"
              label="想看列表URL"
              description="想看视频列表的URL地址，程序会自动添加页码参数。"
            >
              <Input
                id="dataSyncWantWatchUrl"
                type="url"
                value={form.wantWatchUrl}
                onChange={(e) => update('wantWatchUrl', e.currentTarget.value)}
              />
            </SettingField>
            <SettingField
              id="dataSyncWatchedVideosUrl"
              label="已看列表URL"
              description="已观看视频列表的URL地址，程序会自动添加页码参数。"
            >
              <Input
                id="dataSyncWatchedVideosUrl"
                type="url"
                value={form.watchedVideosUrl}
                onChange={(e) => update('watchedVideosUrl', e.currentTarget.value)}
              />
            </SettingField>
          </SettingSection>

          <SettingSection
            title="演员数据同步配置"
            icon={<i className="fas fa-users" />}
            description="配置演员数据同步的行为和URL地址。"
          >
            <SettingToggleRow
              id="actorSyncEnabled"
              label="启用演员同步功能"
              description="开启后可以从JavDB同步收藏演员数据到本地。"
              checked={form.actorEnabled}
              onChange={(c) => update('actorEnabled', c)}
            />
            <SettingToggleRow
              id="actorAutoSync"
              label="自动同步演员数据"
              description="定期自动同步演员数据，避免手动操作。"
              checked={form.actorAutoSync}
              disabled={actorDisabled}
              onChange={(c) => update('actorAutoSync', c)}
            />
            <SettingField
              id="actorSyncInterval"
              label="演员同步间隔 (分钟)"
              description="自动同步演员数据的时间间隔，建议设置为24小时(1440分钟)或更长。"
            >
              <Input
                id="actorSyncInterval"
                type="number"
                min={60}
                max={10080}
                disabled={actorDisabled}
                value={String(form.actorSyncInterval)}
                onChange={(e) =>
                  update('actorSyncInterval', parseNum(e.currentTarget.value, form.actorSyncInterval))
                }
              />
            </SettingField>
            <SettingField
              id="actorSyncCollectionUrl"
              label="收藏演员URL"
              description="收藏演员列表的URL地址，程序会自动添加页码参数。"
            >
              <Input
                id="actorSyncCollectionUrl"
                type="url"
                disabled={actorDisabled}
                value={form.actorCollectionUrl}
                onChange={(e) => update('actorCollectionUrl', e.currentTarget.value)}
              />
            </SettingField>
            <SettingField
              id="actorSyncDetailUrl"
              label="演员详情URL模板"
              description="演员详情页的URL模板，{{ACTOR_ID}}将被替换为实际的演员ID。"
            >
              <Input
                id="actorSyncDetailUrl"
                type="text"
                disabled={actorDisabled}
                value={form.actorDetailUrl}
                onChange={(e) => update('actorDetailUrl', e.currentTarget.value)}
              />
            </SettingField>
          </SettingSection>

          <SettingSection
            title="通用同步行为配置"
            icon={<i className="fas fa-cog" />}
            description="配置所有数据同步时的请求间隔和批量处理设置。"
          >
            <div className="grid gap-1 sm:grid-cols-2">
              <SettingField
                id="dataSyncRequestInterval"
                label="请求间隔 (秒)"
                description="每次请求之间的间隔时间，建议至少3秒。"
              >
                <Input
                  id="dataSyncRequestInterval"
                  type="number"
                  min={1}
                  max={60}
                  value={String(form.requestInterval)}
                  onChange={(e) =>
                    update('requestInterval', parseNum(e.currentTarget.value, form.requestInterval))
                  }
                />
              </SettingField>
              <SettingField
                id="dataSyncBatchSize"
                label="批量处理大小"
                description="每批处理的视频数量，建议 20-50。"
              >
                <Input
                  id="dataSyncBatchSize"
                  type="number"
                  min={10}
                  max={100}
                  value={String(form.batchSize)}
                  onChange={(e) =>
                    update('batchSize', parseNum(e.currentTarget.value, form.batchSize))
                  }
                />
              </SettingField>
              <SettingField
                id="dataSyncMaxRetries"
                label="最大重试次数"
                description="网络请求失败时的最大重试次数。"
              >
                <Input
                  id="dataSyncMaxRetries"
                  type="number"
                  min={1}
                  max={10}
                  value={String(form.maxRetries)}
                  onChange={(e) =>
                    update('maxRetries', parseNum(e.currentTarget.value, form.maxRetries))
                  }
                />
              </SettingField>
              <SettingField
                id="actorSyncRequestInterval"
                label="演员同步请求间隔 (秒)"
                description="演员详情页请求间隔，建议至少3秒。"
              >
                <Input
                  id="actorSyncRequestInterval"
                  type="number"
                  min={3}
                  max={60}
                  disabled={actorDisabled}
                  value={String(form.actorRequestInterval)}
                  onChange={(e) =>
                    update(
                      'actorRequestInterval',
                      parseNum(e.currentTarget.value, form.actorRequestInterval),
                    )
                  }
                />
              </SettingField>
              <SettingField
                id="actorSyncBatchSize"
                label="演员批量处理大小"
                description="每批处理的演员数量，通常一页包含20个演员。"
              >
                <Input
                  id="actorSyncBatchSize"
                  type="number"
                  min={10}
                  max={50}
                  disabled={actorDisabled}
                  value={String(form.actorBatchSize)}
                  onChange={(e) =>
                    update('actorBatchSize', parseNum(e.currentTarget.value, form.actorBatchSize))
                  }
                />
              </SettingField>
              <SettingField
                id="actorSyncMaxRetries"
                label="演员同步最大重试次数"
                description="演员数据获取失败时的最大重试次数。"
              >
                <Input
                  id="actorSyncMaxRetries"
                  type="number"
                  min={1}
                  max={10}
                  disabled={actorDisabled}
                  value={String(form.actorMaxRetries)}
                  onChange={(e) =>
                    update('actorMaxRetries', parseNum(e.currentTarget.value, form.actorMaxRetries))
                  }
                />
              </SettingField>
            </div>
          </SettingSection>

          <SettingSection title="测试功能" icon={<i className="fas fa-vial" />} description="测试同步配置是否正确。">
            <div className="flex flex-wrap gap-2 px-2 py-2">
              <Button
                id="testActorSyncConnection"
                variant="secondary"
                disabled={actorDisabled || testingConn}
                onClick={() => void onTestConnection()}
              >
                <i className="fas fa-plug" aria-hidden="true" />{' '}
                {testingConn ? '测试中…' : '测试演员同步连接'}
              </Button>
              <Button
                id="testActorSyncParsing"
                variant="primary"
                disabled={actorDisabled || testingParse}
                onClick={() => void onTestParsing()}
              >
                <i className="fas fa-vial" aria-hidden="true" />{' '}
                {testingParse ? '测试中…' : '测试演员数据解析'}
              </Button>
            </div>
            <div id="actorSyncTestResults" className="px-2 pb-2" role="status">
              {testResult ? (
                <p
                  className={
                    testResult.tone === 'success'
                      ? 'm-0 text-[13px] text-[var(--color-success,#1e8e3e)]'
                      : testResult.tone === 'error'
                        ? 'm-0 text-[13px] text-[var(--color-danger,#c0392b)]'
                        : 'm-0 text-[13px] text-[var(--color-fg-muted)]'
                  }
                >
                  {testResult.message}
                </p>
              ) : null}
            </div>
          </SettingSection>

          {saveError ? (
            <p className="m-0 text-[12.5px] text-[var(--color-danger,#c0392b)]" role="alert">
              保存失败：{saveError}
            </p>
          ) : null}
        </div>
      )}
    </SettingsPageFrame>
  );
}
