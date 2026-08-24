/**
 * @file settingsReactFidelity.layout.test.ts
 * @description React 设置共享壳视觉基线契约
 * @module apps/dashboard/pages/settings/shared
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const frameSource = readFileSync(join(here, 'settingsPageFrame.tsx'), 'utf8');
const styleSource = readFileSync(join(here, 'settingsReactFidelity.css'), 'utf8');

describe('React settings shared fidelity', () => {
  it('loads the shared legacy visual baseline from the page frame', () => {
    expect(frameSource).toContain("import './settingsReactFidelity.css';");
    expect(styleSource).toContain("[data-settings-stack='react-full']");
    expect(styleSource).toContain('font-size: 28px');
    expect(styleSource).toContain('border-bottom: 2px solid');
    expect(styleSource).toContain('padding: 20px var(--settings-react-card-padding) 8px');
  });

  it('keeps page-specific legacy title icon mappings in the shared shell', () => {
    // Legacy CSS only defines a title marker for these pages; the remaining
    // React pages reuse the shared shell marker set for a consistent cue.
    for (const marker of [
      '#display-settings',
      '#search-engine-settings',
      '#ai-settings',
      '#privacy-settings',
      '#webdav-settings',
      '#sync-settings',
      '#advanced-settings',
      '#network-test-settings',
      '#update-settings',
      '#emby-settings',
      '#enhancement-settings',
    ]) {
      expect(styleSource).toContain(`:has(${marker}) [data-ui-pattern='page-header'] h2::before`);
    }
  });

  it('restores legacy page colour washes and emoji title markers', () => {
    for (const [marker, emoji] of [
      ['#display-settings', '🎨'],
      ['#search-engine-settings', '🔍'],
      ['#ai-settings', '🤖'],
      ['#privacy-settings', '🔒'],
      ['#webdav-settings', '📁'],
      ['#sync-settings', '🔄'],
      ['#insights-settings', '📊'],
      ['#log-settings', '📘'],
      ['#advanced-settings', '⚙️'],
      ['#network-test-settings', '🌐'],
      ['#global-actions', '⚡'],
      ['#update-settings', '🔄'],
      ['#cloud-settings', '☁'],
      ['#emby-settings', '📺'],
      ['#enhancement-settings', '🚀'],
    ] as const) {
      expect(styleSource).toContain(`content: '${emoji}'`);
    }
    expect(styleSource).toContain('linear-gradient(135deg, rgba(139, 92, 246, 0.05)');
    expect(styleSource).toContain('isolation: isolate');
  });
});
