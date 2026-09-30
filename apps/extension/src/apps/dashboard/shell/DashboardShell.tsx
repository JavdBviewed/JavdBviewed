/**
 * @file DashboardShell.tsx
 * @description Dashboard 外壳：顶栏、主导航容器、二级导航宿主与各 tab 内容容器
 * @module apps/dashboard/shell
 *
 * 导航按钮仍由 initTabs() 写入稳定 DOM id，业务页 partial/init 链路保持不变。
 */
import { DASHBOARD_TAB_CONTENT_IDS } from '../../../dashboard/tabs/tabContentIds';
import { openProjectStarPage, TOPBAR_STAR_BTN_ID } from '../../../dashboard/topbar/starButton';

/**
 * React 托管的 Dashboard 布局壳（少双轨：默认替代 skeleton HTML partial）
 */
export function DashboardShell() {
  return (
    <div className="dashboard-container">
      <div className="topbar">
        <div className="topbar-left" title="Jav 助手">
          <img id="brand-icon" alt="Jav 助手" className="brand-icon" style={{ display: 'none' }} />
          <span className="brand-text">Jav 助手</span>
          <span id="version-badge" className="version-badge" style={{ display: 'none' }}>
            <span id="version-badge-text">Loading...</span>
          </span>
          <button
            id="manual-lock-btn"
            className="manual-lock-btn"
            style={{ display: 'none' }}
            type="button"
            title="手动锁定"
          >
            <i className="fas fa-lock" />
          </button>
        </div>

        <nav className="topbar-center" aria-label="主导航">
          <div className="tabs dashboard-main-tabs" id="dashboard-main-tabs" />
        </nav>

        <div className="topbar-right">
          <div id="privacy-timer" className="privacy-timer" style={{ display: 'none' }}>
            <i className="fas fa-lock" />
            <span id="privacy-timer-text">--:--</span>
          </div>
          {/* 星星胶囊按钮：主题切换器（运行时 insertBefore 到 user-menu-root 前）左侧 */}
          <button
            id={TOPBAR_STAR_BTN_ID}
            className="topbar-star-btn"
            type="button"
            title="给项目一个 star"
            aria-label="给项目一个 star"
            onClick={openProjectStarPage}
          >
            <i className="fas fa-star" aria-hidden="true" />
          </button>
          <div id="dashboard-user-menu-root" className="dashboard-user-menu-root" />
        </div>
      </div>

      <div className="dashboard-body">
        <div className="main-content">
          <div
            className="dashboard-section-nav"
            id="dashboard-section-nav"
            data-area="navigation"
            hidden
          />

          {DASHBOARD_TAB_CONTENT_IDS.map((tabId, index) => (
            <div
              key={tabId}
              id={tabId}
              className={index === 0 ? 'tab-content active' : 'tab-content'}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
