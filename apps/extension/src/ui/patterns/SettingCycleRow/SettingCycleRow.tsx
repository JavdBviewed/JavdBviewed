/**
 * @file SettingCycleRow.tsx
 * @description 设置循环行：左侧标签/说明，右侧循环按钮（点击切到下一态，末尾回绕）。
 * 通用受控组件，零业务语义/零门控；行壳视觉与 SettingToggleRow 一致，保证卡片行视觉统一。
 * @module ui/patterns
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SettingCycleOption<V extends string> {
  value: V;
  label: string;
}

export type SettingCycleRowProps<V extends string> = {
  /** 稳定 id（a11y / 设置搜索锚点），落在右侧循环按钮上 */
  id: string;
  /** 主标签 */
  label: ReactNode;
  /** 有序选项（任意长度，≥1）；value 必须命中其中一项 */
  options: ReadonlyArray<SettingCycleOption<V>>;
  /** 当前态（受控） */
  value: V;
  /** 点击回调：接收循环到下一个态的 value（末尾回绕到首项） */
  onChange: (next: V) => void;
  /** 可选副说明 */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/**
 * 设置密度下的循环行（label 左 / 循环 button 右）。
 * disabled 时点击 no-op；button aria-label 含当前态（如「当前：减去」）。
 */
export function SettingCycleRow<V extends string>({
  id,
  label,
  options,
  value,
  onChange,
  description,
  disabled,
  className,
}: SettingCycleRowProps<V>) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const current = options[idx];
  const next = options[(idx + 1) % options.length];
  const labelPrefix = typeof label === 'string' ? `${label} ` : '';

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-[var(--radius-2)] px-2 py-2.5',
        disabled ? 'opacity-50' : 'hover:bg-[var(--color-surface-2)]',
        className,
      )}
      data-ui-pattern="setting-cycle-row"
    >
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn(
            'm-0 block text-[13.5px] font-semibold text-[var(--color-fg)]',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 mb-0 text-[12px] leading-snug text-[var(--color-fg-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={`${labelPrefix}当前：${current.label}`}
        className={cn(
          'inline-flex h-8 min-w-16 items-center justify-center rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-xs font-medium text-[var(--color-fg)]',
          disabled
            ? 'cursor-not-allowed'
            : 'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]',
        )}
        onClick={() => {
          if (disabled) return;
          onChange(next.value);
        }}
      >
        {current.label}
      </button>
    </div>
  );
}
