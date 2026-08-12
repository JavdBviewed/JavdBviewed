/**
 * @file performanceSourceFixture.ts
 * @description 为内容脚本性能对照生成脱敏的 JavDB 列表页面。
 * @module scripts
 */

export type PerformanceSourceFixtureInspectionInput = {
  marker: boolean;
  itemCount: number;
  expectedItemCount: number;
  extensionInjected: boolean;
};

export type PerformanceSourceFixtureInspection = {
  fixtureLoaded: boolean;
  itemCount: number;
  extensionInjected: boolean;
};

export type PerformanceSourceFixtureServer = {
  url: string;
  close: () => Promise<void>;
};

function normalizeItemCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

/** 生成不访问外部资源、但保留 JavDB 列表结构的页面。 */
export function buildPerformanceSourceFixtureHtml(
  initialItemCount = 240,
  options: { dynamicItemCount?: number } = {},
): string {
  const count = normalizeItemCount(initialItemCount);
  const dynamicItemCount = Math.max(0, Math.trunc(options.dynamicItemCount ?? 120));
  const dynamicLastItem = count + dynamicItemCount;
  const items = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const code = `PERF-${String(number).padStart(4, '0')}`;
    return `<div class="item" data-performance-source-item="1"><a class="box" href="/v/${code.toLowerCase()}"><div class="cover"><img alt="${code}" loading="lazy" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="></div><div class="video-title"><strong>${code}</strong> Fixture title ${number}</div><div class="tags has-addons"><span class="tag">fixture</span></div></a></div>`;
  }).join('');

  const dynamicScript = dynamicItemCount > 0 ? `
  <script>
    (() => {
      const list = document.querySelector('.movie-list');
      let next = ${count + 1};
      const appendMutation = () => {
        if (!list || next > ${dynamicLastItem}) return;
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 12 && next <= ${dynamicLastItem}; index += 1, next += 1) {
          const code = 'PERF-' + String(next).padStart(4, '0');
          const item = document.createElement('div');
          item.className = 'item';
          item.dataset.performanceSourceItem = '1';
          item.innerHTML = '<a class="box" href="/v/' + code.toLowerCase() + '"><div class="video-title"><strong>' + code + '</strong> Fixture dynamic</div><div class="tags"></div></a>';
          fragment.appendChild(item);
        }
        list.appendChild(fragment);
        if (next <= ${dynamicLastItem}) window.setTimeout(appendMutation, 1000);
      };
      window.setTimeout(appendMutation, 1000);
    })();
  </script>` : '';

  return `<!doctype html>
<html lang="zh-CN" data-javdb-performance-source-fixture="1">
<head><meta charset="utf-8"><title>JavDB performance fixture</title></head>
<body data-javdb-performance-source-fixture="1">
  <nav class="navbar"><a href="/">JavDB</a><div id="navbar-menu-user"><div class="navbar-end"></div></div></nav>
  <main class="movie-list">${items}</main>
  ${dynamicScript}
</body>
</html>`;
}

export function inspectPerformanceSourceFixture(
  input: PerformanceSourceFixtureInspectionInput,
): PerformanceSourceFixtureInspection {
  const itemCount = Number.isFinite(input.itemCount) ? Math.max(0, Math.trunc(input.itemCount)) : 0;
  const expectedItemCount = normalizeItemCount(input.expectedItemCount);
  return {
    fixtureLoaded: input.marker && itemCount >= expectedItemCount,
    itemCount,
    extensionInjected: input.extensionInjected,
  };
}

/**
 * 启动只服务测试页面的本机 HTTP server。
 * 通过 HTTP 而不是 file:// 运行，确保 Chromium 的 content_scripts match 规则真实生效。
 */
export async function startPerformanceSourceFixtureServer(
  port = 0,
  initialItemCount = 240,
  options: { dynamicItemCount?: number } = {},
): Promise<PerformanceSourceFixtureServer> {
  const { createServer } = await import('node:http');
  const html = buildPerformanceSourceFixtureHtml(initialItemCount, options);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/performance-source-fixture.html' || pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('性能 fixture server 未返回监听端口。');
  }
  return {
    // 127.0.0.1 在 Windows -> WSL 的 localhost 转发中比 IPv6 localhost 更稳定。
    url: `http://127.0.0.1:${address.port}/performance-source-fixture.html`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
