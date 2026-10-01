/**
 * @file mountNewWorksSettingsPage.ts
 * @description 挂载新作品设置 React 全页
 * @module apps/dashboard/pages/settings/newWorks
 */
import { NewWorksSettingsPage } from './NewWorksSettingsPage';
import { mountReactSettingsPage, unmountReactSettingsPage } from '../shared/mountReactSettingsPage';

export async function mountNewWorksSettingsPage(hostSelector = '#tab-settings'): Promise<void> {
  await mountReactSettingsPage({
    hostSelector,
    kind: 'subpage',
    element: NewWorksSettingsPage,
    markerAttr: 'data-new-works-settings-react',
    mountDataset: { newWorksSettingsReact: '1' },
  });
}

export function unmountNewWorksSettingsPage(hostSelector = '#tab-settings'): void {
  unmountReactSettingsPage(hostSelector);
}
