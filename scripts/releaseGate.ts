/**
 * @file releaseGate.ts
 * @description 扩展发布门禁
 * @module scripts
 */
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertManifestKeyGate, loadFixedExtensionIdentity } from './extensionIdentity';
import { formatArtifactVersion } from './versioning';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_EXTENSION_ID = 'gnegjfjccmeafanpmbjboegcbchcghka';
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

export interface ReleaseVersionArtifacts {
  version: string;
  build: number;
  packageVersion: string;
  extensionPackageVersion: string;
  manifestVersion: string;
}

export interface ReleaseZipEntry {
  name: string;
  data: Buffer;
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function assertReleaseVersionArtifacts(root: string = ROOT): ReleaseVersionArtifacts {
  const versionJson = readJsonFile<{ version: string; build: number }>(path.join(root, 'version.json'));
  const packageJson = readJsonFile<{ version: string }>(path.join(root, 'package.json'));
  const extensionPackageJson = readJsonFile<{ version: string }>(path.join(root, 'apps/extension/package.json'));
  const manifest = readJsonFile<{ version: string; key?: string }>(path.join(root, 'apps/extension/src/manifest.json'));

  const expectedVersion = versionJson.version.trim();
  const values = [versionJson.version, packageJson.version, extensionPackageJson.version, manifest.version];
  if (!expectedVersion || values.some((value) => value !== expectedVersion)) {
    throw new Error(`发布版本必须与 version.json 一致（${expectedVersion || '未设置'}），实际为：${values.join(', ')}`);
  }
  if (!Number.isInteger(versionJson.build) || versionJson.build < 0) {
    throw new Error('version.json 的 build 必须是非负整数');
  }

  return {
    version: versionJson.version,
    build: versionJson.build,
    packageVersion: packageJson.version,
    extensionPackageVersion: extensionPackageJson.version,
    manifestVersion: manifest.version,
  };
}

export function assertReleaseManifest(manifest: { version?: string; key?: string }, root: string = ROOT): void {
  const expectedVersion = readJsonFile<{ version: string }>(path.join(root, 'version.json')).version.trim();
  if (manifest.version !== expectedVersion) {
    throw new Error(`构建 manifest 版本必须为 ${expectedVersion}`);
  }
  const identity = loadFixedExtensionIdentity(path.join(root, 'scripts/extension-identity.json'));
  assertManifestKeyGate(manifest, { version: manifest.version, identity });
  if (identity.fixedExtensionId !== EXPECTED_EXTENSION_ID) {
    throw new Error(`锁定扩展 ID 已变化：${identity.fixedExtensionId}`);
  }
}

export function assertSourceManifest(manifest: { version?: string; key?: string }, expectedVersion: string): void {
  if (manifest.version !== expectedVersion) {
    throw new Error(`源码 manifest 版本必须为 ${expectedVersion}`);
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'key')) {
    throw new Error('源码 manifest 不应提交固定 key，固定 key 只能由 2.0.0 构建流程注入');
  }
}

export function getForbiddenReleaseEntryReason(entryName: string): string | undefined {
  const normalized = entryName.replaceAll('\\', '/');
  if (/(^|\/)(?:key\.pem|\.env(?:\..*)?|credentials?\.(?:json|pem|key|p12|pfx)|secrets?\.(?:json|pem|key|p12|pfx)|(?:private|server)(?:-key)?\.(?:pem|key|p12|pfx))$/i.test(normalized)) return '凭据或环境文件';
  if (/(?:\.sqlite3?|\.db)$/i.test(normalized)) return '本地数据库文件';
  if (/(^|\/)(?:test-results|tests|fixtures|__tests__)(\/|$)/i.test(normalized)) return '测试文件';
  if (/\.map$/i.test(normalized)) return '调试 sourcemap';
  return undefined;
}

function normalizeReleaseEntryName(entryName: string): string {
  return entryName.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function assertReleaseFileSet(zipEntries: string[], distEntries: string[]): void {
  const zipNames = zipEntries.map(normalizeReleaseEntryName).filter(Boolean);
  const distNames = distEntries.map(normalizeReleaseEntryName).filter(Boolean);
  const zipSet = new Set(zipNames);
  const distSet = new Set(distNames);
  if (zipSet.size !== zipNames.length) throw new Error('ZIP 包含重复文件条目');
  const missing = [...distSet].filter((name) => !zipSet.has(name));
  const extra = [...zipSet].filter((name) => !distSet.has(name));
  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `缺少：${missing.join('、')}` : '',
      extra.length > 0 ? `多出：${extra.join('、')}` : '',
    ].filter(Boolean).join('；');
    throw new Error(`ZIP 文件集合与 dist 不一致：${details}`);
  }
}

export function assertSafeReleaseEntries(entries: string[]): void {
  const forbidden = entries
    .map((entry) => ({ entry, reason: getForbiddenReleaseEntryReason(entry) }))
    .filter((item): item is { entry: string; reason: string } => Boolean(item.reason));
  if (forbidden.length > 0) {
    throw new Error(`发布产物包含禁止文件：${forbidden.map((item) => `${item.entry}（${item.reason}）`).join('、')}`);
  }
}

function listReleaseFiles(root: string, current: string = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll('\\', '/');
    files.push(relativePath);
    if (entry.isDirectory()) files.push(...listReleaseFiles(root, fullPath));
  }
  return files;
}

function findEndOfCentralDirectory(data: Buffer): number {
  const minimumOffset = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error('ZIP 缺少 End of Central Directory 记录');
}

export function readReleaseZipEntries(zipPath: string): ReleaseZipEntry[] {
  const zip = fs.readFileSync(zipPath);
  const eocdOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  const centralSize = zip.readUInt32LE(eocdOffset + 12);
  const centralOffset = zip.readUInt32LE(eocdOffset + 16);
  const entries: ReleaseZipEntry[] = [];
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error(`ZIP 中央目录损坏：第 ${index + 1} 项`);
    }
    const compression = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const fileNameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localHeaderOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + fileNameLength);

    if (localHeaderOffset + 30 > zip.length || zip.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error(`ZIP 本地文件头损坏：${name}`);
    }
    const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    const data = compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : Buffer.alloc(0);
    if (compression !== 0 && compression !== 8) {
      throw new Error(`ZIP 使用不支持的压缩方式：${name}`);
    }
    entries.push({ name, data });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  if (cursor !== centralOffset + centralSize) {
    throw new Error('ZIP 中央目录长度校验失败');
  }
  return entries;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function assertReleaseZip(zipPath: string, distManifestPath: string): void {
  const entries = readReleaseZipEntries(zipPath);
  assertSafeReleaseEntries(entries.map((entry) => entry.name));
  assertReleaseFileSet(entries.map((entry) => entry.name), listReleaseFiles(path.dirname(distManifestPath)));
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifestEntry) throw new Error('ZIP 缺少 manifest.json');

  const distManifest = readJsonFile<Record<string, unknown>>(distManifestPath);
  const zipManifest = JSON.parse(manifestEntry.data.toString('utf8')) as Record<string, unknown>;
  if (stableJson(distManifest) !== stableJson(zipManifest)) {
    throw new Error('ZIP 内 manifest.json 与 dist/manifest.json 不一致');
  }
}

export function buildPnpmInvocation(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string | undefined = process.env.ComSpec,
): { file: string; args: string[] } {
  if (platform === 'win32') {
    const command = ['pnpm.cmd', ...args].join(' ');
    return {
      file: comSpec?.trim() || 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    };
  }
  return { file: 'pnpm', args };
}

function runPnpm(args: string[]): void {
  const invocation = buildPnpmInvocation(args);
  execFileSync(invocation.file, invocation.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, JAVDB_BUILD_SKIP_VERSION_BUMP: '1' },
  });
}

export function runReleaseGate(root: string = ROOT): void {
  const version = assertReleaseVersionArtifacts(root);
  const sourceManifest = readJsonFile<{ version: string; key?: string }>(path.join(root, 'apps/extension/src/manifest.json'));
  assertSourceManifest(sourceManifest, version.version);

  runPnpm(['run', 'typecheck']);
  runPnpm(['run', 'test']);
  runPnpm(['run', 'test:dom']);
  runPnpm(['run', 'test:style-contract']);
  runPnpm(['run', 'build']);

  const distManifestPath = path.join(root, 'dist/manifest.json');
  const distManifest = readJsonFile<{ version: string; key?: string }>(distManifestPath);
  assertReleaseManifest(distManifest, root);
  const artifactVersion = formatArtifactVersion({ version: version.version, build: version.build });
  const zipPath = path.join(root, 'dist-zip', `javdb-extension-v${artifactVersion}.zip`);
  if (!fs.existsSync(zipPath)) throw new Error(`未找到预期发布 ZIP：${zipPath}`);
  assertReleaseZip(zipPath, distManifestPath);
  assertSafeReleaseEntries(fs.readdirSync(path.join(root, 'dist'), { recursive: true }).map(String));
  console.log(`\n[release:gate] ${version.version} 扩展发布门禁通过：${zipPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    runReleaseGate();
  } catch (error) {
    console.error('\n[release:gate] 发布门禁失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
