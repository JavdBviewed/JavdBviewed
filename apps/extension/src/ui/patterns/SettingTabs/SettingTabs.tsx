/**
 * @file SettingTabs.tsx
 * @description 卡内分段 tab 容器（09-29-cftabs 新增）：
 *   用于「内容过滤」卡的分段配置（番号过滤 / 演员过滤 / 影片类别过滤 / 内容过滤规则）。
 *   - 全部 pane 渲染进 DOM（非活动 pane 用 hidden 属性隐藏且不带 display class——
 *     作者层 display 类会压过 UA 层 [hidden] 规则，见 pane 渲染处注释），设置搜索 querySelector 可达任一 pane 控件；
 *   - 设置搜索命中后落对应 tab（双路 reveal）：
 *     ① live 事件——监听 jdb:enhancement:reveal-card 事件（detail.target 落在某 pane 内
 *       → 切到该 pane；无 detail 的旧事件不受影响，向后兼容）；
 *     ② 挂载兜底——legacy init 在 React 挂载 effects 就位前派发事件会丢失，
 *       settingsSearchHighlight 同时把目标控件选择器写进卡片的
 *       data-enhancement-reveal-target；挂载时重查切 pane 后消费该属性
 *       （与 EFC 的 data-enhancement-reveal 兜底同机制）；
 *   - 活动态为 UI 瞬态（不持久化，默认第一 pane）。
 * @module ui/patterns
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs } from '../../primitives/Tabs/Tabs';
import { cn } from '../../lib/cn';

export type SettingTabsPane = {
  id: string;
  label: string;
  render: () => ReactNode;
};

export type SettingTabsProps = {
  panes: readonly SettingTabsPane[];
  /** 默认活动 pane（缺省=第一个 pane） */
  defaultId?: string;
  /**
   * DOM id 前缀（缺省=空串）。同页已有同 id 顶层 tab 时（如增强设置页顶层
   * 「演员页增强」tab 与卡内「演员过滤」pane 均生成 #tab-actor）须传前缀做
   * 命名空间，保证 HTML id 唯一与 aria-controls/aria-labelledby 指向正确目标。
   * data-setting-tab-pane 属性恒为裸 pane id（稳定选择器钩子，不受前缀影响）。
   */
  idPrefix?: string;
  className?: string;
};

/**
 * 设置卡内分段 tab（tablist 复用 Tabs 原语；panes 全量渲染，hidden 切显隐）
 */
export function SettingTabs({ panes, defaultId, idPrefix = '', className }: SettingTabsProps) {
  const [active, setActive] = useState<string>(
    defaultId && panes.some((p) => p.id === defaultId) ? defaultId : panes[0]?.id ?? '',
  );
  const paneRefs = useRef(new Map<string, HTMLElement>());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 设置搜索命中 → 落对应 tab（双路：① live 事件 ② 挂载兜底，见文件头注释）
  useEffect(() => {
    const activatePaneContaining = (target: Element | null) => {
      if (!target) return;
      for (const pane of panes) {
        const el = paneRefs.current.get(pane.id);
        if (el && el.contains(target)) {
          setActive(pane.id);
          return;
        }
      }
    };

    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent).detail as { target?: Element } | undefined;
      activatePaneContaining(detail?.target ?? null);
    };
    window.addEventListener('jdb:enhancement:reveal-card', onReveal);

    // ② 挂载兜底：legacy init 在 effects 就位前派发 reveal（事件丢失）时，
    // 读本组件所属卡片（[data-enhancement-feature]）上 settingsSearchHighlight
    // 写入的目标选择器，重查切 pane 后消费属性。
    const card = rootRef.current?.closest<HTMLElement>('[data-enhancement-feature]');
    const pendingSelector = card?.dataset.enhancementRevealTarget;
    if (pendingSelector) {
      const pending = pendingSelector.startsWith('#')
        ? document.getElementById(pendingSelector.slice(1))
        : document.querySelector(pendingSelector);
      activatePaneContaining(pending);
      card.removeAttribute('data-enhancement-reveal-target');
    }

    return () => window.removeEventListener('jdb:enhancement:reveal-card', onReveal);
  }, [panes]);

  return (
    <div ref={rootRef} className={cn('flex flex-col gap-2', className)} data-ui-pattern="setting-tabs">
      <Tabs
        items={panes.map((p) => ({ id: p.id, label: p.label }))}
        value={active}
        onChange={setActive}
        size="sm"
        idPrefix={idPrefix}
      />
      {panes.map((pane) => {
        const isActive = pane.id === active;
        return (
          <div
            key={pane.id}
            ref={(el) => {
              if (el) paneRefs.current.set(pane.id, el);
              else paneRefs.current.delete(pane.id);
            }}
            role="tabpanel"
            id={`${idPrefix}tabpanel-${pane.id}`}
            aria-labelledby={`${idPrefix}tab-${pane.id}`}
            hidden={!isActive}
            data-setting-tab-pane={pane.id}
            // 布局 class 仅活动 pane 携带：作者层 display class（.flex）会压过 UA 层
            // [hidden]{display:none}，非活动 pane 若带 flex 类会「hidden 属性在位但仍可见」
            // （真机 strict-mode 暴露，run3 A 段）。与顶层子 tab 面板同口径。
            className={isActive ? 'flex flex-col gap-2' : undefined}
          >
            {pane.render()}
          </div>
        );
      })}
    </div>
  );
}
