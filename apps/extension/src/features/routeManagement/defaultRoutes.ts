/**
 * @file defaultRoutes.ts
 * @description DOM-free default route settings shared by config and background route manager
 * @module features/routeManagement
 */
import type { ExtensionSettings } from '../../types';

export type RouteSettings = NonNullable<ExtensionSettings['routes']>;

export function createDefaultRouteSettings(now = Date.now()): RouteSettings {
  return {
    javdb: {
      primary: 'https://javdb.com',
      alternatives: [
        {
          url: 'https://javdb570.com',
          enabled: true,
          description: '备用线路1',
          addedAt: now,
        },
        {
          url: 'https://javdb36.com',
          enabled: true,
          description: '备用线路2',
          addedAt: now,
        },
      ],
    },
    javbus: {
      primary: 'https://www.javbus.com',
      alternatives: [
        {
          url: 'https://www.seejav.cyou',
          enabled: true,
          description: '防屏蔽地址1',
          addedAt: now,
        },
        {
          url: 'https://www.busjav.cyou',
          enabled: true,
          description: '防屏蔽地址2',
          addedAt: now,
        },
        {
          url: 'https://www.fanbus.cyou',
          enabled: true,
          description: '防屏蔽地址3',
          addedAt: now,
        },
      ],
    },
  };
}
