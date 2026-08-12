/**
 * @file recordsPerformanceStyles.test.ts
 * @description 记录页装饰层必须限制在首屏附近，避免覆盖整个长列表。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/records.css');

describe('records page performance styles', () => {
  it('keeps decorative radial backgrounds in a bounded pseudo-element', () => {
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.records-page\s*\{[^}]*background:\s*var\(--surface-primary\);/s);
    expect(css).toMatch(/\.records-page::before\s*\{[^}]*height:\s*240px;/s);
    expect(css).toMatch(/\.records-page::before\s*\{[^}]*radial-gradient/s);
    expect(css).not.toMatch(/\.records-page\s*\{[^}]*background:\s*\n\s*radial-gradient/s);
  });

  it('contains record row layout without containing paint', () => {
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.video-item\s*\{[^}]*contain:\s*layout;?/s);
    expect(css).not.toMatch(/\.video-item\s*\{[^}]*contain:\s*layout\s+paint/s);
  });
});
