/**
 * @file settingsSearchHighlight.ts
 * @description settingsSearchHighlight
 * @module features/settingsSearch
 */
import type { RevealSettingsSearchTargetOptions, SettingsSearchTarget } from '../domain/types';

const STORAGE_KEY = 'jdb:settingsSearch:target';
const HIGHLIGHT_CLASS = 'jdb-settings-search-highlight';

export function storeSettingsSearchTarget(target: SettingsSearchTarget): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
}

export function readStoredSettingsSearchTarget(): SettingsSearchTarget | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SettingsSearchTarget;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export async function revealStoredSettingsSearchTarget(options: RevealSettingsSearchTargetOptions = {}): Promise<boolean> {
  const target = readStoredSettingsSearchTarget();
  if (!target) return false;

  const waitMs = Math.max(0, options.waitMs ?? 1200);
  const highlightMs = Math.max(0, options.highlightMs ?? 1800);
  const element = await waitForElement(target.targetSelector, waitMs);
  if (!element) return false;

  sessionStorage.removeItem(STORAGE_KEY);

  revealEnhancementContext(element);
  const highlightTarget = findHighlightContainer(element);
  await waitForEnhancementCardToRender(highlightTarget, waitMs);
  highlightTarget.dataset.enhancementReveal = '1';
  highlightTarget.dispatchEvent(new CustomEvent('jdb:enhancement:reveal-card', { bubbles: true }));
  scrollElementIntoView(highlightTarget);
  highlightTarget.classList.add(HIGHLIGHT_CLASS);

  window.setTimeout(() => {
    highlightTarget.classList.remove(HIGHLIGHT_CLASS);
  }, highlightMs);

  return true;
}

function findHighlightContainer(element: Element): HTMLElement {
  const structuredContainer = element.closest([
    '[data-enhancement-feature]',
    '.search-engine-item',
    '.online-availability-site-item',
    '.magnet-concurrency-config .form-group-inline',
    '.form-group',
    '.form-group-checkbox',
    '.setting-item',
    '.settings-card',
    '.settings-section',
  ].join(',')) as HTMLElement | null;

  return structuredContainer
    || (element.closest('[data-settings-search-target]') as HTMLElement | null)
    || (element as HTMLElement);
}

function revealEnhancementContext(element: Element): void {
  const enhancementRoot = element.closest('#enhancement-settings') as HTMLElement | null;
  if (!enhancementRoot) return;

  revealEnhancementSubtab(enhancementRoot, element);
  revealAncestorSubSettings(enhancementRoot, element);
}

function revealEnhancementSubtab(enhancementRoot: HTMLElement, element: Element): void {
  const reactSubtab = element.closest<HTMLElement>('[data-enhancement-subtab]')?.dataset.enhancementSubtab;
  if (reactSubtab) {
    window.dispatchEvent(new CustomEvent('jdb:enhancement:activate-subtab', {
      detail: { subtab: reactSubtab },
    }));
    return;
  }

  const subtabGroup = element.closest('#enhancement-settings .form-group[data-subtab]') as HTMLElement | null;
  const subtab = subtabGroup?.getAttribute('data-subtab');
  if (!subtab) return;

  enhancementRoot.querySelectorAll<HTMLElement>('.subtab-link[data-subtab]').forEach(button => {
    button.classList.toggle('active', button.getAttribute('data-subtab') === subtab);
  });

  enhancementRoot.querySelectorAll<HTMLElement>('.settings-page-body .form-group[data-subtab]').forEach(group => {
    group.style.display = group.getAttribute('data-subtab') === subtab ? '' : 'none';
  });

  try {
    localStorage.setItem('enhancementSubtab', subtab);
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

function waitForEnhancementCardToRender(element: HTMLElement, waitMs: number): Promise<void> {
  if (!element.matches('[data-enhancement-feature]')) return Promise.resolve();
  const deadline = Date.now() + waitMs;
  return new Promise(resolve => {
    const check = () => {
      if (element.getClientRects().length > 0 || Date.now() >= deadline) {
        resolve();
        return;
      }
      window.requestAnimationFrame(check);
    };
    check();
  });
}

function revealAncestorSubSettings(enhancementRoot: HTMLElement, element: Element): void {
  let current = element.parentElement;
  const subSettings: HTMLElement[] = [];

  while (current && current !== enhancementRoot.parentElement) {
    if (current.classList.contains('sub-settings')) {
      subSettings.push(current);
    }
    if (current === enhancementRoot) break;
    current = current.parentElement;
  }

  subSettings.reverse().forEach(section => {
    section.style.display = 'block';
    section.classList.add('is-open');
    section.style.maxHeight = 'none';
    section.style.opacity = '';
    section.style.borderTopWidth = '';
    section.style.borderBottomWidth = '';
    section.style.paddingTop = '';
    section.style.paddingBottom = '';
  });
}

function scrollElementIntoView(element: HTMLElement): void {
  if (typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function waitForElement(selector: string, waitMs: number): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing || waitMs === 0) return Promise.resolve(existing);

  return new Promise(resolve => {
    const deadline = window.setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector(selector));
    }, waitMs);

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (!element) return;
      window.clearTimeout(deadline);
      observer.disconnect();
      resolve(element);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}
