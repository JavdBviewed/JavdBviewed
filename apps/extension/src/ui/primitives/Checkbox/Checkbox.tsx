/**
 * @file Checkbox.tsx
 * @description 通用 checkbox 组件（09-29-cftabs 新增）：
 *   视觉基准对齐新作品侧 checkbox（.checkbox-label：flex + 8px gap + 16px 原生 input；
 *   .category-checkbox(-compact)：border 圆角卡片行 + hover 变色 + 紧凑密度）。
 *   label 包裹 input（隐式关联，a11y 免费）；受控组件。
 * @module ui/primitives
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type CheckboxProps = {
  /** 稳定 checkbox id（a11y / 设置搜索锚点） */
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 标签文本（渲染在 checkbox 之后） */
  label?: ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
  /** plain=行内流式（默认）；card=边框卡片行（新作品类别勾选基准） */
  variant?: 'plain' | 'card';
  /** 仅 card 生效：紧凑密度（32px 行高）；默认 false=42px */
  compact?: boolean;
};

/**
 * 通用 checkbox（新作品侧样式基准：16px input / 8px gap / 卡片行 hover 反馈）
 */
export function Checkbox({
  id,
  checked,
  onChange,
  label,
  title,
  disabled = false,
  className,
  variant = 'plain',
  compact = false,
}: CheckboxProps) {
  const card = variant === 'card';
  return (
    <label
      title={title}
      data-ui-pattern="checkbox"
      data-checkbox-variant={card ? (compact ? 'card-compact' : 'card') : 'plain'}
      className={cn(
        'm-0 inline-flex items-center gap-2',
        card
          ? 'flex w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] transition-[border-color,background-color] duration-200'
          : 'text-sm',
        card && (compact ? 'min-h-[32px] px-2.5 py-1.5 text-[13px]' : 'min-h-[42px] px-3 py-2.5'),
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        card && !disabled && 'hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-2)]',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className={cn(
          'h-4 w-4 shrink-0 accent-[var(--color-primary)]',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      />
      {label ? <span className="min-w-0 leading-snug">{label}</span> : null}
    </label>
  );
}
