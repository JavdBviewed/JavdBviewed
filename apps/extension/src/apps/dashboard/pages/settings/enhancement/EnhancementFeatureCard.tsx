/**
 * @file EnhancementFeatureCard.tsx
 * @description 功能增强设置卡片的统一视觉与展开交互
 * @module apps/dashboard/pages/settings/enhancement
 */
import { Children, type ReactNode, useEffect, useRef, useState } from 'react';

export type EnhancementFeatureMeta = {
  icon: string;
  status: string;
  tone: 'available' | 'beta' | 'neutral';
  effect?: string;
  usage?: string;
  usageHelp?: string[];
  riskNotice?: string;
};

export type EnhancementFeatureCardProps = {
  title: string;
  description?: ReactNode;
  meta: EnhancementFeatureMeta;
  children: ReactNode;
};

/**
 * 功能增强卡片：首个子节点作为主开关，其余内容作为可展开的子配置。
 */
export function EnhancementFeatureCard({
  title,
  description,
  meta,
  children,
}: EnhancementFeatureCardProps) {
  const [masterToggle, ...details] = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const openedAt = useRef(0);

  const clearTimers = () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  const open = (immediate = false) => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (expanded || openTimer.current !== null) return;
    const reveal = () => {
      openTimer.current = null;
      openedAt.current = Date.now();
      setExpanded(true);
    };
    if (immediate) reveal();
    else openTimer.current = window.setTimeout(reveal, 120);
  };

  const close = () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (!expanded || closeTimer.current !== null) return;
    const minimumOpenRemaining = Math.max(0, 420 - (Date.now() - openedAt.current));
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setExpanded(false);
    }, Math.max(180, minimumOpenRemaining));
  };

  useEffect(() => clearTimers, []);

  useEffect(() => {
    const section = cardRef.current;
    if (!section) return undefined;
    const reveal = () => open(true);
    if (section.dataset.enhancementReveal === '1') {
      delete section.dataset.enhancementReveal;
      reveal();
    }
    section.addEventListener('jdb:enhancement:reveal-card', reveal);
    return () => section.removeEventListener('jdb:enhancement:reveal-card', reveal);
  });

  return (
    <section
      ref={cardRef}
      className="enhancement-feature-card"
      data-ui-pattern="setting-section"
      data-enhancement-feature={title}
      data-expanded={expanded ? '1' : '0'}
      onMouseEnter={() => open()}
      onMouseLeave={close}
      onFocusCapture={() => open(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <div className="enhancement-feature-card__header">
        <div className="enhancement-feature-info">
          <div className="enhancement-feature-title">
            <h3 className="enhancement-feature-name">{meta.icon} {title}</h3>
            <span className={`enhancement-feature-status ${meta.tone}`}>{meta.status}</span>
          </div>
        </div>
        <div className="enhancement-feature-card__header-actions">
          {meta.usageHelp ? (
            <details className="enhancement-usage-help enhancement-feature-card__help">
              <summary
                className="enhancement-feature-card__help-trigger"
                title="使用帮助"
                aria-label="使用帮助"
              >
                <i className="fas fa-question-circle" aria-hidden="true" />
              </summary>
              <div className="enhancement-feature-card__help-popover">
                <ol>
                  {meta.usageHelp.map((item) => <li key={item}>{item}</li>)}
                </ol>
              </div>
            </details>
          ) : null}
          <div className="enhancement-feature-card__master">{masterToggle}</div>
        </div>
      </div>
      {meta.effect || description ? (
        <p className="input-description enhancement-feature-card__description">
          <strong>效果：</strong>{meta.effect ?? description}
          {meta.usage ? <><br /><strong>使用：</strong>{meta.usage}</> : null}
        </p>
      ) : null}
      {meta.riskNotice ? (
        <div className="enhancement-risk-notice" role="note">
          <strong>调用限制提示</strong>
          <span>{meta.riskNotice}</span>
        </div>
      ) : null}
      {details.length > 0 ? (
        <div
          className={`enhancement-feature-card__details${expanded ? ' is-open' : ''}`}
          aria-hidden={!expanded}
        >
          {details}
        </div>
      ) : null}
    </section>
  );
}
