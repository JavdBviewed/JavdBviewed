/**
 * @file settingsPageFrame.tsx
 * @description 设置子页共用外框：返回钮固定左上，标题/正文居中限宽
 * @module apps/dashboard/pages/settings/shared
 */
import type { ReactNode } from 'react';
import { PageHeader } from '../../../../../ui/patterns/PageHeader/PageHeader';
import { cn } from '../../../../../ui/lib/cn';
import '../settingsSubpageShell.css';

export type SettingsPageFrameProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** 根节点额外 data 属性（如 data-display-settings-react） */
  rootDataAttrs?: Record<string, string>;
};

/**
 * 全页 React 设置页外框
 * - 返回钮始终贴内容宿主左上，不随 max-w 居中栏漂移
 * - 标题与正文在 max-w-[1200px] 内居中，作为 React 设置子页统一宽容器
 */
export function SettingsPageFrame({
  title,
  description,
  children,
  className,
  rootDataAttrs,
}: SettingsPageFrameProps) {
  return (
    <div
      className={cn('ssp-page w-full min-w-0 pb-8', className)}
      data-settings-stack="react-full"
      {...rootDataAttrs}
    >
      <div className="ssp-back-bar">
        <button type="button" className="ssp-back" data-action="back-to-settings">
          ← 返回设置
        </button>
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-1">
        <PageHeader className="mb-5" align="center" title={title} description={description} />
        {children}
      </div>
    </div>
  );
}
