/**
 * @file payloadHygiene.test.ts
 * @description 遥测负载敏感字段自查规则回归
 * @module features/telemetry
 */
import { describe, expect, it } from 'vitest';
import {
  describeTelemetrySensitiveFindings,
  findTelemetryPayloadSensitiveValues,
} from './payloadHygiene';

/** 贴近真实 body 的干净样本（含时区、分桶、随机 ID、堆栈哈希等易误判形态） */
const CLEAN_PAYLOAD = {
  schemaVersion: 1,
  eventId: 'event-6f1c2b3a-4d5e-4f60-8a9b-0c1d2e3f4a5b',
  deviceId: '1f2e3d4c-5b6a-4789-9a0b-c1d2e3f4a5b6', // 真实形态：settings.webdav.clientId 为裸 uuid
  installId: 'install-1f2e3d4c-beef-1234-a1b2-c3d4e5f6a7b8',
  anonymous: true,
  event: 'startup',
  client: {
    extensionVersion: '2.1.0',
    build: 232,
    channel: 'stable',
    browser: 'Chrome',
    browserVersion: '140.0.0.0',
    platform: 'linux',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
  },
  activity: {
    sessionId: 'session-9a8b7c6d-1234-abcd-9876-fedcba987654',
    activityAt: '2026-09-30T02:30:00.000Z',
    sessionStartedAt: '2026-09-30T01:30:00.000Z',
    activeDurationSeconds: 3600,
    surface: 'background',
  },
  features: {
    webdavEnabled: true,
    contentFilterEnabled: false,
  },
  metrics: {
    viewedCountBucket: '1000-1999',
    actorCountBucket: '1-9',
    newWorksSubscriptionCountBucket: '0',
    enabledMagnetSourceCountBucket: '10-49',
  },
  error: {
    component: 'background',
    code: 'BACKGROUND_UNHANDLED_ERROR',
    message: 'TypeError',
    stackHash: `sha256-${'a'.repeat(64)}`,
    fatal: false,
  },
  sentAt: '2026-09-30T02:30:00.000Z',
};

describe('telemetry payload hygiene scan', () => {
  it('真实 body 形态（时区/分桶/随机 ID/堆栈哈希）不误判为敏感', () => {
    expect(findTelemetryPayloadSensitiveValues(CLEAN_PAYLOAD)).toEqual([]);
    expect(describeTelemetrySensitiveFindings([])).toBe('未发现敏感字段形态');
  });

  it('命中 URL、磁力、邮箱、绝对路径与番号明文，并给出字段路径', () => {
    const findings = findTelemetryPayloadSensitiveValues({
      client: { page: 'https://javdb570.com/v1234567' },
      activity: { link: 'magnet:?xt=urn:btih:deadbeef' },
      account: { mail: 'someone@example.com' },
      storage: { path: '/home/ryen/Videos/abc.mkv' },
      library: { code: 'SSIS-001' },
    });

    expect(findings.map((finding) => finding.path)).toEqual([
      '$.client.page',
      '$.activity.link',
      '$.account.mail',
      '$.storage.path',
      '$.library.code',
    ]);
    expect(findings.map((finding) => finding.pattern)).toEqual([
      'url',
      'magnet',
      'email',
      'absolutePath',
      'mediaCode',
    ]);
    expect(describeTelemetrySensitiveFindings(findings)).toContain('$.library.code（mediaCode）');
  });

  it('数组与嵌套结构同样被扫描，数字/布尔不扫描', () => {
    const findings = findTelemetryPayloadSensitiveValues({
      list: ['ok', { nested: 'C:\\Users\\ryen\\secret' }],
      count: 2000,
      flag: true,
      missing: null,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('$.list[1].nested');
    expect(findings[0].pattern).toBe('absolutePath');
  });

  it('番号形态只认整段值，随机标识不误判', () => {
    // 真实 body 里的标识形态：带前缀多段 uuid / 裸 uuid，均不应命中
    expect(findTelemetryPayloadSensitiveValues({ id: 'session-abcd-1234-5678' })).toEqual([]);
    expect(findTelemetryPayloadSensitiveValues({ id: 'event-6f1c2b3a-4d5e-4f60-8a9b-0c1d2e3f4a5b' })).toEqual([]);
    expect(findTelemetryPayloadSensitiveValues({ id: 'install-1f2e3d4c-beef-1234-a1b2-c3d4e5f6a7b8' })).toEqual([]);
    expect(findTelemetryPayloadSensitiveValues({ id: '1f2e3d4c-5b6a-4789-9a0b-c1d2e3f4a5b6' })).toEqual([]);
    expect(findTelemetryPayloadSensitiveValues({ id: 'sha256-' + 'a'.repeat(64) })).toEqual([]);

    // 整段就是番号形态（大小写皆算）必须命中，这是刻意保守的代价：真实 body 无此形态
    expect(findTelemetryPayloadSensitiveValues({ id: 'STARS-1234' })).toHaveLength(1);
    expect(findTelemetryPayloadSensitiveValues({ id: 'abc-1234' })).toHaveLength(1);
    expect(findTelemetryPayloadSensitiveValues({ id: 'ssis-001' })).toHaveLength(1);

    // 番号出现在更长串里（非整段）不判为敏感，避免误伤随机标识
    expect(findTelemetryPayloadSensitiveValues({ id: 'prefix-SSIS-001-suffix' })).toEqual([]);
  });
});
