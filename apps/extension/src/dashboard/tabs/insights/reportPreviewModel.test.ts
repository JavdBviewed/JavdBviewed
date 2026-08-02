import { describe, expect, it } from 'vitest';
import { prepareInsightsPreviewHtml } from './reportPreviewModel';

describe('insights report preview model', () => {
  it('removes inline scripts, sets base url, and marks preview body theme', () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>报告</title></head>
        <body class="report">
          <script>window.bad = true;</script>
          <main>内容</main>
        </body>
      </html>
    `;

    const result = prepareInsightsPreviewHtml(html, {
      baseUrl: 'chrome-extension://id/',
      themeName: 'dark',
    });

    expect(result).not.toContain('window.bad');
    expect(result).toContain('<base href="chrome-extension://id/">');
    expect(result).toContain('<body class="report" id="__ins_preview_root__" data-theme="dark">');
    expect(result).toContain('id="insights-preview-fallback"');
    expect(result).toContain(':root { color-scheme: dark; }');
  });

  it('replaces existing base, body id, and theme attributes', () => {
    const html = `
      <html>
        <head><base href="/old/"></head>
        <body id="old" data-theme="light">内容</body>
      </html>
    `;

    const result = prepareInsightsPreviewHtml(html, {
      baseUrl: 'chrome-extension://new/',
      themeName: 'dark',
    });

    expect(result).toContain('<base href="chrome-extension://new/">');
    expect(result).toContain('<body id="__ins_preview_root__" data-theme="dark">');
    expect(result).not.toContain('/old/');
  });

  it('adds runtime scripts when report data exists and assets are missing', () => {
    const html = `
      <html>
        <head></head>
        <body><div id="insights-data">{}</div></body>
      </html>
    `;

    const result = prepareInsightsPreviewHtml(html, {
      baseUrl: './',
      themeName: 'light',
    });

    expect(result).toContain('<script src="assets/templates/echarts.min.js"></script>');
    expect(result).toContain('<script src="assets/templates/insights-runtime.js"></script>');
  });

  it('removes remote scripts and stylesheets before loading preview HTML in the extension iframe', () => {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="https://javdb.com/packs/css/app-900db544.css">
          <link rel="stylesheet" href="assets/templates/report.css">
        </head>
        <body>
          <script src="https://javdb.com/packs/js/app-0ed1a0b82950def4a68b.js"></script>
          <script src="assets/templates/insights-runtime.js"></script>
        </body>
      </html>
    `;

    const result = prepareInsightsPreviewHtml(html, {
      baseUrl: 'chrome-extension://id/',
      themeName: 'light',
    });

    expect(result).not.toContain('https://javdb.com/packs/css/app-900db544.css');
    expect(result).not.toContain('https://javdb.com/packs/js/app-0ed1a0b82950def4a68b.js');
    expect(result).toContain('assets/templates/report.css');
    expect(result).toContain('assets/templates/insights-runtime.js');
  });
});
