/**
 * @file build.ts
 * @description 构建脚本 —— Vite 构建 + 版本号刷新 + 资源复制 + ZIP 打包
 * @module scripts
 */
import { build } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import archiver from 'archiver';
import { execSync } from 'child_process';
import { formatArtifactVersion } from './versioning';
import { assertManifestKeyGate, loadFixedExtensionIdentity } from './extensionIdentity';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const distZipDir = resolve(root, 'dist-zip');
const identityPath = resolve(root, 'scripts/extension-identity.json');

/** 从 version.json 或 package.json 读取当前版本号 */
async function getVersion() {
    // First try version.json (updated by version script)
    const versionJsonPath = resolve(root, 'version.json');
    if (fs.existsSync(versionJsonPath)) {
        const versionJson = await fs.readJson(versionJsonPath);
        return formatArtifactVersion({
            version: versionJson.version,
            build: versionJson.build,
        });
    }
    // Fallback to package.json
    const packageJsonPath = resolve(root, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        const packageJson = await fs.readJson(packageJsonPath);
        return packageJson.version;
    }
    throw new Error('Could not find version information.');
}

/**
 * 构建主流程：刷新版本号 → Vite 打包 → 复制 Font Awesome / G2Plot → 生成 ZIP
 */
async function main() {
    try {
        console.log('Starting build process...');

        // 发布门禁需要可重复构建，显式跳过版本文件递增，避免验证本身污染工作区。
        if (process.env.JAVDB_BUILD_SKIP_VERSION_BUMP === '1') {
            console.log('[build] Skipping version/build bump for release gate.');
        } else {
            try {
                execSync('node --import tsx scripts/version.ts', {
                    cwd: root,
                    stdio: 'inherit',
                });
            } catch (e) {
                console.warn('[build] Failed to refresh build id via scripts/version.ts. Proceeding with existing env/version files.');
            }
        }

        // Run Vite build against apps/extension (dist still lands at monorepo root)
        await build({
            configFile: resolve(root, 'apps/extension/vite.config.ts'),
        });
        console.log('Vite build finished successfully.');

        // MV3 扩展页面的 isolated world 不适合使用 modulepreload，避免产生跨 world 预加载警告。
        const extensionHtmlFiles = [
            resolve(distDir, 'dashboard/dashboard.html'),
            resolve(distDir, 'popup/popup.html'),
        ];
        for (const htmlPath of extensionHtmlFiles) {
            if (!fs.existsSync(htmlPath)) continue;
            const html = await fs.readFile(htmlPath, 'utf8');
            if (/<link[^>]+rel=["']modulepreload["']/i.test(html)) {
                throw new Error(`[build] MV3 extension page still contains modulepreload: ${htmlPath}`);
            }
        }
        console.log('[build] MV3 modulepreload compatibility gate passed.');

        // Gate: 1.x must not ship manifest.key; 2.0.0+ must ship the locked fixed ID key
        const distManifestPath = resolve(distDir, 'manifest.json');
        if (await fs.pathExists(distManifestPath)) {
            const distManifest = await fs.readJson(distManifestPath);
            const identity = loadFixedExtensionIdentity(identityPath);
            assertManifestKeyGate(distManifest, { identity });
            if (distManifest.key) {
                console.log(`[build] Fixed extension ID gate passed: ${identity.fixedExtensionId}`);
            } else {
                console.log('[build] 1.x manifest key absence gate passed (no manifest.key)');
            }
        } else {
            console.warn('[build] dist/manifest.json missing; skipped extension identity gate');
        }

        // Keep runtime-loaded Font Awesome assets at stable extension URLs.
        const fontawesomeSrcDir = resolve(root, 'apps/extension/src/assets/fontawesome');
        const fontawesomeDistDir = resolve(distDir, 'assets/fontawesome');
        if (fs.existsSync(fontawesomeSrcDir)) {
            await fs.copy(fontawesomeSrcDir, fontawesomeDistDir);
            console.log(`[build] Copied Font Awesome assets from: ${fontawesomeSrcDir}`);
        }

        // Ensure external runtime assets are present in dist
        const distTemplatesDir = resolve(distDir, 'assets/templates');
        await fs.ensureDir(distTemplatesDir);
        const g2plotDistPath = resolve(distTemplatesDir, 'g2plot.min.js');
        const g2plotCandidates = [
            resolve(root, 'apps/extension/src/assets/templates/g2plot.min.js'),
            resolve(root, 'public/assets/templates/g2plot.min.js'),
            resolve(root, 'node_modules/@antv/g2plot/dist/g2plot.min.js'),
        ];
        let copied = false;
        for (const p of g2plotCandidates) {
            if (fs.existsSync(p)) {
                await fs.copy(p, g2plotDistPath);
                console.log(`[build] Copied g2plot.min.js from: ${p}`);
                copied = true;
                break;
            }
        }
        if (!copied) {
            console.warn('[build] g2plot.min.js not found in apps/extension/src/public/node_modules. G2Plot will fallback to ECharts at runtime.');
        }

        // Get version and define zip path
        const version = await getVersion();
        const zipName = `javdb-extension-v${version}.zip`;
        const zipPath = resolve(distZipDir, zipName);

        // Create a zip file of the dist directory contents
        console.log(`\nCreating zip file at ${zipPath}...`);

        await fs.ensureDir(distZipDir); // Ensure the zip output directory exists

        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 }, // Set the compression level
        });

        // Listen for all archive data to be written
        output.on('close', () => {
            console.log(`Zip file created successfully: ${archive.pointer()} total bytes`);
        });

        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Warning during archiving:', err);
            } else {
                throw err;
            }
        });

        archive.on('error', (err) => {
            throw err;
        });

        // Pipe archive data to the file
        archive.pipe(output);

        // Append files from the 'dist' directory, excluding any potential zips
        archive.glob('**/*', {
            cwd: distDir,
            ignore: ['*.zip'], // Exclude any zip files from being included
        });

        // Finalize the archive (this is when the zip is actually written)
        await archive.finalize();

        console.log('\nBuild and packaging process completed.');
    } catch (e) {
        console.error('\nAn error occurred during the build process:');
        console.error(e);
        process.exit(1);
    }
}

main();
