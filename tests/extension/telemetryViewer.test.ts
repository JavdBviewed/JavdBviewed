/**
 * @file telemetryViewer.test.ts
 * @description 遥测数据查看器：示例 body（heartbeat 口径）必须与真实上报 body 同构、不回写状态、不含库内容
 * @module tests/extension
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../../apps/extension/src/utils/config';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';

const PREVIEW_SETTINGS = {
  ...DEFAULT_SETTINGS,
  webdav: {
    ...DEFAULT_SETTINGS.webdav,
    clientId: '1f2e3d4c-5b6a-4789-9a0b-c1d2e3f4a5b6',
  },
  telemetry: {
    ...DEFAULT_SETTINGS.telemetry,
    channel: 'beta',
  },
};

const PREVIEW_NOW = new Date('2026-09-30T02:30:00.000Z');

async function loadViewer() {
  return import('../../apps/extension/src/features/telemetry');
}

describe('telemetry payload preview', () => {
  it('示例 body 的字段集合与真实构造器 heartbeat 输出完全一致（不另起一套定义）', async () => {
    const {
      buildTelemetryPayload,
      buildTelemetryPayloadPreview,
      peekTelemetryClientState,
      TELEMETRY_PREVIEW_EVENTS,
    } = await loadViewer();

    expect([...TELEMETRY_PREVIEW_EVENTS]).toEqual(['startup', 'heartbeat', 'error_report']);

    // 查看器简化后固定取 heartbeat（最高频的真实上报类型）作为示例 body 口径
    const event = 'heartbeat' as const;
    const payload = await buildTelemetryPayloadPreview(event, {
      settings: PREVIEW_SETTINGS,
      now: PREVIEW_NOW,
    });
    const state = await peekTelemetryClientState(PREVIEW_SETTINGS, PREVIEW_NOW);
    const real = await buildTelemetryPayload({ event, settings: PREVIEW_SETTINGS, state, now: PREVIEW_NOW });

    expect(Object.keys(payload)).toEqual(Object.keys(real));
    expect(Object.keys(payload.client)).toEqual(Object.keys(real.client));
    expect(Object.keys(payload.activity)).toEqual(Object.keys(real.activity));
    expect(Object.keys(payload.metrics)).toEqual(Object.keys(real.metrics));
    expect(payload.event).toBe(event);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.anonymous).toBe(true);
    expect((payload as any).client.channel).toBe('beta');
    expect((payload as any).error).toBeUndefined();
  });

  it('预览只读：绝不回写 telemetry_client_state，也不发送请求', async () => {
    const {
      buildTelemetryPayloadPreview,
      getTelemetryClientState,
      TELEMETRY_CLIENT_STATE_KEY,
    } = await loadViewer();

    setChromeStorage({ [STORAGE_KEYS.SETTINGS]: PREVIEW_SETTINGS });
    expect(getChromeStorageSnapshot()[TELEMETRY_CLIENT_STATE_KEY]).toBeUndefined();

    await buildTelemetryPayloadPreview('startup', { settings: PREVIEW_SETTINGS, now: PREVIEW_NOW });
    await buildTelemetryPayloadPreview('error_report', { settings: PREVIEW_SETTINGS, now: PREVIEW_NOW });
    expect(getChromeStorageSnapshot()[TELEMETRY_CLIENT_STATE_KEY]).toBeUndefined();

    // 对照：真实上报路径会持久化同一 key（说明两者的唯一差异就是回写）
    await getTelemetryClientState(PREVIEW_SETTINGS, PREVIEW_NOW);
    expect(getChromeStorageSnapshot()[TELEMETRY_CLIENT_STATE_KEY]).toBeTruthy();
  });

  it('预览通过敏感形态自查，且本地库内容只以分桶出现', async () => {
    const { buildTelemetryPayloadPreview, findTelemetryPayloadSensitiveValues } = await loadViewer();

    setChromeStorage({
      [STORAGE_KEYS.VIEWED_RECORDS]: {
        'SSIS-001': { title: '示例标题-绝不应外泄', actor: '示例演员-绝不应外泄' },
      },
      [STORAGE_KEYS.ACTOR_RECORDS]: { '三上优亚': { name: '三上优亚' } },
      [STORAGE_KEYS.NEW_WORKS_SUBSCRIPTIONS]: { 'MIDE-123': {} },
    });

    const payload = await buildTelemetryPayloadPreview('heartbeat', {
      settings: PREVIEW_SETTINGS,
      now: PREVIEW_NOW,
    });

    expect(findTelemetryPayloadSensitiveValues(payload)).toEqual([]);

    const json = JSON.stringify(payload);
    expect(json).not.toContain('SSIS-001');
    expect(json).not.toContain('MIDE-123');
    expect(json).not.toContain('示例标题');
    expect(json).not.toContain('三上优亚');
    expect(json).not.toContain('example.invalid');
    expect(payload.metrics.viewedCountBucket).toBe('1-9');
    expect(payload.metrics.actorCountBucket).toBe('1-9');
    expect(payload.metrics.newWorksSubscriptionCountBucket).toBe('1-9');
    expect(payload.features).toBeTruthy();
    expect(Object.values(payload.features).every((value) => typeof value === 'boolean')).toBe(true);
  });

  it('错误示例走真实脱敏链路：堆栈不落原文', async () => {
    const { buildTelemetryPayloadPreviewWithSample } = await loadViewer();

    const preview = await buildTelemetryPayloadPreviewWithSample('error_report', {
      settings: PREVIEW_SETTINGS,
      now: PREVIEW_NOW,
    });
    const json = JSON.stringify(preview.payload);

    expect(json).not.toContain('telemetry payload preview sample');
    expect(json).not.toContain('at ');
    expect(json).not.toContain('.ts');
    expect(json).not.toContain('payloadPreview');
  });
});
