/**
 * @file releaseAnnouncementModal.ts
 * @description releaseAnnouncementModal
 * @module features/releaseAnnouncement
 */
import type { ResolvedReleaseAnnouncement } from '../domain/types';
import { markAnnouncementSeen, readReleaseAnnouncementState } from '../application/announcementState';
import { resolveAnnouncement } from '../application/resolveAnnouncement';

const MODAL_ID = 'jdb-release-announcement-modal';
const STYLE_ID = 'jdb-release-announcement-style';

export async function mountReleaseAnnouncementModal(currentVersion = getManifestVersion()): Promise<void> {
  if (document.getElementById(MODAL_ID)) return;

  const state = await readReleaseAnnouncementState();
  const announcement = resolveAnnouncement({ state, currentVersion });
  if (!announcement) return;

  ensureReleaseAnnouncementStyles();
  document.body.appendChild(createReleaseAnnouncementModal(announcement));
}

function createReleaseAnnouncementModal(announcement: ResolvedReleaseAnnouncement): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.className = 'jdb-release-announcement-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'jdb-release-announcement-title');

  const shell = document.createElement('div');
  shell.className = 'jdb-release-announcement-shell';

  const sparks = document.createElement('div');
  sparks.className = 'jdb-release-sparks';
  const burstClasses = ['burst-a', 'burst-b', 'burst-c'];
  for (let burstIndex = 0; burstIndex < burstClasses.length; burstIndex += 1) {
    const burst = document.createElement('div');
    burst.className = `jdb-release-burst ${burstClasses[burstIndex]}`;
    burst.style.setProperty('--burst-delay', `${burstIndex * 760}ms`);

    for (let sparkIndex = 0; sparkIndex < 12; sparkIndex += 1) {
      const spark = document.createElement('span');
      spark.className = 'jdb-release-spark';
      spark.style.setProperty('--angle', `${sparkIndex * 30 + burstIndex * 10}deg`);
      spark.style.setProperty('--distance', `${62 + ((sparkIndex + burstIndex) % 4) * 10}px`);
      spark.style.setProperty('--delay', `${sparkIndex * 28}ms`);
      spark.style.setProperty('--spark-scale', `${0.9 + (sparkIndex % 3) * 0.14}`);
      burst.appendChild(spark);
    }

    sparks.appendChild(burst);
  }

  const badge = document.createElement('div');
  badge.className = 'jdb-release-badge';
  badge.textContent = announcement.type === 'install' ? 'NEW' : 'UPDATE';

  const title = document.createElement('h2');
  title.id = 'jdb-release-announcement-title';
  title.textContent = announcement.title;

  const subtitle = document.createElement('p');
  subtitle.className = 'jdb-release-subtitle';
  subtitle.textContent = announcement.subtitle;

  const list = document.createElement('ul');
  list.className = 'jdb-release-highlights';
  for (const text of announcement.highlights) {
    const item = document.createElement('li');
    item.textContent = text;
    list.appendChild(item);
  }

  const actionRow = document.createElement('div');
  actionRow.className = 'jdb-release-actions';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'jdb-release-primary';
  closeButton.dataset.action = 'release-announcement-close';
  closeButton.textContent = announcement.primaryActionLabel;
  closeButton.addEventListener('click', () => {
    void closeReleaseAnnouncement(overlay, announcement.announcementKey);
  });

  actionRow.appendChild(closeButton);
  shell.append(sparks, badge, title, subtitle, list, actionRow);
  overlay.appendChild(shell);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      void closeReleaseAnnouncement(overlay, announcement.announcementKey);
    }
  });

  return overlay;
}

async function closeReleaseAnnouncement(modal: HTMLElement, announcementKey: string): Promise<void> {
  modal.remove();
  await markAnnouncementSeen(announcementKey);
}

function getManifestVersion(): string {
  try {
    return chrome.runtime.getManifest?.().version || '';
  } catch {
    return '';
  }
}

function ensureReleaseAnnouncementStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .jdb-release-announcement-modal {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow: auto;
      background:
        radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--primary, #3b82f6) 18%, transparent), transparent 34%),
        color-mix(in srgb, var(--surface-primary, #ffffff) 18%, rgba(15, 23, 42, 0.68));
      backdrop-filter: blur(10px);
    }

    .jdb-release-announcement-shell {
      position: relative;
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      padding: 28px 30px 24px;
      border: 1px solid color-mix(in srgb, var(--border-primary, #d8dee8) 78%, transparent);
      border-radius: 14px;
      background:
        linear-gradient(145deg, color-mix(in srgb, var(--surface-primary, #ffffff) 94%, #fff 6%), var(--surface-secondary, #f7f8fb));
      color: var(--text-primary, #172033);
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
      overflow: auto;
      animation: jdbReleaseEnter 220ms ease-out both;
    }

    .jdb-release-badge {
      position: relative;
      z-index: 1;
      width: fit-content;
      margin-bottom: 12px;
      padding: 4px 9px;
      border: 1px solid color-mix(in srgb, #f97316 50%, var(--border-primary, #d8dee8));
      border-radius: 999px;
      color: #c2410c;
      background: color-mix(in srgb, #f97316 13%, var(--surface-primary, #ffffff));
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .jdb-release-announcement-shell h2 {
      position: relative;
      z-index: 1;
      margin: 0;
      font-size: 24px;
      line-height: 1.25;
      color: var(--text-primary, #172033);
    }

    .jdb-release-subtitle {
      position: relative;
      z-index: 1;
      margin: 10px 0 18px;
      color: var(--text-secondary, #536079);
      font-size: 14px;
      line-height: 1.7;
    }

    .jdb-release-highlights {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .jdb-release-highlights li {
      position: relative;
      padding: 10px 12px 10px 30px;
      border: 1px solid color-mix(in srgb, var(--border-primary, #d8dee8) 70%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--surface-primary, #ffffff) 72%, var(--surface-secondary, #f7f8fb));
      color: var(--text-primary, #172033);
      font-size: 13px;
      line-height: 1.55;
    }

    .jdb-release-highlights li::before {
      content: "";
      position: absolute;
      left: 12px;
      top: 17px;
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #f97316;
      box-shadow: 0 0 0 4px color-mix(in srgb, #f97316 16%, transparent);
    }

    .jdb-release-actions {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: flex-end;
      margin-top: 22px;
    }

    .jdb-release-primary {
      min-width: 108px;
      height: 36px;
      padding: 0 18px;
      border: 1px solid color-mix(in srgb, #f97316 72%, #ea580c);
      border-radius: 8px;
      background: linear-gradient(135deg, #f97316, #ea580c);
      color: #ffffff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 22px color-mix(in srgb, #f97316 28%, transparent);
    }

    .jdb-release-primary:hover {
      filter: brightness(1.04);
    }

    .jdb-release-sparks {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }

    .jdb-release-burst {
      position: absolute;
      width: 12px;
      height: 12px;
    }

    .jdb-release-burst.burst-a {
      top: 46px;
      right: 76px;
      --spark-color: #f97316;
    }

    .jdb-release-burst.burst-b {
      top: 82px;
      left: 72px;
      --spark-color: #0ea5e9;
    }

    .jdb-release-burst.burst-c {
      right: 112px;
      bottom: 78px;
      --spark-color: #facc15;
    }

    .jdb-release-spark {
      position: absolute;
      left: 0;
      top: 0;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--spark-color, #f97316);
      opacity: 0;
      transform: rotate(var(--angle)) translate(0) scale(var(--spark-scale, 0.8));
      box-shadow:
        0 0 16px color-mix(in srgb, var(--spark-color, #f97316) 74%, transparent),
        0 0 3px rgba(255, 255, 255, 0.75);
      /* 装饰性 spark 不参与业务交互；关闭动画，避免 36 个元素在首页持续触发合成与栅格。 */
      animation: none;
    }

    [data-theme="dark"] .jdb-release-announcement-modal {
      background:
        radial-gradient(circle at 50% 38%, color-mix(in srgb, #fb923c 20%, transparent), transparent 34%),
        color-mix(in srgb, var(--surface-primary, #0f172a) 22%, rgba(2, 6, 23, 0.78));
    }

    [data-theme="dark"] .jdb-release-announcement-shell {
      background:
        linear-gradient(145deg, color-mix(in srgb, var(--surface-primary, #111827) 92%, #172033 8%), var(--surface-secondary, #0f172a));
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.46);
    }

    [data-theme="dark"] .jdb-release-badge {
      color: #fed7aa;
      background: color-mix(in srgb, #f97316 20%, var(--surface-primary, #111827));
    }

    @keyframes jdbReleaseEnter {
      from { opacity: 0; transform: translateY(10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .jdb-release-announcement-shell,
      .jdb-release-spark {
        animation: none;
      }

      .jdb-release-spark {
        display: none;
      }
    }
  `;

  document.head.appendChild(style);
}
