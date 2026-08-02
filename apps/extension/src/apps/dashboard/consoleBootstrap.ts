/**
 * @file consoleBootstrap.ts
 * @description consoleBootstrap
 * @module apps/dashboard
 */
import { applyConsoleSettingsFromStorage_DB, bindConsoleSettingsListener } from '../../dashboard/console/settings';
import { installConsoleProxy } from '../../platform/logging/consoleProxy';

export function installDashboardConsoleProxy(): void {
  installConsoleProxy({
    level: 'INFO',
    format: { showTimestamp: true, timestampStyle: 'hms', timeZone: 'Asia/Shanghai', showSource: true, color: true },
    categories: {
      general: { enabled: true, match: () => true, label: 'DB', color: '#8e44ad' },
      ai: { enabled: true, match: /\[AI\]|\bAI\b/i, label: 'AI', color: '#e67e22' },
      insights: { enabled: true, match: /\[INSIGHTS\]|Insights|报告|统计/i, label: 'INSIGHTS', color: '#2ecc71' },
      newworks: { enabled: true, match: /\[NewWorks|NewWorksManager|NEWWORKS\]|新作品/i, label: 'NEWWORKS', color: '#f39c12' },
      actor: { enabled: true, match: /\[Actor|ActorManager\]|演员|Actor/i, label: 'ACTOR', color: '#2980b9' },
      sync: { enabled: true, match: /\[Sync|DataSync\]|同步|WebDAV|Sync/i, label: 'SYNC', color: '#3498db' },
      drive115: { enabled: true, match: /\[(Drive115|115V?2?)\]|115网盘|Drive115/i, label: '115', color: '#d35400' },
      media: { enabled: true, match: /\[(MEDIA|EMBY|PLAYER|MediaLibrary|EmbyLibrary)\]|媒体库|Emby|Jellyfin/i, label: 'MEDIA', color: '#16a085' },
      privacy: { enabled: true, match: /\[(Privacy|PrivacyManager|LockScreen)\]|隐私|Privacy|Lock/i, label: 'PRIVACY', color: '#c0392b' },
      enhancement: { enabled: true, match: /\[(Enhancement|ListEnhancement|CoverEnhancement|OnlineAvailability|ReviewBreaker|FC2Breaker|EmbyEnhancement)\]|功能增强|列表增强|视频增强|封面增强|在线可看|评论破解|FC2增强|Emby增强/i, label: 'ENHANCEMENT', color: '#7d3c98' },
    },
  });

  applyConsoleSettingsFromStorage_DB();
  bindConsoleSettingsListener();
}
