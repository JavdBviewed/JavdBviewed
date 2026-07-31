/**
 * @file SettingsHighlightNotice.tsx
 * @description 设置页通用高亮提示块
 * @module apps/dashboard/pages/settings/shared
 */
import type { ReactNode } from 'react';
import './settingsHighlightNotice.css';

type SettingsHighlightNoticeTone = 'warning' | 'info';

type SettingsHighlightNoticeProps = {
  title: string;
  children: ReactNode;
  badge?: string;
  tone?: SettingsHighlightNoticeTone;
  className?: string;
};

/**
 * 设置页顶部提示块，复用 Cloud 设置页的高亮视觉。
 */
export function SettingsHighlightNotice({
  title,
  children,
  badge = 'Beta',
  tone = 'warning',
  className = '',
}: SettingsHighlightNoticeProps) {
  const classes = ['settings-highlight-notice', `settings-highlight-notice--${tone}`];
  if (className) classes.push(className);

  return (
    <div className={classes.join(' ')} role="note">
      <div className="settings-highlight-notice-icon" aria-hidden="true">
        {badge}
      </div>
      <div className="settings-highlight-notice-body">
        <p className="settings-highlight-notice-title">{title}</p>
        <p className="settings-highlight-notice-text">{children}</p>
      </div>
    </div>
  );
}
