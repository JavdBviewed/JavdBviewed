/**
 * @file embyLibraryStatusBadges.test.ts
 * @description Emby library status badges 测试
 * @module tests/dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STATE } from '../../apps/extension/src/features/contentState';
import { renderDetailLibraryStatus } from '../../apps/extension/src/features/embyLibrary/content/statusBadges';

describe('Emby library status badges', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav class="panel movie-panel-info">
        <div class="panel-block first-block">ABC-301</div>
      </nav>
    `;
    STATE.settings = {
      emby: {
        mediaServers: [
          {
            id: 'emby-main',
            type: 'emby',
            name: 'Main Emby',
            url: 'http://emby.local:8096',
            apiKey: 'secret',
            enabled: true,
          },
          {
            id: 'jf-main',
            type: 'jellyfin',
            name: 'Main Jellyfin',
            url: 'http://jellyfin.local:8096',
            apiKey: 'secret',
            enabled: true,
          },
        ],
        libraryStatus: {
          enabled: true,
          showOnDetail: true,
        },
      },
    } as any;
    STATE.embyLibraryState = {
      entries: {
        'ABC-301': [
          {
            serverType: 'emby',
            serverName: 'Main Emby',
            serverUrl: 'http://emby.local:8096',
            itemId: 'emby-301',
            serverId: 'emby-server',
            itemName: 'ABC-301',
            updatedAt: 100,
          },
          {
            serverType: 'jellyfin',
            serverName: 'Main Jellyfin',
            serverUrl: 'http://jellyfin.local:8096',
            itemId: 'jf-301',
            serverId: 'jf-server',
            itemName: 'ABC-301',
            updatedAt: 100,
          },
        ],
      },
      updatedAt: 100,
    };
  });

  it('renders detail page library badges with media server links', () => {
    renderDetailLibraryStatus('ABC-301');

    const badges = Array.from(document.querySelectorAll<HTMLAnchorElement>('.emby-library-status-tag'));
    expect(badges.map((badge) => badge.textContent)).toEqual(['Emby已入库', 'Jellyfin已入库']);
    expect(badges[0].href).toBe('http://emby.local:8096/web/index.html#!/item?id=emby-301&serverId=emby-server');
    expect(badges[1].href).toBe('http://jellyfin.local:8096/web/index.html#!/details?id=jf-301&serverId=jf-server');
  });

  it('removes existing detail badges when detail display is disabled', () => {
    renderDetailLibraryStatus('ABC-301');
    (STATE.settings as any).emby.libraryStatus.showOnDetail = false;

    renderDetailLibraryStatus('ABC-301');

    expect(document.querySelector('.emby-library-status-tag')).toBeNull();
  });

  it('shows a sync hint on detail pages when the local library index is empty', () => {
    STATE.embyLibraryState = { entries: {}, updatedAt: 0 };

    renderDetailLibraryStatus('ABC-301');

    const hint = document.querySelector('.emby-library-sync-hint');
    expect(hint?.textContent).toBe('资料库未同步');
    // 负锁（10-15 更名）：hint 旧串不得残留
    expect(hint?.textContent).not.toContain('媒体库');
  });

  it('renders only entries from currently configured media servers', () => {
    (STATE.settings as any).emby.mediaServers = [
      {
        id: 'emby-main',
        type: 'emby',
        name: 'Main Emby',
        url: 'http://emby.local:8096/',
        apiKey: 'secret',
        enabled: true,
      },
    ];

    renderDetailLibraryStatus('ABC-301');

    const badges = Array.from(document.querySelectorAll<HTMLAnchorElement>('.emby-library-status-tag'));
    expect(badges.map((badge) => badge.textContent)).toEqual(['Emby已入库']);
  });
});
