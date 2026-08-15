/**
 * @file Modal.tsx
 * @description 轻量弹窗壳：标题栏 + 内容区 + 可选页脚
 * @module ui/primitives
 */
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { Button } from '../Button/Button';

export type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
};

/**
 * 自研弹窗（对齐 Dashboard 浮层层级 token，不渲染全屏遮罩）
 * 通过 Portal 挂到 document.body，避免被祖先的 transform/overflow/层叠上下文困住或被页面局部 CSS 污染。
 */
export function Modal({ open, title, children, onClose, footer, className }: ModalProps) {
  if (!open) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 w-full max-w-lg overflow-hidden rounded-[var(--radius-3)] border',
          'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] shadow-[var(--shadow-3)]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭">
            ✕
          </Button>
        </div>
        <div className="px-4 py-3 text-sm text-[var(--color-fg-muted)]">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  // SSR / 测试（无 document）时内联渲染；浏览器中挂到 body，避免祖先 transform/overflow 困住浮层。
  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
}
