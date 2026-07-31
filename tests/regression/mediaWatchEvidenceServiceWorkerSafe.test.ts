/**
 * @file mediaWatchEvidenceServiceWorkerSafe.test.ts
 * @description 115 观看证据后台写入回归：避免把 DOM 依赖带进 MV3 service worker
 * @module tests/regression
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('media watch evidence service worker safety', () => {
  it('keeps mediaWatchEvidence free from shared storage chunks and DOM-only imports', () => {
    const source = fs.readFileSync(
      path.resolve(root, 'apps/extension/src/features/media/mediaWatchEvidence.ts'),
      'utf8',
    );

    expect(source).not.toContain("platform/storage/chromeStorage");
    expect(source).not.toMatch(/from ['"][^'"]*utils\/config['"]/);
    expect(source).not.toMatch(/from ['"][^'"]*utils\/storage['"]/);
    expect(source).toMatch(/chrome\.storage\??\.local/);
    expect(source).toContain("const MEDIA_WATCH_EVIDENCE_STORAGE_KEY = 'media_watch_evidence'");
  });

  it('routes MEDIA_WATCH_EVIDENCE_REPORT without Vite dynamic import preload helper', () => {
    const source = fs.readFileSync(
      path.resolve(root, 'apps/extension/src/apps/background/miscMessageRouter.ts'),
      'utf8',
    );

    expect(source).toContain("from '../../features/media/mediaWatchEvidence'");
    expect(source).not.toContain("await import('../../features/media/mediaWatchEvidence')");
  });
});
