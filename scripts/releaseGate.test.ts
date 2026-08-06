import { describe, expect, it } from 'vitest';
import {
  assertReleaseManifest,
  assertReleaseFileSet,
  assertReleaseVersionArtifacts,
  assertSafeReleaseEntries,
  assertSourceManifest,
  getForbiddenReleaseEntryReason,
} from './releaseGate';

describe('release gate', () => {
  it('accepts the locked 2.0.0 source identity and version artifacts', () => {
    const artifacts = assertReleaseVersionArtifacts();
    expect(artifacts.version).toBe('2.0.0');
    expect(artifacts.build).toBeGreaterThanOrEqual(0);
    expect(() => assertSourceManifest({ version: '2.0.0' })).not.toThrow();
    expect(() => assertSourceManifest({ version: '2.0.0', key: 'accidental' })).toThrow(/源码 manifest/);
    expect(() => assertReleaseManifest({ version: '2.0.0', key: 'invalid' })).toThrow(/does not match locked identity/);
  });

  it('rejects release entries that can leak local credentials or debug data', () => {
    expect(getForbiddenReleaseEntryReason('key.pem')).toBe('凭据或环境文件');
    expect(getForbiddenReleaseEntryReason('assets/.env.local')).toBe('凭据或环境文件');
    expect(getForbiddenReleaseEntryReason('assets/credentials.json')).toBe('凭据或环境文件');
    expect(getForbiddenReleaseEntryReason('assets/server.pem')).toBe('凭据或环境文件');
    expect(getForbiddenReleaseEntryReason('assets/private.key')).toBe('凭据或环境文件');
    expect(getForbiddenReleaseEntryReason('data/local.sqlite')).toBe('本地数据库文件');
    expect(getForbiddenReleaseEntryReason('test-results/report.json')).toBe('测试文件');
    expect(getForbiddenReleaseEntryReason('assets/page.js')).toBeUndefined();
    expect(() => assertSafeReleaseEntries(['key.pem'])).toThrow(/禁止文件/);
  });

  it('rejects ZIP file sets that differ from the built dist file set', () => {
    expect(() => assertReleaseFileSet(['manifest.json', 'assets/app.js'], ['manifest.json', 'assets/app.js'])).not.toThrow();
    expect(() => assertReleaseFileSet(['manifest.json'], ['manifest.json', 'assets/app.js'])).toThrow(/缺少/);
    expect(() => assertReleaseFileSet(['manifest.json', 'assets/app.js', 'extra.js'], ['manifest.json', 'assets/app.js'])).toThrow(/多出/);
  });
});
