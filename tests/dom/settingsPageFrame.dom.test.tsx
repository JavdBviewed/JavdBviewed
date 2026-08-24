/**
 * @file settingsPageFrame.dom.test.tsx
 * @description SettingsPageFrame 对 React <SettingSection> 正文自动生成快速导航
 * @module tests/dom
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingSection } from '../../apps/extension/src/ui/patterns/SettingSection/SettingSection';
import { SettingsPageFrame } from '../../apps/extension/src/apps/dashboard/pages/settings/shared/settingsPageFrame';

let host: HTMLDivElement;
let root: Root;

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

function mountFrame(sections: ReactNode[]): void {
  host = document.createElement('div');
  host.id = 'settings-frame-host';
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(
        SettingsPageFrame,
        {
          title: '显示设置',
          description: '页面描述',
          pageId: 'display-settings',
        },
        ...sections,
      ),
    );
  });
}

const section = (title: string) => createElement(SettingSection, { title });

describe('SettingsPageFrame auto section quick-nav', () => {
  it('generates a visible section nav with at least 3 items from React SettingSection groups', () => {
    mountFrame([section('基本设置'), section('番号过滤'), section('演员列表'), section('高级选项')]);

    const nav = host.querySelector('.settings-section-nav');
    expect(nav).not.toBeNull();
    const labels = Array.from(
      host.querySelectorAll('.settings-section-nav__item-label'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(['基本设置', '番号过滤', '演员列表', '高级选项']);

    // 每个分组元素被赋予了稳定锚点 id，作为滚动目标。
    const sectionEls = Array.from(host.querySelectorAll('[data-ui-pattern="setting-section"]'));
    expect(sectionEls.map((el) => el.id)).toEqual([
      'display-settings-section-0',
      'display-settings-section-1',
      'display-settings-section-2',
      'display-settings-section-3',
    ]);
  });

  it('does not generate a nav when there are fewer than 3 sections', () => {
    mountFrame([section('基本设置'), section('高级选项')]);

    expect(host.querySelector('.settings-section-nav')).toBeNull();
    // 无导航时正文仍正常渲染。
    expect(host.querySelectorAll('[data-ui-pattern="setting-section"]').length).toBe(2);
  });

  it('keeps explicit sectionNavItems in preference to auto collection', () => {
    host = document.createElement('div');
    host.id = 'settings-frame-host';
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        createElement(
          SettingsPageFrame,
          {
            title: 'Emby',
            pageId: 'emby-settings',
            sectionNavItems: [{ id: 'emby-a', label: '显式导航' }],
          },
          section('分组一'),
          section('分组二'),
          section('分组三'),
        ),
      );
    });

    const labels = Array.from(host.querySelectorAll('.settings-section-nav__item-label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['显式导航']);
  });
});
