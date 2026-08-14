/**
 * @file releaseAnnouncementState.test.ts
 * @description release announcement state 测试
 * @module tests/extension
 */
import { describe, expect, it } from 'vitest';
import {
  RELEASE_ANNOUNCEMENT_FALLBACK_KEY,
  RELEASE_NOTES,
  buildAnnouncementKey,
  markAnnouncementSeen,
  readReleaseAnnouncementState,
  resolveAnnouncement,
} from '../../apps/extension/src/features/releaseAnnouncement';
import { getChromeStorageSnapshot, setChromeStorage } from '../setup/chrome';

describe('release announcement state', () => {
  it('resolves a welcome announcement for first install', () => {
    const announcement = resolveAnnouncement({
      state: {
        pending: {
          type: 'install',
          version: '1.20.2',
          createdAt: 1000,
        },
      },
      currentVersion: '1.20.2',
    });

    expect(announcement).toEqual(expect.objectContaining({
      type: 'install',
      announcementKey: '1.20.2',
      version: '1.20.2',
      title: '欢迎使用 Jav 助手',
      primaryActionLabel: '开始使用',
    }));
    expect(announcement?.subtitle).toContain('个人浏览助手');
    expect(announcement?.subtitle).not.toContain('v1.20.2');
    expect(announcement?.highlights).toEqual([
      '在番号库管理已看、想看和浏览记录。',
      '在影片页使用磁力搜索、在线可看和字幕入口。',
      '按需开启 115 推送、WebDAV 同步和隐私保护。',
      '所有增强功能都能在设置页随时调整。',
    ]);
  });

  it('uses version as the announcement key for same-version builds', () => {
    const announcement = resolveAnnouncement({
      state: {
        lastSeenAnnouncementKey: '1.20.2',
        pending: {
          type: 'update',
          version: '1.20.2',
          createdAt: 1000,
        },
      },
      currentVersion: '1.20.2',
    });

    expect(buildAnnouncementKey('1.20.2')).toBe('1.20.2');
    expect(announcement).toBeNull();
  });

  it('returns no announcement after the same key has been seen', () => {
    const announcement = resolveAnnouncement({
      state: {
        lastSeenAnnouncementKey: '1.20.2',
        pending: {
          type: 'update',
          version: '1.20.2',
          previousVersion: '1.20.1',
          createdAt: 1000,
        },
      },
      currentVersion: '1.20.2',
    });

    expect(announcement).toBeNull();
  });

  it('uses a fallback key and hides the version label when manifest version is absent', () => {
    const announcement = resolveAnnouncement({
      state: {
        pending: {
          type: 'update',
          createdAt: 1000,
        },
      },
      currentVersion: '',
    });

    expect(buildAnnouncementKey('', '')).toBe(RELEASE_ANNOUNCEMENT_FALLBACK_KEY);
    expect(announcement).toEqual(expect.objectContaining({
      type: 'update',
      announcementKey: RELEASE_ANNOUNCEMENT_FALLBACK_KEY,
      title: 'Jav 助手已更新',
    }));
    expect(announcement?.subtitle).not.toContain('v');
  });

  it('marks an announcement as seen and clears pending state', async () => {
    setChromeStorage({
      release_announcement_state: {
        pending: {
          type: 'update',
          version: '1.20.2',
          createdAt: 1000,
        },
      },
    });

    await markAnnouncementSeen('1.20.2', 2000);

    await expect(readReleaseAnnouncementState()).resolves.toEqual({
      lastSeenAnnouncementKey: '1.20.2',
      lastSeenAt: 2000,
    });
    expect(getChromeStorageSnapshot()).toMatchObject({
      release_announcement_state: {
        lastSeenAnnouncementKey: '1.20.2',
        lastSeenAt: 2000,
      },
    });
  });

  it('ships user-facing release notes for recent versions', () => {
    expect(RELEASE_NOTES.map(note => note.version)).toEqual([
      '2.0.1',
      '2.0.0',
      '1.21.4',
      '1.21.3',
      '1.21.2',
      '1.21.1',
      '1.21.0',
      '1.20.2',
      '1.20.1',
      '1.20.0',
    ]);
    const highlightsFor = (version: string) => RELEASE_NOTES.find(note => note.version === version)?.highlights;

    expect(highlightsFor('2.0.1')).toEqual(expect.arrayContaining([
      '详情页与列表页的增强任务改为更平稳的智能调度，浏览时减少卡顿。',
      'Cloud 同步修复并发刷新导致的偶发登录失效，并显示真实同步阶段和耗时。',
    ]));
    expect(highlightsFor('2.0.0')).toEqual(expect.arrayContaining([
      '新增本地 ZIP 备份与恢复，兼容历史 JSON 备份。',
      '本地与 WebDAV 使用统一 ZIP 格式，迁移恢复更稳。',
    ]));
    expect(highlightsFor('1.21.4')).toEqual(expect.arrayContaining([
      '关闭控制面板后，下次打开可在头像旁恢复上次页面。',
      '新作品立即检查会显示当前并发检查中的演员名单。',
    ]));
    expect(highlightsFor('1.21.3')).toEqual(expect.arrayContaining([
      '源站存入清单可直接勾选 Jav助手本地清单。',
      '磁力质量评分改为清晰度与体积优先。',
    ]));
    expect(highlightsFor('1.21.2')).toEqual(expect.arrayContaining([
      '媒体库入口已开放，Dashboard 分类导航重新整理。',
      'WebDAV 支持默认备份端、单端备份和全部备份端上传。',
    ]));
    expect(highlightsFor('1.21.1')).toEqual(expect.arrayContaining([
      '磁力结果新增质量评分排序，优先显示更可靠资源。',
      '服务端入口新增 GitHub 引导和本地缓存兜底。',
    ]));
    expect(highlightsFor('1.21.0')).toEqual(expect.arrayContaining([
      'WebDAV 备份/恢复支持按类别选择、进度反馈和设备筛选。',
      'Emby/Jellyfin 新增入库状态显示和服务器自动识别。',
    ]));
    expect(highlightsFor('1.20.2')).toEqual(expect.arrayContaining([
      '影片页新增在线可看、外部搜索和字幕搜索入口。',
      '磁力升级多源聚合、分页、来源筛选和 JAVBUS 兜底。',
    ]));
    expect(highlightsFor('1.20.1')).toContain('115 离线下载支持选择目标文件夹。');
    expect(highlightsFor('1.20.0')).toContain('全局任务中心接入详情页增强和后台任务。');
    for (const note of RELEASE_NOTES) {
      expect(note.highlights.length).toBeGreaterThanOrEqual(3);
      expect(note.highlights.every(item => item.length >= 12 && item.length <= 42)).toBe(true);
    }
  });
});
