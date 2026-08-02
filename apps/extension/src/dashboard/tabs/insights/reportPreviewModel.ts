export interface PrepareInsightsPreviewHtmlOptions {
  baseUrl?: string;
  themeName?: string;
}

function resolveThemeName(options?: PrepareInsightsPreviewHtmlOptions): string {
  if (options?.themeName) return options.themeName;
  try {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function resolveBaseUrl(options?: PrepareInsightsPreviewHtmlOptions): string {
  if (options?.baseUrl) return options.baseUrl;
  try {
    return chrome.runtime.getURL('') || './';
  } catch {
    return './';
  }
}

function isLocalPreviewResource(url: string): boolean {
  const normalized = url.trim();
  if (!normalized) return false;
  return !/^(?:[a-z][a-z\d+\-.]*:|\/\/)/i.test(normalized);
}

function removeRemotePreviewResources(html: string): string {
  let result = html;

  // srcdoc 与扩展页共享扩展 CSP，外部脚本不能在这里执行。
  result = result.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (tag, attrs: string) => {
    const source = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    return source && isLocalPreviewResource(source) ? tag : '';
  });

  // 外部样式表同样会触发扩展页 style-src 拦截；保留扩展内的相对资源。
  result = result.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["'][^"']*stylesheet[^"']*["']/i.test(tag)) return tag;
    const source = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    return source && isLocalPreviewResource(source) ? tag : '';
  });

  return result;
}

export function prepareInsightsPreviewHtml(
  html: string,
  options?: PrepareInsightsPreviewHtmlOptions,
): string {
  try {
    let result = html || '';
    const themeName = resolveThemeName(options);
    const baseUrl = resolveBaseUrl(options);

    try {
      result = removeRemotePreviewResources(result);
    } catch {}

    if (/<base[^>]*>/i.test(result)) {
      result = result.replace(/<base[^>]*>/i, `<base href="${baseUrl}">`);
    } else if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (match) => `${match}\n  <base href="${baseUrl}">`);
    } else {
      result = result.replace(/<html[^>]*>/i, (match) => `${match}\n<head><base href="${baseUrl}"></head>`);
    }

    try {
      result = result.replace(/<body([^>]*)>/i, (_match, attrs) => {
        let nextAttrs = attrs || '';
        if (/\bid\s*=/.test(nextAttrs)) {
          nextAttrs = nextAttrs.replace(/\bid=(["']).*?\1/i, 'id="__ins_preview_root__"');
        } else {
          nextAttrs += ' id="__ins_preview_root__"';
        }

        if (/\bdata-theme\s*=/.test(nextAttrs)) {
          nextAttrs = nextAttrs.replace(/\bdata-theme=(["']).*?\1/i, `data-theme="${themeName}"`);
        } else {
          nextAttrs += ` data-theme="${themeName}"`;
        }
        return `<body${nextAttrs}>`;
      });
    } catch {}

    try {
      const hasFallback = /insights-preview-fallback/i.test(result);
      const fallback = `\n<style id="insights-preview-fallback">\n  :root { color-scheme: ${themeName}; }\n  #__ins_preview_root__ { min-height: 100vh; }\n</style>`;
      if (!hasFallback) {
        if (/<\/body>/i.test(result)) {
          result = result.replace(/<\/body>/i, (match) => `${fallback}\n${match}`);
        } else if (/<\/head>/i.test(result)) {
          result = result.replace(/<\/head>/i, (match) => `${fallback}\n${match}`);
        } else if (/<head[^>]*>/i.test(result)) {
          result = result.replace(/<head[^>]*>/i, (match) => `${match}\n  ${fallback}`);
        } else {
          result = result.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${fallback}</head>`);
        }
      }
    } catch {}

    try {
      const needsDataRuntime = /id=["']insights-data["']/i.test(result);
      const hasEcharts = /echarts(\.min)?\.js/i.test(result);
      const hasRuntime = /insights-runtime\.js/i.test(result);
      if (needsDataRuntime && (!hasEcharts || !hasRuntime)) {
        const scripts = [
          !hasEcharts ? '<script src="assets/templates/echarts.min.js"></script>' : '',
          !hasRuntime ? '<script src="assets/templates/insights-runtime.js"></script>' : '',
        ].filter(Boolean).join('\n  ');

        if (/<\/body>/i.test(result)) {
          result = result.replace(/<\/body>/i, (match) => `  ${scripts}\n${match}`);
        } else {
          result += `\n  ${scripts}\n`;
        }
      }
    } catch {}

    return result;
  } catch {
    return html;
  }
}
