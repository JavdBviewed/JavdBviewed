import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertReleaseManifest,
  assertReleaseFileSet,
  assertReleaseVersionArtifacts,
  assertSafeReleaseEntries,
  buildPnpmInvocation,
  assertSourceManifest,
  getForbiddenReleaseEntryReason,
} from './releaseGate';

describe('release gate', () => {
  it('uses the version declared by version.json instead of a historical release constant', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'javdb-release-gate-'));
    const version = '2.0.2';

    try {
      fs.mkdirSync(path.join(root, 'apps/extension/src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version, build: 1 }));
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
      fs.writeFileSync(path.join(root, 'apps/extension/package.json'), JSON.stringify({ version }));
      fs.writeFileSync(path.join(root, 'apps/extension/src/manifest.json'), JSON.stringify({ version }));

      expect(assertReleaseVersionArtifacts(root)).toMatchObject({ version, build: 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts the configured source identity and version artifacts', () => {
    const artifacts = assertReleaseVersionArtifacts();
    const sourceVersion = artifacts.version;
    expect(sourceVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(artifacts.build).toBeGreaterThanOrEqual(0);
    expect(() => assertSourceManifest({ version: sourceVersion }, sourceVersion)).not.toThrow();
    expect(() => assertSourceManifest({ version: '0.0.0' }, sourceVersion)).toThrow(/源码 manifest/);
    expect(() => assertSourceManifest({ version: sourceVersion, key: 'accidental' }, sourceVersion)).toThrow(/源码 manifest/);
    expect(() => assertReleaseManifest({ version: sourceVersion, key: 'invalid' })).toThrow(/does not match locked identity/);
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

  it('uses an explicit cmd invocation on Windows so build environment variables reach pnpm scripts', () => {
    expect(buildPnpmInvocation(['run', 'build'], 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd run build'],
    });
    expect(buildPnpmInvocation(['run', 'build'], 'linux')).toEqual({
      file: 'pnpm',
      args: ['run', 'build'],
    });
  });
});
