/**
 * @file payloadHygiene.ts
 * @description 遥测负载敏感字段自查 —— 只读扫描，命中即返回路径，不修改负载
 * @module features/telemetry
 */

export type TelemetrySensitivePatternId =
  | 'url'
  | 'magnet'
  | 'email'
  | 'absolutePath'
  | 'mediaCode';

export interface TelemetrySensitiveFinding {
  /** 命中字段路径，例：$.client.timezone */
  path: string;
  /** 命中的敏感形态 */
  pattern: TelemetrySensitivePatternId;
  /** 命中值（最多保留 80 字符，避免预览自身过长） */
  value: string;
}

interface SensitiveRule {
  id: TelemetrySensitivePatternId;
  test: (text: string) => boolean;
}

/**
 * 规则刻意保守：只认「整段值就是番号形态」「明确的 URL/磁力 scheme」这类高置信形态，
 * 避免把 Asia/Shanghai 之类的时区、1-9 之类的分桶、随机 ID 误判成敏感字段。
 */
const SENSITIVE_RULES: SensitiveRule[] = [
  {
    id: 'url',
    test: (text) => /(https?|chrome-extension|chrome-search|file|blob|javascript|data):\/\//i.test(text),
  },
  {
    id: 'magnet',
    test: (text) => /magnet:\?/i.test(text) || /\.torrent\b/i.test(text),
  },
  {
    id: 'email',
    test: (text) => /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.test(text),
  },
  {
    id: 'absolutePath',
    test: (text) => /(?:^|[\s([=])(?:\/[^\s/()]+){2,}(?=$|[\s)]]|[,:])/.test(text)
      || /^[A-Za-z]:[\\/]/.test(text)
      || /^\\\\/.test(text),
  },
  {
    id: 'mediaCode',
    test: (text) => /^[A-Za-z]{2,8}[-_]\d{3,5}[A-Za-z]?$/.test(text.trim()),
  },
];

/**
 * 扫描遥测负载里所有字符串值，返回疑似敏感字段（无命中返回空数组）。
 * 数字与布尔不扫描：遥测里的数量一律是分桶字符串，精确数量本身不该出现。
 */
export function findTelemetryPayloadSensitiveValues(payload: unknown): TelemetrySensitiveFinding[] {
  const findings: TelemetrySensitiveFinding[] = [];
  walk(payload, '$', findings);
  return findings;
}

function walk(value: unknown, path: string, findings: TelemetrySensitiveFinding[]): void {
  if (typeof value === 'string') {
    for (const rule of SENSITIVE_RULES) {
      if (rule.test(value)) {
        findings.push({ path, pattern: rule.id, value: value.slice(0, 80) });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, findings));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      walk(item, `${path}.${key}`, findings);
    }
  }
}

export function describeTelemetrySensitiveFindings(findings: TelemetrySensitiveFinding[]): string {
  if (!findings.length) return '未发现敏感字段形态';
  return findings.map((finding) => `${finding.path}（${finding.pattern}）`).join('、');
}
