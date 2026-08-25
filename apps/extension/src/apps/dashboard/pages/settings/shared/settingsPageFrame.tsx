/**
 * @file settingsPageFrame.tsx
 * @description 设置子页共用外框：返回钮固定左上，标题/正文居中限宽
 * @module apps/dashboard/pages/settings/shared
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '../../../../../ui/patterns/PageHeader/PageHeader';
import { cn } from '../../../../../ui/lib/cn';
import { SettingsSectionNavLayout, type SettingsSectionNavItem } from './SettingsSectionNav';
import {
  collectLegacySettingsSections,
  MIN_LEGACY_SECTION_NAV_ITEMS,
} from './legacySettingsSectionNav';
import '../settingsSubpageShell.css';
import './settingsReactFidelity.css';

export type SettingsPageFrameProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** 根节点额外 data 属性（如 data-display-settings-react） */
  rootDataAttrs?: Record<string, string>;
  /** 页面内分组快捷导航；显式提供时优先使用 */
  sectionNavItems?: SettingsSectionNavItem[];
  /** 自动生成导航的锚点 id 前缀；未提供 sectionNavItems 时从正文收集分组 */
  pageId?: string;
  /** 根节点 id；供页面级 CSS 主题选择器（如 #drive115-settings）锚定 */
  rootId?: string;
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
  sectionNavItems,
  pageId,
  rootId,
}: SettingsPageFrameProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [autoNavItems, setAutoNavItems] = useState<SettingsSectionNavItem[]>([]);
  // 记录最近一次写入的锚点 id 集合，用于在 effect 中避免重复 setState 触发无限重渲染。
  const lastAutoNavIdsRef = useRef<string>('');

  // 仅当未显式提供 sectionNavItems 时，才在正文挂载后自动收集分组生成快速导航。
  // 复用遗留 partial 的分组收集规则（含“至少 3 个分组”门槛）；
  // 对显式声明导航的页面（emby/drive115/cloud/update）零影响。
  //
  // 注意：这里不能改写 container.innerHTML——正文是 React 渲染的，
  // 直接替换 DOM 会绕过 React 虚拟 DOM，后续 state 更新可能丢失或冲突。
  // 因此不给分组注入 anchor span，而是把稳定锚点 id 直接挂在 React 渲染的
  // 分组元素上；React 重渲染会清掉该 id，所以在每次 commit 后重新补挂，
  // 导航按钮按 id 现查当前 DOM 元素即可。
  const applyAutoNavAnchors = () => {
    const container = contentRef.current;
    if (!container || typeof document === 'undefined') return;

    const nextItems: SettingsSectionNavItem[] = [];
    if (!sectionNavItems) {
      const body = container.querySelector('.settings-page-body') ?? container;
      const sections = collectLegacySettingsSections(body);
      if (sections.length >= MIN_LEGACY_SECTION_NAV_ITEMS) {
        for (const [index, section] of sections.entries()) {
          const id = `${(pageId ?? 'settings').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'settings'}-section-${index}`;
          // 锚点 id 直接挂在 React 渲染的分组元素上；React 重渲染会清掉，
          // 因此每次 commit 后在这里补挂。
          section.element.setAttribute('id', id);
          nextItems.push({ id, label: section.label });
        }
      }
    }

    // 只有当锚点 id 集合真正变化时才 setState，避免在「每次 commit 后都跑」的
    // layout effect 里无条件 set 相同值，触发 React 无限重渲染（Maximum update
    // depth exceeded）。首次从空到有 / 从有到空 / 分组增减时才会真正更新。
    const signature = nextItems.map((item) => item.id).join('\u0000');
    if (signature === lastAutoNavIdsRef.current) return;
    lastAutoNavIdsRef.current = signature;
    setAutoNavItems(nextItems);
  };

  // 首次挂载（或显式导航开关变化）时收集一次；每次 commit 后补挂锚点 id
  //（React 重渲染会清掉），保证滚动目标持续可用。
  useLayoutEffect(applyAutoNavAnchors);

  const effectiveNavItems = sectionNavItems ?? autoNavItems;

  // 锚点 id 直接挂在分组元素上（React 重渲染会清掉，上面每个 commit 会补回），
  // 因此导航按钮按 id 在内容容器内现查元素，不依赖 document 全局查找，
  // 也避免锚点残留时被重复匹配。
  const handleAutoNavNavigate = (id: string) => {
    const container = contentRef.current;
    const element = container?.querySelector<HTMLElement>(`[id="${id}"]`) ?? null;
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      id={rootId}
      className={cn('ssp-page w-full min-w-0 pb-8', className)}
      data-settings-stack="react-full"
      {...rootDataAttrs}
    >
      <div className="ssp-back-bar">
        <button type="button" className="ssp-back" data-action="back-to-settings">
          <i className="fas fa-arrow-left" aria-hidden="true" /> 返回设置
        </button>
      </div>
      <div ref={contentRef} className="mx-auto w-full max-w-[1200px] px-1">
        <PageHeader className="mb-5" align="center" title={title} description={description} />
        {effectiveNavItems ? (
          <SettingsSectionNavLayout
            items={effectiveNavItems}
            getSectionElement={
              sectionNavItems ? undefined : (id) => contentRef.current?.querySelector<HTMLElement>(`[id="${id}"]`) ?? null
            }
            onNavigate={sectionNavItems ? undefined : handleAutoNavNavigate}
          >
            {children}
          </SettingsSectionNavLayout>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
