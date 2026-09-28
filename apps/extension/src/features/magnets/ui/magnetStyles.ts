/**
 * @file magnetStyles.ts
 * @description Magnet list style injection helper
 * @module features/magnets
 */
export function injectMagnetSourceTagStyles(): void {
  // 检查是否已经添加过样式
  if (document.getElementById('magnet-search-tag-styles')) return;

  const style = document.createElement('style');
  style.id = 'magnet-search-tag-styles';
  style.textContent = `
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.6; }
      100% { opacity: 1; }
    }

    .magnet-search-tag {
      transition: all 0.3s ease;
    }

    .magnet-search-tag.is-warning {
      animation: pulse 1.5s infinite;
    }

    /* 避免顶部 meta 区域的 source 标签把页面横向撑宽 */
    .top-meta.jdb-magnet-meta-bar {
      --jdb-magnet-meta-bg: #ffffff;
      --jdb-magnet-meta-border: rgba(15, 23, 42, 0.10);
      --jdb-magnet-meta-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
      --jdb-magnet-meta-muted: #64748b;
      --jdb-magnet-meta-success-bg: #dcfce7;
      --jdb-magnet-meta-success-text: #166534;
      --jdb-magnet-meta-danger-bg: #fee2e2;
      --jdb-magnet-meta-danger-text: #991b1b;
      --jdb-magnet-meta-warning-bg: #fef3c7;
      --jdb-magnet-meta-warning-text: #92400e;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      min-height: 0 !important;
      margin-bottom: 6px !important;
      padding: 7px 9px !important;
      border: 1px solid var(--jdb-magnet-meta-border);
      border-radius: 10px;
      background: var(--jdb-magnet-meta-bg);
      box-shadow: var(--jdb-magnet-meta-shadow);
    }

    html[data-theme="dark"] .top-meta.jdb-magnet-meta-bar {
      --jdb-magnet-meta-bg: #1f2937;
      --jdb-magnet-meta-border: rgba(148, 163, 184, 0.22);
      --jdb-magnet-meta-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
      --jdb-magnet-meta-muted: #9ca3af;
      --jdb-magnet-meta-success-bg: rgba(34, 197, 94, 0.18);
      --jdb-magnet-meta-success-text: #bbf7d0;
      --jdb-magnet-meta-danger-bg: rgba(239, 68, 68, 0.18);
      --jdb-magnet-meta-danger-text: #fecaca;
      --jdb-magnet-meta-warning-bg: rgba(245, 158, 11, 0.18);
      --jdb-magnet-meta-warning-text: #fde68a;
    }

    .top-meta.jdb-magnet-meta-bar .tags,
    .top-meta.jdb-magnet-meta-bar .jdb-magnet-source-tags {
      display: flex;
      flex-wrap: wrap !important;
      align-items: center;
      gap: 6px;
      max-width: 100% !important;
      overflow: hidden !important;
      margin: 0 !important;
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag {
      height: 24px;
      margin: 0 !important;
      padding: 0 9px;
      border-radius: 999px;
      border: 0;
      color: var(--jdb-magnet-meta-muted);
      background: rgba(148, 163, 184, 0.14);
      font-size: 11px;
      font-weight: 800;
      line-height: 24px;
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-success {
      color: var(--jdb-magnet-meta-success-text);
      background: var(--jdb-magnet-meta-success-bg);
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-danger {
      color: var(--jdb-magnet-meta-danger-text);
      background: var(--jdb-magnet-meta-danger-bg);
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-warning,
    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-loading {
      color: var(--jdb-magnet-meta-warning-text);
      background: var(--jdb-magnet-meta-warning-bg);
    }

    .top-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      min-height: 0 !important;
      margin-bottom: 6px !important;
      padding-bottom: 0 !important;
    }

    .top-meta .tags {
      display: flex;
      flex-wrap: wrap !important;
      max-width: 100% !important;
      overflow: hidden !important;
      margin-bottom: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * 注入统一的磁力列表样式，解决宽度溢出及换行不当问题
 */

export function injectUnifiedMagnetListStyles(): void {
  if (document.getElementById('unified-magnet-list-styles')) return;

  const style = document.createElement('style');
  style.id = 'unified-magnet-list-styles';
  style.textContent = `
    #magnets-content,
    .jdb-magnet-manual-search {
      --jdb-magnet-panel-bg: #f7fafc;
      --jdb-magnet-card-bg: #ffffff;
      --jdb-magnet-card-border: rgba(15, 23, 42, 0.10);
      --jdb-magnet-card-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
      --jdb-magnet-text: #1f2937;
      --jdb-magnet-muted: #64748b;
      --jdb-magnet-title: #0f73a8;
      --jdb-magnet-accent: #0ea5e9;
      --jdb-magnet-surface: #eef2f7;
      --jdb-magnet-button-bg: #e1f5fe;
      --jdb-magnet-button-hover: #c8ecfb;
      --jdb-magnet-button-text: #0277bd;
      --jdb-magnet-success-bg: #dcfce7;
      --jdb-magnet-success-text: #166534;
      --jdb-magnet-disabled-bg: #e5e7eb;
      --jdb-magnet-disabled-text: #94a3b8;
    }

    html[data-theme="dark"] #magnets-content,
    html[data-theme="dark"] .jdb-magnet-manual-search {
      --jdb-magnet-panel-bg: #111827;
      --jdb-magnet-card-bg: #1f2937;
      --jdb-magnet-card-border: rgba(148, 163, 184, 0.22);
      --jdb-magnet-card-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
      --jdb-magnet-text: #e5e7eb;
      --jdb-magnet-muted: #9ca3af;
      --jdb-magnet-title: #7dd3fc;
      --jdb-magnet-accent: #38bdf8;
      --jdb-magnet-surface: rgba(148, 163, 184, 0.12);
      --jdb-magnet-button-bg: rgba(14, 165, 233, 0.18);
      --jdb-magnet-button-hover: rgba(14, 165, 233, 0.28);
      --jdb-magnet-button-text: #bae6fd;
      --jdb-magnet-success-bg: rgba(34, 197, 94, 0.18);
      --jdb-magnet-success-text: #bbf7d0;
      --jdb-magnet-disabled-bg: rgba(148, 163, 184, 0.12);
      --jdb-magnet-disabled-text: #64748b;
    }

    /* 容器级别约束，避免出现横向滚动和超宽 */
    #magnets-content {
      max-width: 100% !important;
      max-height: 720px !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      box-sizing: border-box !important;
      padding: 12px !important;
      border-radius: 12px;
      background: var(--jdb-magnet-panel-bg);
      scroll-behavior: smooth;
    }

    .jdb-magnet-manual-search {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 10px;
      margin: 10px 0;
      padding: 10px 12px;
      border: 1px solid var(--jdb-magnet-card-border);
      border-radius: 10px;
      color: var(--jdb-magnet-text);
      background: var(--jdb-magnet-card-bg);
      box-shadow: var(--jdb-magnet-card-shadow);
    }

    .jdb-magnet-manual-search .jdb-magnet-manual-button {
      height: 28px;
      border-color: transparent;
      border-radius: 8px;
      color: var(--jdb-magnet-button-text);
      background: var(--jdb-magnet-button-bg);
      font-weight: 700;
    }

    .jdb-magnet-manual-search .jdb-magnet-manual-hint {
      color: var(--jdb-magnet-muted) !important;
      font-size: 12px;
      line-height: 1.4;
    }

    .top-meta.jdb-magnet-meta-bar {
      --jdb-magnet-meta-bg: #ffffff;
      --jdb-magnet-meta-border: rgba(15, 23, 42, 0.10);
      --jdb-magnet-meta-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
      --jdb-magnet-meta-muted: #64748b;
      --jdb-magnet-meta-success-bg: #dcfce7;
      --jdb-magnet-meta-success-text: #166534;
      --jdb-magnet-meta-danger-bg: #fee2e2;
      --jdb-magnet-meta-danger-text: #991b1b;
      --jdb-magnet-meta-warning-bg: #fef3c7;
      --jdb-magnet-meta-warning-text: #92400e;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      min-height: 0 !important;
      margin-bottom: 6px !important;
      padding: 7px 9px !important;
      border: 1px solid var(--jdb-magnet-meta-border);
      border-radius: 10px;
      background: var(--jdb-magnet-meta-bg);
      box-shadow: var(--jdb-magnet-meta-shadow);
    }

    html[data-theme="dark"] .top-meta.jdb-magnet-meta-bar {
      --jdb-magnet-meta-bg: #1f2937;
      --jdb-magnet-meta-border: rgba(148, 163, 184, 0.22);
      --jdb-magnet-meta-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
      --jdb-magnet-meta-muted: #9ca3af;
      --jdb-magnet-meta-success-bg: rgba(34, 197, 94, 0.18);
      --jdb-magnet-meta-success-text: #bbf7d0;
      --jdb-magnet-meta-danger-bg: rgba(239, 68, 68, 0.18);
      --jdb-magnet-meta-danger-text: #fecaca;
      --jdb-magnet-meta-warning-bg: rgba(245, 158, 11, 0.18);
      --jdb-magnet-meta-warning-text: #fde68a;
    }

    .top-meta.jdb-magnet-meta-bar .tags,
    .top-meta.jdb-magnet-meta-bar .jdb-magnet-source-tags {
      display: flex;
      flex-wrap: wrap !important;
      align-items: center;
      gap: 6px;
      max-width: 100% !important;
      overflow: hidden !important;
      margin: 0 !important;
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag {
      height: 24px;
      margin: 0 !important;
      padding: 0 9px;
      border-radius: 999px;
      border: 0;
      color: var(--jdb-magnet-meta-muted);
      background: rgba(148, 163, 184, 0.14);
      font-size: 11px;
      font-weight: 800;
      line-height: 24px;
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-success {
      color: var(--jdb-magnet-meta-success-text);
      background: var(--jdb-magnet-meta-success-bg);
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-danger {
      color: var(--jdb-magnet-meta-danger-text);
      background: var(--jdb-magnet-meta-danger-bg);
    }

    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-warning,
    .top-meta.jdb-magnet-meta-bar .magnet-search-tag.is-loading {
      color: var(--jdb-magnet-meta-warning-text);
      background: var(--jdb-magnet-meta-warning-bg);
    }

    .top-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      min-height: 0 !important;
      margin-bottom: 6px !important;
      padding-bottom: 0 !important;
    }

    .top-meta > .tags {
      margin-bottom: 0 !important;
    }

    /* 恢复 Bulma 在该区域的负边距行为，避免列 padding 叠加导致超宽 */
    #magnets-content .columns {
      margin-left: -0.75rem !important;
      margin-right: -0.75rem !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }

    /* 统一磁力列表的 flex 布局与溢出处理 */
    #magnets-content .item {
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      overflow: hidden !important; /* 防止内部偶发性溢出 */
      padding-left: 8px !important;   /* 兼容原生磁力节点 */
      padding-right: 8px !important;
    }

    #magnets-content .item, #magnets-content .item * {
      min-width: 0 !important;
    }

    #magnets-content .jdb-magnet-row {
      gap: 12px;
      margin-bottom: 8px;
      padding: 9px 12px !important;
      border: 1px solid var(--jdb-magnet-card-border);
      border-radius: 10px;
      color: var(--jdb-magnet-text);
      background: var(--jdb-magnet-card-bg);
      box-shadow: var(--jdb-magnet-card-shadow);
    }

    #magnets-content .jdb-magnet-row.odd {
      background: var(--jdb-magnet-card-bg);
    }

    #magnets-content .jdb-native-magnet-row,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row {
      gap: 10px;
      padding: 7px 10px !important;
    }

    #magnets-content .jdb-native-magnet-row br,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row br {
      display: none !important;
    }

    #magnets-content .jdb-native-magnet-row .jdb-magnet-title,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row .jdb-magnet-title {
      line-height: 1.22;
    }

    #magnets-content .jdb-native-magnet-row .jdb-magnet-meta,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row .jdb-magnet-meta {
      margin-top: 2px;
      line-height: 1.18;
    }

    #magnets-content .jdb-native-magnet-row .jdb-magnet-tags,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row .jdb-magnet-tags {
      gap: 4px;
      margin-top: 3px !important;
    }

    #magnets-content .jdb-native-magnet-row .jdb-magnet-tags .tag,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row .jdb-magnet-tags .tag {
      height: 18px;
      font-size: 10.5px;
      line-height: 18px;
    }

    #magnets-content .jdb-native-magnet-row .buttons .button,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row .buttons .button {
      height: 24px;
      line-height: 1;
    }

    #magnets-content .jdb-native-magnet-row .date .time,
    #magnets-content > .item.columns.is-desktop.jdb-native-magnet-row .date .time {
      min-height: 20px;
      padding: 1px 6px;
    }

    #magnets-content > .item.columns.is-desktop,
    #magnets-content > .item[data-rank] {
      display: flex !important;
      align-items: center;
      gap: 12px;
      margin: 0 0 8px !important;
      padding: 9px 12px !important;
      border: 1px solid var(--jdb-magnet-card-border);
      border-radius: 10px;
      color: var(--jdb-magnet-text);
      background: var(--jdb-magnet-card-bg);
      box-shadow: var(--jdb-magnet-card-shadow);
    }

    #magnets-content > .item.columns.is-desktop.odd,
    #magnets-content > .item[data-rank].odd {
      background: var(--jdb-magnet-card-bg);
    }

    #magnets-content > .item.columns.is-desktop.jdb-magnet-page-hidden,
    #magnets-content > .item[data-rank].jdb-magnet-page-hidden {
      display: none !important;
    }

    #magnets-content > .item.columns.is-desktop .column,
    #magnets-content > .item[data-rank] .column {
      padding: 0 !important;
    }

    #magnets-content > .item.columns.is-desktop .magnet-name,
    #magnets-content > .item[data-rank] .magnet-name {
      flex: 1 1 auto !important;
    }

    /* 名称链接与文本本身的宽度约束与省略号 */
    #magnets-content .item .magnet-name a {
      display: block !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }

    #magnets-content .jdb-magnet-link {
      color: inherit;
      text-decoration: none;
    }

    #magnets-content .item .magnet-name .name {
      display: block !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 100% !important;
    }

    #magnets-content .jdb-magnet-title {
      color: var(--jdb-magnet-title);
      font-size: 13px;
      font-weight: 750;
      line-height: 1.3;
    }

    #magnets-content > .item.columns.is-desktop .magnet-name .name {
      color: var(--jdb-magnet-title);
      font-size: 13px;
      font-weight: 750;
      line-height: 1.3;
    }

    #magnets-content .jdb-magnet-link:hover .jdb-magnet-title {
      text-decoration: underline;
    }

    #magnets-content .jdb-magnet-meta {
      display: block;
      margin-top: 3px;
      color: var(--jdb-magnet-muted);
      font-size: 12px;
      line-height: 1.25;
    }

    #magnets-content > .item.columns.is-desktop .meta {
      display: block;
      margin-top: 3px;
      color: var(--jdb-magnet-muted);
      font-size: 12px;
      line-height: 1.25;
    }

    #magnets-content .jdb-magnet-tags {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      margin: 5px 0 0 !important;
    }

    #magnets-content .jdb-magnet-tags .tag {
      height: 20px;
      margin: 0 !important;
      border-radius: 999px;
      font-size: 11px;
      line-height: 20px;
    }

    #magnets-content > .item.columns.is-desktop .tags {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      margin: 5px 0 0 !important;
    }

    #magnets-content > .item.columns.is-desktop .tags .tag {
      height: 20px;
      margin: 0 !important;
      border-radius: 999px;
      font-size: 11px;
      line-height: 20px;
    }

    #magnets-content .jdb-magnet-quality-tag { border: 1px solid var(--jdb-magnet-quality-border); color: var(--jdb-magnet-quality-text); background: var(--jdb-magnet-quality-bg); font-weight: 800; }

    #magnets-content .item .buttons {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto !important;
      white-space: nowrap !important;
      max-width: 100% !important;
    }

    #magnets-content .jdb-magnet-row .buttons {
      margin-bottom: 0;
    }

    #magnets-content .jdb-magnet-row .buttons .button {
      height: 26px;
      margin: 0;
      border-radius: 8px;
      font-weight: 700;
    }

    #magnets-content > .item.columns.is-desktop .buttons {
      margin: 0 !important;
      flex: 0 0 auto !important;
    }

    #magnets-content > .item.columns.is-desktop .buttons .button {
      height: 26px;
      margin: 0 !important;
      border-radius: 8px;
      font-weight: 700;
    }

    #magnets-content > .item.columns.is-desktop .buttons .button.is-info {
      border-color: transparent;
      color: var(--jdb-magnet-button-text);
      background: var(--jdb-magnet-button-bg);
    }

    #magnets-content > .item.columns.is-desktop .buttons .button.is-info:hover {
      background: var(--jdb-magnet-button-hover);
    }

    #magnets-content > .item.columns.is-desktop .buttons .button.is-success {
      border-color: transparent;
      color: var(--jdb-magnet-success-text);
      background: var(--jdb-magnet-success-bg);
    }

    #magnets-content .jdb-magnet-row .buttons .button.is-info {
      border-color: transparent;
      color: var(--jdb-magnet-button-text);
      background: var(--jdb-magnet-button-bg);
    }

    #magnets-content .jdb-magnet-row .buttons .button.is-info:hover {
      background: var(--jdb-magnet-button-hover);
    }

    #magnets-content .jdb-magnet-row .buttons .button.is-success {
      border-color: transparent;
      color: var(--jdb-magnet-success-text);
      background: var(--jdb-magnet-success-bg);
    }

    #magnets-content .item .date {
      flex: 0 0 80px !important;
      text-align: center !important;
    }

    #magnets-content .jdb-magnet-row .date {
      flex-basis: 96px !important;
    }

    #magnets-content .jdb-magnet-row .date .time {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 22px;
      padding: 2px 7px;
      border-radius: 999px;
      color: var(--jdb-magnet-muted);
      background: var(--jdb-magnet-surface);
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      white-space: nowrap;
    }

    #magnets-content > .item.columns.is-desktop .date {
      flex: 0 0 96px !important;
    }

    #magnets-content > .item.columns.is-desktop .date .time {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 22px;
      padding: 2px 7px;
      border-radius: 999px;
      color: var(--jdb-magnet-muted);
      background: var(--jdb-magnet-surface);
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      white-space: nowrap;
    }

    #magnets-content .jdb-magnet-pagination {
      position: sticky;
      bottom: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 10px 8px;
      background: color-mix(in srgb, var(--jdb-magnet-panel-bg) 94%, transparent);
      border-top: 1px solid var(--jdb-magnet-card-border);
      box-sizing: border-box;
    }

    #magnets-content .jdb-magnet-page-info {
      min-width: 110px;
      text-align: center;
      font-size: 12px;
      color: var(--jdb-magnet-muted);
      font-weight: 700;
      white-space: nowrap;
    }

    #magnets-content .jdb-magnet-pagination .button {
      flex: 0 0 auto;
      border-radius: 8px;
      color: var(--jdb-magnet-button-text);
      background: var(--jdb-magnet-button-bg);
    }

    #magnets-content .jdb-magnet-source-filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 0 0 10px;
      padding: 0 0 10px;
      border-bottom: 1px solid var(--jdb-magnet-card-border);
    }

    #magnets-content .jdb-magnet-source-filter {
      height: 24px;
      padding: 0 9px;
      border: 1px solid transparent;
      border-radius: 999px;
      color: var(--jdb-magnet-muted);
      background: var(--jdb-magnet-surface);
      font-size: 11px;
      font-weight: 800;
      line-height: 22px;
      cursor: pointer;
    }

    #magnets-content .jdb-magnet-source-filter:hover,
    #magnets-content .jdb-magnet-source-filter.is-active {
      color: var(--jdb-magnet-button-text);
      background: var(--jdb-magnet-button-bg);
    }

    @media (prefers-color-scheme: dark) {
      html:not([data-theme="light"]) #magnets-content,
      html:not([data-theme="light"]) .jdb-magnet-manual-search {
        --jdb-magnet-panel-bg: #111827;
        --jdb-magnet-card-bg: #1f2937;
        --jdb-magnet-card-border: rgba(148, 163, 184, 0.22);
        --jdb-magnet-card-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
        --jdb-magnet-text: #e5e7eb;
        --jdb-magnet-muted: #9ca3af;
        --jdb-magnet-title: #7dd3fc;
        --jdb-magnet-accent: #38bdf8;
        --jdb-magnet-surface: rgba(148, 163, 184, 0.12);
        --jdb-magnet-button-bg: rgba(14, 165, 233, 0.18);
        --jdb-magnet-button-hover: rgba(14, 165, 233, 0.28);
        --jdb-magnet-button-text: #bae6fd;
        --jdb-magnet-success-bg: rgba(34, 197, 94, 0.18);
        --jdb-magnet-success-text: #bbf7d0;
        --jdb-magnet-disabled-bg: rgba(148, 163, 184, 0.12);
        --jdb-magnet-disabled-text: #64748b;
      }
      #magnets-content .jdb-magnet-pagination {
        background: color-mix(in srgb, var(--jdb-magnet-panel-bg) 94%, transparent);
        border-top-color: var(--jdb-magnet-card-border);
      }
      #magnets-content .jdb-magnet-page-info {
        color: var(--jdb-magnet-muted);
      }
    }
    /* 小屏优化：当空间不足时允许在按钮前换行，避免横向溢出 */
    @media (max-width: 768px) {
      #magnets-content .item.is-desktop {
        flex-wrap: wrap;
        align-items: flex-start;
      }
      #magnets-content .item .date {
        order: 3;
      }
      #magnets-content .jdb-magnet-row {
        gap: 10px;
      }
      #magnets-content .jdb-magnet-row .buttons {
        order: 4;
        flex: 1 1 100% !important;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      #magnets-content .jdb-magnet-row .date {
        flex: 0 0 auto !important;
        text-align: left !important;
      }
      #magnets-content > .item.columns.is-desktop {
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 10px;
      }
      #magnets-content > .item.columns.is-desktop .buttons {
        order: 4;
        flex: 1 1 100% !important;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      #magnets-content > .item.columns.is-desktop .date {
        flex: 0 0 auto !important;
        text-align: left !important;
      }
    }

    /* 页面级溢出约束（仅限影片详情区块）*/
    article.message.video-panel,
    article.message.video-panel .message-body {
      max-width: 100% !important;
      box-sizing: border-box !important;
      overflow-x: hidden !important;
    }

    /* 统一限制影片详情主要内容宽度，保持与站点容器一致的上限（约 1344px） */
    article.message.video-panel .message-body,
    article.message.video-panel .moj-content,
    article.message.video-panel .magnet-links,
    article.message.video-panel #magnets-content {
      width: 100% !important;
      max-width: 1344px !important;
      margin-left: auto !important;
      margin-right: auto !important;
      box-sizing: border-box !important;
    }

    /* 约束顶部切页 tabs，避免白屏撑宽 body */
    article.message.video-panel .tabs,
    article.message.video-panel .tabs ul {
      max-width: 100% !important;
      box-sizing: border-box !important;
      overflow-x: auto !important; /* 局部滚动，而非撑宽整个页面 */
      white-space: normal !important; /* 允许换行 */
      flex-wrap: wrap !important;
    }

    /* 针对站点上的 .tabs.no-bottom（你的诊断里出现了 nowrap）做兜底，限定在详情区 */
    article.message.video-panel .tabs.no-bottom,
    article.message.video-panel .tabs.no-bottom ul {
      max-width: 100% !important;
      box-sizing: border-box !important;
      overflow-x: auto !important;
      white-space: normal !important;
      display: flex !important;
      flex-wrap: wrap !important;
    }

    /* Bulma columns 在详情区的列允许收缩 */
    article.message.video-panel .columns > .column {
      min-width: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * 更新总数显示
 */
