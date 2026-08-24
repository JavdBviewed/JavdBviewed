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
  /** 可选稳定 ID，兼容旧版页面的弹窗锚点。 */
  dialogId?: string;
  titleId?: string;
  closeButtonId?: string;
  /** 保留隐藏 DOM，兼容依赖弹窗字段稳定 ID 的设置搜索与旧初始化器。 */
  keepMounted?: boolean;
};

/**
 * 自研弹窗（对齐 Dashboard 浮层层级 token，不渲染全屏遮罩）
 * 通过 Portal 挂到 document.body，避免被祖先的 transform/overflow/层叠上下文困住或被页面局部 CSS 污染。
 */
export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  className,
  dialogId,
  titleId,
  closeButtonId,
  keepMounted = false,
}: ModalProps) {
  if (!open && !keepMounted) return null;

  const overlay = (
    <div
      id={dialogId}
      className={cn(
        'fixed inset-0 z-[var(--z-modal)] items-center justify-center p-4',
        open ? 'flex' : 'hidden',
      )}
      hidden={!open}
      aria-hidden={!open}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-3)] border',
          'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] shadow-[var(--shadow-3)]',
          className,
        )}
      >
        <div className="ui-modal__header flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <h2 id={titleId} className="text-base font-bold tracking-tight">{title}</h2>
          <Button
            id={closeButtonId}
            variant="ghost"
            size="sm"
            className="ui-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <i className="fas fa-times" aria-hidden="true" />
          </Button>
        </div>
        <div className="ui-modal__body min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-[var(--color-fg-muted)]">{children}</div>
        {footer ? (
          <div className="ui-modal__footer flex shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
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
