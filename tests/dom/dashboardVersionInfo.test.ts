/**
 * @file dashboardVersionInfo.test.ts
 * @description Dashboard 侧栏版本信息测试
 * @module tests/dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderDashboardVersionInfo } from '../../apps/extension/src/apps/dashboard/dashboardVersionInfo';
import { STATE } from '../../apps/extension/src/dashboard/state';

describe('dashboard version info about panel', () => {
  const originalSettings = STATE.settings;

  beforeEach(() => {
    document.body.innerHTML = '<div id="aboutVersionInfo"></div>';
    STATE.settings = {
      ...STATE.settings,
      webdav: {
        ...STATE.settings.webdav,
        clientId: 'test-device-id',
      },
    };
  });

  afterEach(() => {
    STATE.settings = originalSettings;
    document.body.innerHTML = '';
  });

  it('renders a centered author line below Device ID with the author name as a compact link', () => {
    renderDashboardVersionInfo();

    const container = document.getElementById('aboutVersionInfo');
    const author = container?.querySelector<HTMLElement>('.info-author');
    const authorLabel = author?.querySelector<HTMLElement>('.info-author-label');
    const authorLink = author?.querySelector<HTMLAnchorElement>('.info-author-link');
    const authorAvatar = author?.querySelector<HTMLImageElement>('.info-author-avatar');
    const children = Array.from(container?.children ?? []);
    const deviceIndex = children.findIndex((child) => child.textContent?.includes('Device ID:'));
    const authorIndex = children.findIndex((child) => child.classList.contains('info-author'));

    expect(deviceIndex).toBeGreaterThanOrEqual(0);
    expect(authorIndex).toBe(deviceIndex + 1);
    expect(author?.children[0]).toBe(authorLabel);
    expect(author?.children[1]).toBe(authorLink);
    expect(authorAvatar).toBeNull();
    expect(authorLabel?.textContent?.trim()).toBe('Author:');
    expect(authorLink?.getAttribute('href')).toBe('https://github.com/JavdBviewed');
    expect(authorLink?.getAttribute('target')).toBe('_blank');
    expect(authorLink?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(authorLink?.textContent?.trim()).toBe('JavdBviewed');
    expect(author?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Author: JavdBviewed');
    expect(authorLink?.classList.contains('info-author-link')).toBe(true);
    expect(authorLink?.textContent).not.toContain('https://github.com/JavdBviewed');
  });
});
