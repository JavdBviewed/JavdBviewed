import { describe, expect, it } from 'vitest';
import { SETTINGS_SEARCH_ALIASES, expandSettingsSearchQuery } from './aliases';

// 10-15-library-source-rename：来源配置域更名「资料库」——emby 别名增新词、保旧词
describe('settingsSearch aliases（10-15 更名）', () => {
  it('emby 别名保留旧词「媒体库」并新增「资料库/资料库来源」', () => {
    const emby = SETTINGS_SEARCH_ALIASES.emby;
    expect(emby).toContain('jellyfin');
    expect(emby).toContain('媒体库');
    expect(emby).toContain('资料库');
    expect(emby).toContain('资料库来源');
    expect(emby).toContain('入库状态');
  });

  it('资料库/资料库来源/媒体库 三词 expand 均可达 emby', () => {
    for (const q of ['资料库', '资料库来源', '媒体库']) {
      expect(expandSettingsSearchQuery(q)).toContain('emby');
    }
  });
});
