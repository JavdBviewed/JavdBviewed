/**
 * @file openExtensionBrowser.ts
 * @description 启动带 JavdBviewed 拓展的持久化 Chromium，供人工/AI 联合探索测试
 * @module scripts
 */
import { extensionPageUrl, launchExtensionContext, readExtensionId, resolveExtensionHarnessOptions } from './extensionHarness';

interface CliOptions {
  url?: string;
  channel?: string;
  slowMo?: number;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
    } else if (arg === '--dashboard') {
      options.url = 'dashboard';
    } else if (arg === '--popup') {
      options.url = 'popup';
    } else if (arg.startsWith('--channel=')) {
      options.channel = arg.slice('--channel='.length);
    } else if (arg.startsWith('--slow-mo=')) {
      const parsed = Number(arg.slice('--slow-mo='.length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.slowMo = parsed;
      }
    }
  }

  return options;
}

function resolveStartupUrl(aliasOrUrl: string | undefined, extensionId: string): string {
  if (!aliasOrUrl || aliasOrUrl === 'popup') {
    return extensionPageUrl(extensionId, 'popup/popup.html');
  }
  if (aliasOrUrl === 'dashboard') {
    return extensionPageUrl(extensionId, 'dashboard/dashboard.html');
  }
  return aliasOrUrl;
}

async function waitUntilUserCloses(): Promise<void> {
  if (!process.stdin.isTTY) {
    await new Promise(() => undefined);
    return;
  }

  console.log('浏览器已启动。按 Enter 关闭本次测试浏览器。');
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}

async function main(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const env = { ...process.env };
  if (cliOptions.url) {
    env.JAVDB_EXTENSION_URL = cliOptions.url;
  }

  const harnessOptions = resolveExtensionHarnessOptions(env, process.cwd());
  const context = await launchExtensionContext(harnessOptions, {
    channel: cliOptions.channel ?? process.env.JAVDB_EXTENSION_CHANNEL ?? 'chromium',
    headless: false,
    slowMo: cliOptions.slowMo,
  });

  try {
    const extensionId = await readExtensionId(context);
    const startupUrl = resolveStartupUrl(harnessOptions.startupUrl, extensionId);
    const page = await context.newPage();
    await page.goto(startupUrl, { waitUntil: 'domcontentloaded' });

    console.log(`拓展 ID：${extensionId}`);
    console.log(`构建目录：${harnessOptions.extensionDir}`);
    console.log(`测试 profile：${harnessOptions.userDataDir}`);
    console.log(`当前页面：${startupUrl}`);

    await waitUntilUserCloses();
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
