/**
 * @file classifyFolderEntries.test.ts
 * @description 文件夹文件分类单测
 * @module features/drive115/mediaLibrary
 */
import { describe, expect, it } from 'vitest';
import {
  classifyFileKind,
  classifyFolderEntries,
  pickPrimaryCover,
  pickPrimaryNfo,
  pickPrimaryVideo,
  rankNfoCandidates,
} from './classifyFolderEntries';

describe('classifyFolderEntries', () => {
  it('classifies by extension', () => {
    expect(classifyFileKind('a.mp4')).toBe('video');
    expect(classifyFileKind('poster.jpg')).toBe('cover');
    expect(classifyFileKind('movie.nfo')).toBe('nfo');
    expect(classifyFileKind('readme.txt')).toBe('other');
  });

  it('maps alternate 115 list fields for cover and nfo files', () => {
    const result = classifyFolderEntries([
      { file_category: '1', fileId: 'v1', fileName: '736DW-278.mp4', file_size: '1000', pickCode: 'video-pick' },
      { file_category: '1', id: 'c1', fileName: 'poster.jpg', size: '10', pickcode: 'cover-pick' },
      { file_category: '1', file_id: 'n1', file_name: '736DW-278.nfo', file_size: '2', pcd: 'nfo-pick' },
    ]);

    expect(result.videos[0]).toMatchObject({
      fileId: 'v1',
      fileName: '736DW-278.mp4',
      fileSize: 1000,
      pickCode: 'video-pick',
    });
    expect(result.covers[0]).toMatchObject({
      fileId: 'c1',
      pickCode: 'cover-pick',
    });
    expect(result.nfos[0]).toMatchObject({
      fileId: 'n1',
      pickCode: 'nfo-pick',
    });
  });

  it('skips folders and maps list fields', () => {
    const result = classifyFolderEntries([
      { fc: '0', cid: 'dir1', fn: 'ABC-123' },
      { fc: '1', fid: 'v1', fn: 'ABC-123.mp4', fs: 1000, pc: 'p1' },
      { fc: '1', fid: 'c1', fn: 'poster.jpg', fs: 10, pc: 'p2' },
      { fc: '1', fid: 'n1', fn: 'ABC-123.nfo', fs: 2, pc: 'p3' },
      { fc: '1', fid: 'o1', fn: 'sample.txt', fs: 1, pc: 'p4' },
    ]);
    expect(result.videos).toHaveLength(1);
    expect(result.covers).toHaveLength(1);
    expect(result.nfos).toHaveLength(1);
    expect(result.others).toHaveLength(1);
    expect(result.videos[0].pickCode).toBe('p1');
  });

  it('keeps metadata files when 115 only returns cid plus pick_code for file identity', () => {
    const result = classifyFolderEntries([
      { file_category: '1', fid: 'v1', fn: 'MAAN-879.mp4', fs: 1000, pc: 'video-pick' },
      { file_category: '1', cid: 'cover-cid', fn: 'poster.jpg', s: 10, pick_code: 'cover-pick' },
      { file_category: '1', cid: 'nfo-cid', fn: 'MAAN-879.nfo', s: 2, pick_code: 'nfo-pick' },
    ]);

    expect(result.videos[0]).toMatchObject({ fileId: 'v1', pickCode: 'video-pick' });
    expect(result.covers[0]).toMatchObject({ fileId: 'cover-cid', pickCode: 'cover-pick' });
    expect(result.nfos[0]).toMatchObject({ fileId: 'nfo-cid', pickCode: 'nfo-pick' });
  });
  it('picks largest video and poster-named cover', () => {
    const videos = [
      { fileId: '1', fileName: 'a.mp4', fileSize: 100, pickCode: 'a', kind: 'video' as const },
      { fileId: '2', fileName: 'b.mkv', fileSize: 900, pickCode: 'b', kind: 'video' as const },
    ];
    expect(pickPrimaryVideo(videos)?.fileId).toBe('2');

    const covers = [
      { fileId: '1', fileName: 'random.png', fileSize: 1, pickCode: 'x', kind: 'cover' as const },
      { fileId: '2', fileName: 'poster.jpg', fileSize: 1, pickCode: 'y', kind: 'cover' as const },
    ];
    expect(pickPrimaryCover(covers)?.fileId).toBe('2');
  });

  it('prefers nfo matching video basename', () => {
    const nfos = [
      { fileId: '1', fileName: 'other.nfo', fileSize: 1, pickCode: 'a', kind: 'nfo' as const },
      { fileId: '2', fileName: 'ABC-123.nfo', fileSize: 1, pickCode: 'b', kind: 'nfo' as const },
    ];
    expect(pickPrimaryNfo(nfos, 'ABC-123.mp4')?.fileId).toBe('2');
  });

  it('ranks code-named NFO before movie.nfo and keeps every candidate', () => {
    const nfos = [
      { fileId: 'movie', fileName: 'movie.nfo', fileSize: 1, pickCode: 'movie-pick', kind: 'nfo' as const },
      { fileId: 'code', fileName: 'MISM-304.nfo', fileSize: 1, pickCode: 'code-pick', kind: 'nfo' as const },
    ];

    expect(rankNfoCandidates(nfos, 'MISM-304', 'movie.mp4').map((nfo) => nfo.fileId)).toEqual([
      'code',
      'movie',
    ]);
  });
});
