/**
 * @file SettingsSectionNav.tsx
 * @description Shared in-page section navigation for React settings subpages
 * @module apps/dashboard/pages/settings/shared
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './settingsSectionNav.css';

export type SettingsSectionNavItem = {
  id: string;
  label: string;
  shortLabel?: string;
  description?: string;
  hidden?: boolean;
  badge?: string;
};

type SettingsSectionNavProps = {
  items: SettingsSectionNavItem[];
  title?: string;
  activeId?: string | null;
  className?: string;
  getSectionElement?: (id: string) => HTMLElement | null;
  onNavigate?: (id: string) => void;
};

type SettingsSectionNavLayoutProps = {
  items: SettingsSectionNavItem[];
  children: ReactNode;
  title?: string;
  className?: string;
  asideClassName?: string;
  contentClassName?: string;
  navClassName?: string;
};

export function getVisibleSectionNavItems(
  items: SettingsSectionNavItem[],
): SettingsSectionNavItem[] {
  return items.filter((item) => !item.hidden);
}

export function resolveInitialActiveSectionId(
  items: SettingsSectionNavItem[],
): string | null {
  return getVisibleSectionNavItems(items)[0]?.id ?? null;
}

function joinClassNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

function defaultGetSectionElement(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

function scrollToSection(element: HTMLElement): void {
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getFloatingTopAnchor(navElement: HTMLDivElement): Element | null {
  const layoutElement = navElement.closest('.settings-section-nav-layout');
  const contentElement = layoutElement?.querySelector('.settings-section-nav-content');
  return contentElement?.querySelector(
    [
      ':scope > .settings-card',
      ':scope > .settings-section',
      ':scope > .settings-group',
      ':scope > [data-ui-pattern="setting-section"]',
      ':scope > * > .settings-card',
      ':scope > * > .settings-section',
      ':scope > * > .settings-group',
      ':scope > * > [data-ui-pattern="setting-section"]',
      ':scope .cloud-overview-grid',
      ':scope .cloud-scope-card',
      ':scope .settings-page-body .settings-card',
      ':scope .settings-page-body .settings-section',
      ':scope .settings-page-body .settings-group',
      ':scope .settings-page-body [data-ui-pattern="setting-section"]',
    ].join(', '),
  ) ?? navElement.parentElement;
}

function updateFloatingTopFromLayout(navElement: HTMLDivElement): void {
  const layoutAnchor = getFloatingTopAnchor(navElement);
  if (!layoutAnchor) return;

  const top = Math.round(layoutAnchor.getBoundingClientRect().top);
  if (top <= 0) return;

  navElement.style.setProperty('--settings-section-nav-floating-top', `${top}px`);
}

export function SettingsSectionNavLayout({
  items,
  children,
  title,
  className,
  asideClassName,
  contentClassName,
  navClassName,
}: SettingsSectionNavLayoutProps) {
  if (getVisibleSectionNavItems(items).length === 0) return <>{children}</>;

  return (
    <div className={joinClassNames('settings-section-nav-layout', className)}>
      <aside className={joinClassNames('settings-section-nav-aside', asideClassName)}>
        <SettingsSectionNav items={items} title={title} className={navClassName} />
      </aside>
      <div className={joinClassNames('settings-section-nav-content', contentClassName)}>
        {children}
      </div>
    </div>
  );
}

export function SettingsSectionNav({
  items,
  title = '本页导航',
  activeId,
  className,
  getSectionElement = defaultGetSectionElement,
  onNavigate,
}: SettingsSectionNavProps) {
  const navRef = useRef<HTMLDivElement | null>(null);
  const navigatingToRef = useRef<string | null>(null);
  const navigationReleaseTimerRef = useRef<number | null>(null);
  const visibleItems = useMemo(() => getVisibleSectionNavItems(items), [items]);
  const [observedActiveId, setObservedActiveId] = useState<string | null>(() =>
    resolveInitialActiveSectionId(items),
  );
  const currentActiveId =
    activeId === undefined ? observedActiveId ?? visibleItems[0]?.id ?? null : activeId;

  useEffect(() => {
    const navElement = navRef.current;
    if (!navElement || typeof window === 'undefined') return;

    let animationFrameId = 0;
    let timeoutId = 0;
    const update = () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        updateFloatingTopFromLayout(navElement);
      });
    };

    update();
    timeoutId = window.setTimeout(update, 120);
    window.addEventListener('resize', update);

    return () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener('resize', update);
    };
  }, [visibleItems.length]);

  useEffect(() => () => {
    if (navigationReleaseTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(navigationReleaseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const fallbackActiveId = visibleItems[0]?.id ?? null;
    if (!currentActiveId || !visibleItems.some((item) => item.id === currentActiveId)) {
      setObservedActiveId(fallbackActiveId);
    }
  }, [currentActiveId, visibleItems]);

  useEffect(() => {
    if (activeId !== undefined) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const elements = visibleItems
      .map((item) => ({ id: item.id, element: getSectionElement(item.id) }))
      .filter((entry): entry is { id: string; element: HTMLElement } => entry.element !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (navigatingToRef.current !== null) return;

        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const matched = elements.find((entry) => entry.element === visibleEntry?.target);
        if (matched) setObservedActiveId(matched.id);
      },
      {
        root: null,
        rootMargin: '-20% 0px -65% 0px',
        threshold: [0, 0.15, 0.4],
      },
    );

    elements.forEach(({ element }) => observer.observe(element));
    return () => observer.disconnect();
  }, [activeId, getSectionElement, visibleItems]);

  const handleNavigate = useCallback(
    (id: string) => {
      setObservedActiveId(id);
      navigatingToRef.current = id;
      if (navigationReleaseTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(navigationReleaseTimerRef.current);
      }
      if (typeof window !== 'undefined') {
        navigationReleaseTimerRef.current = window.setTimeout(() => {
          if (navigatingToRef.current === id) navigatingToRef.current = null;
          navigationReleaseTimerRef.current = null;
        }, 1200);
      } else {
        navigatingToRef.current = null;
      }

      if (onNavigate) {
        onNavigate(id);
        return;
      }
      const element = getSectionElement(id);
      if (element) scrollToSection(element);
    },
    [getSectionElement, onNavigate],
  );

  if (visibleItems.length === 0) return null;

  const renderButton = (item: SettingsSectionNavItem, variant: 'desktop' | 'mobile') => {
    const isActive = item.id === currentActiveId;
    const label = variant === 'mobile' ? item.shortLabel || item.label : item.label;
    return (
      <button
        key={`${variant}-${item.id}`}
        type="button"
        className={joinClassNames(
          variant === 'desktop'
            ? 'settings-section-nav__item'
            : 'settings-section-nav__chip',
          isActive && 'is-active',
        )}
        aria-current={isActive ? 'true' : undefined}
        data-section-nav-target={item.id}
        onClick={() => handleNavigate(item.id)}
      >
        <span
          className={
            variant === 'desktop'
              ? 'settings-section-nav__item-label'
              : 'settings-section-nav__chip-label'
          }
        >
          {label}
        </span>
        {item.badge ? <span className="settings-section-nav__badge">{item.badge}</span> : null}
      </button>
    );
  };

  return (
    <div ref={navRef} className={joinClassNames('settings-section-nav', className)}>
      <nav className="settings-section-nav__desktop" aria-label="设置页分组导航">
        <div className="settings-section-nav__title">{title}</div>
        <div className="settings-section-nav__list">
          {visibleItems.map((item) => renderButton(item, 'desktop'))}
        </div>
      </nav>
      <nav className="settings-section-nav__mobile" aria-label="设置页分组导航">
        <div className="settings-section-nav__chips">
          {visibleItems.map((item) => renderButton(item, 'mobile'))}
        </div>
      </nav>
    </div>
  );
}
