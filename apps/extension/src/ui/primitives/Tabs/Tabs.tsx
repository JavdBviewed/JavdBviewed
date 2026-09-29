/**
 * @file Tabs.tsx
 * @description 分段标签切换基础组件（非 Dashboard 主导航）
 * @module ui/primitives
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type TabItem = {
  id: string;
  label: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /** 视觉密度 */
  size?: 'sm' | 'md';
  /**
   * DOM id 前缀（缺省=空串）。tab 按钮恒输出 id 与 aria-controls（a11y 增强；
   * 改造前 base 版不输出）。同页嵌套使用 Tabs 时传前缀做命名空间，避免按钮 id /
   * aria-controls 目标重名（HTML id 唯一性）。
   */
  idPrefix?: string;
};

/**
 * 自研 Tabs：用于设置/面板内分段，不是顶栏主导航
 */
export function Tabs({ items, value, onChange, className, size = 'md', idPrefix = '' }: TabsProps) {
  return (
    <div
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1',
        className,
      )}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            id={`${idPrefix}tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}tabpanel-${item.id}`}
            disabled={item.disabled}
            className={cn(
              'rounded-[var(--radius-pill)] border border-transparent font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:shadow-[var(--ring-focus)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              active
                ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[var(--shadow-1)]'
                : 'bg-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
            )}
            onClick={() => {
              if (!item.disabled) onChange(item.id);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
