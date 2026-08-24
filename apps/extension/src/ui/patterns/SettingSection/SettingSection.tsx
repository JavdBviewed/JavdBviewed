/**
 * @file SettingSection.tsx
 * @description 设置区块模式：卡片式标题 + 说明 + 内容区
 * @module ui/patterns
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type SettingSectionProps = HTMLAttributes<HTMLElement> & {
  /** 区块标题 */
  title: ReactNode;
  /** 与旧版区块标题一致的 Font Awesome 图标或自定义节点 */
  icon?: ReactNode;
  /** 可选说明 */
  description?: ReactNode;
  children: ReactNode;
  /**
   * 内容区 class（可放 grid 等布局工具类）
   * 例：`grid gap-1 sm:grid-cols-2`
   */
  contentClassName?: string;
};

/**
 * 自研设置区块（设置页分组容器）
 */
export function SettingSection({
  title,
  icon,
  description,
  children,
  contentClassName,
  className,
  ...rest
}: SettingSectionProps) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-3)] border border-[var(--color-border)] bg-[var(--color-surface)]',
        'shadow-[var(--shadow-1)] text-[var(--color-fg)]',
        'transition-[transform,box-shadow,border-color] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:border-[var(--color-border-strong,var(--color-border))]',
        'hover:shadow-[var(--shadow-2,0_12px_28px_rgba(15,23,42,0.1))]',
        className,
      )}
      data-ui-pattern="setting-section"
      {...rest}
    >
      <header className="border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="m-0 flex items-center gap-2 text-sm font-bold tracking-tight text-[var(--color-fg)]">
          {icon ? (
            <span className="setting-section__icon inline-flex w-4 shrink-0 justify-center text-[var(--color-primary)]" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span>{title}</span>
        </h3>
        {description ? (
          <p className="mt-1 mb-0 text-[12.5px] leading-relaxed text-[var(--color-fg-muted)]">
            {description}
          </p>
        ) : null}
      </header>
      <div className={cn('flex flex-col gap-0.5 px-2 py-2', contentClassName)}>
        {children}
      </div>
    </section>
  );
}
