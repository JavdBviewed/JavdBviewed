import { useEffect, useState, type ReactNode } from 'react';

type DriveSettingsTab = '115' | 'openlist';

function currentTab(): DriveSettingsTab {
  return /^#tab-settings\/(?:drive-settings|drive115-settings)\/openlist$/.test(window.location.hash)
    ? 'openlist'
    : '115';
}

export function DriveSettingsTabs({ drive115, openlist }: { drive115: ReactNode; openlist: ReactNode }) {
  const [tab, setTab] = useState<DriveSettingsTab>(currentTab);

  useEffect(() => {
    const onHashChange = () => setTab(currentTab());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return <>
    <nav className="drive-settings-tabs" aria-label="网盘设置">
      {(['115', 'openlist'] as const).map((id) => <a
        key={id}
        data-drive-tab-link={id}
        href={`#tab-settings/drive-settings/${id}`}
        aria-current={tab === id ? 'page' : undefined}
        className={tab === id ? 'active' : ''}
        onClick={() => setTab(id)}
      >{id === '115' ? '115' : 'OpenList'}</a>)}
    </nav>
    <div data-drive-tab="115" hidden={tab !== '115'}>{drive115}</div>
    <div data-drive-tab="openlist" hidden={tab !== 'openlist'}>{openlist}</div>
  </>;
}
