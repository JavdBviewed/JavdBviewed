/**
 * @file SettingsIndexPage.tsx
 * @description 设置中心入口页（React）：卡片网格导航到各设置子页
 * @module apps/dashboard/pages/settings
 *
 * 子设置面板仍由遗留 partial + settingsPanelManager 承载；本页只替换索引壳。
 */
import { Badge } from '../../../../ui/primitives/Badge/Badge';
import { PageHeader } from '../../../../ui/patterns/PageHeader/PageHeader';
import {
  SETTINGS_NAV_ITEMS,
  settingsNavHref,
  type SettingsNavItem,
} from './settingsNavModel';
import './settingsIndexPage.css';

/**
 * 设置中心首页
 */
export function SettingsIndexPage() {
  return (
    <div className="si-page" data-settings-stack="react">
      <PageHeader
        className="si-header settings-index-header"
        align="center"
        title="设置"
      />

      {/* 遗留全站设置搜索（jdb-settings-search）挂载点；initSettingsTab 会注入 */}
      <div
        className="si-search-host"
        id="settings-index-search-host"
        data-settings-search-host="1"
      />
      <div className="si-grid" role="navigation" aria-label="设置导航">
        {SETTINGS_NAV_ITEMS.map((item) => (
          <SettingsNavCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function SettingsNavCard({ item }: { item: SettingsNavItem }) {
  return (
    <a className="si-card" href={settingsNavHref(item.id)}>
      <span className="si-card-icon" aria-hidden="true">
        <i className={`fas ${item.icon}`} />
      </span>
      <span className="si-card-body">
        <span className="si-card-title">
          {item.title}
          {item.beta ? (
            <Badge tone="warning" className="si-beta">
              Beta
            </Badge>
          ) : null}
        </span>
        <span className="si-card-desc">{item.description}</span>
      </span>
    </a>
  );
}
