import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import manifest from './src/manifest.json';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { formatManifestVersion } from '../../scripts/versioning';
import { applyFixedExtensionIdentity } from '../../scripts/extensionIdentity';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// 动态同步 manifest.version 从 version.json（仅在构建时）
// 2.0.0+ 注入固定 manifest.key；1.x 强制无 key
function getUpdatedManifest() {
  const manifestCopy: Record<string, unknown> = { ...manifest };

  try {
    const versionJsonPath = path.resolve(repoRoot, 'version.json');
    if (fs.existsSync(versionJsonPath)) {
      const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
      if (versionData.version) {
        const manifestVersion = formatManifestVersion(versionData);
        manifestCopy.version = manifestVersion;
        console.log(`📦 Manifest version synced to: ${manifestVersion}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('⚠️  Could not sync manifest version from version.json:', message);
  }

  const withIdentity = applyFixedExtensionIdentity(manifestCopy as { version?: string; key?: string }, {
    identityPath: path.resolve(repoRoot, 'scripts/extension-identity.json'),
    keyPemPath: path.resolve(repoRoot, 'key.pem'),
  });

  if (withIdentity.key) {
    console.log('🔐 Fixed extension ID enabled via manifest.key (major >= 2)');
  }

  return withIdentity;
}

export default defineConfig({
  // vite root = extension src (crx entries live under apps/extension/src)
  root: path.resolve(__dirname, 'src'),
  envDir: repoRoot,
  // 重要：使用相对资源路径，避免内容脚本动态分包以 /assets/ 前缀从网站域拉取
  base: '',
  plugins: [
    react(),
    crx({ manifest: getUpdatedManifest() }),
  ],
  resolve: {
    alias: {
      '@javdb/sync-protocol': path.resolve(repoRoot, 'packages/sync-protocol/src/index.ts'),
      '@javdb/sync-client': path.resolve(repoRoot, 'packages/sync-client/src/index.ts'),
    },
  },
  build: {
    // Keep dist at monorepo root for existing scripts / load-unpacked habits
    outDir: path.resolve(repoRoot, 'dist'),
    emptyOutDir: true,
    // MV3 扩展页面可能将 Vite 的 modulepreload 判定为跨 world 资源不匹配；动态导入仍会按需加载分包。
    modulePreload: false,
  },
});
