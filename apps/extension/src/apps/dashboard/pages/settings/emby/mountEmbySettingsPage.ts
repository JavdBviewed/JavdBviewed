/**
 * @file mountEmbySettingsPage.ts
 * @description 挂载 Emby/Jellyfin 设置 React 全页
 * @module apps/dashboard/pages/settings/emby
 */
import { EmbySettingsPage } from './EmbySettingsPage';
import { mountReactSettingsPage, unmountReactSettingsPage } from '../shared/mountReactSettingsPage';

export async function mountEmbySettingsPage(hostSelector = '#tab-settings'): Promise<void> {
  await mountReactSettingsPage({
    hostSelector,
    kind: 'subpage',
    element: EmbySettingsPage,
    markerAttr: 'data-media-library-settings-react',
    mountDataset: { mediaLibrarySettingsReact: '1' },
  });
}

export function unmountEmbySettingsPage(hostSelector = '#tab-settings'): void {
  unmountReactSettingsPage(hostSelector);
}
