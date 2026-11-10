import { expect, it } from 'vitest';
import { mergeMediaRecordMetadata } from './mediaMetadataMerge';
import type { VideoRecord } from '../../types';
const base: VideoRecord = { id: 'media:a', videoCode: 'ABC-123', title: '媒体名称', status: 'viewed', createdAt: 1, updatedAt: 2 };
it('fills descriptive fields while preserving personal state, manual fields, concurrent changes and absence', () => {
 const current = { ...base, title: '人工新标题', tags: ['人工分类'], notes: '刚改的备注', status: 'want' as const, isFavorite: true, manuallyEditedFields: ['tags'], mediaStateOverrides: { realWatched: false }, maker: '已知片商' };
 const next = mergeMediaRecordMetadata(current, base, { title: '站点标题', tags: ['站点分类'], actors: ['甲'], maker: '', duration: 60, javdbUrl: 'https://javdb.com/v/a' }, 50);
 expect(next).toMatchObject({ ...current, actors: ['甲'], duration: 60, javdbUrl: 'https://javdb.com/v/a', updatedAt: 50 });
 expect(mergeMediaRecordMetadata(base, base, { title: '站点标题' }, 50).title).toBe('站点标题');
});
it('does not revive tombstones or apply metadata after the code changed', () => {
 expect(() => mergeMediaRecordMetadata({ ...base, deletedAt: 10 }, base, { title: '站点' }, 50)).toThrow();
 expect(() => mergeMediaRecordMetadata({ ...base, videoCode: 'DEF-456' }, base, { title: '站点' }, 50)).toThrow();
});
