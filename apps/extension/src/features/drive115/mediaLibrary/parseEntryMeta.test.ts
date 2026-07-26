/**
 * @file parseEntryMeta.test.ts
 * @description 番号与 NFO 解析单测
 * @module features/drive115/mediaLibrary
 */
import { describe, expect, it } from 'vitest';
import {
  parseCodeFromName,
  parseNfoSummary,
  resolveEntryCode,
  resolveEntryTitle,
} from './parseEntryMeta';

describe('parseEntryMeta', () => {
  it('parses code from folder / file names', () => {
    expect(parseCodeFromName('SSIS-001')).toBe('SSIS-001');
    expect(parseCodeFromName('ssis_001.mp4')).toBe('SSIS-001');
    expect(parseCodeFromName('FC2-PPV-1234567')).toBe('FC2-PPV-1234567');
  });

  it('resolves code by priority folder > video > nfo', () => {
    expect(
      resolveEntryCode({
        folderName: 'SSIS-001 标题',
        videoFileName: 'OTHER-002.mp4',
        nfoFileName: 'OTHER-003.nfo',
      }),
    ).toEqual({ code: 'SSIS-001', source: 'folder' });

    expect(
      resolveEntryCode({
        folderName: '无番号目录',
        videoFileName: 'ABC-123.mp4',
      }),
    ).toEqual({ code: 'ABC-123', source: 'video' });

    expect(
      resolveEntryCode({
        folderName: 'misc',
        videoFileName: 'video.mp4',
        nfoFileName: 'IPX-999.nfo',
      }),
    ).toEqual({ code: 'IPX-999', source: 'nfo' });
  });

  it('parses minimal nfo xml', () => {
    const summary = parseNfoSummary(`
      <movie>
        <title>示例标题</title>
        <year>2024</year>
        <plot>简介内容</plot>
      </movie>
    `);
    expect(summary?.title).toBe('示例标题');
    expect(summary?.year).toBe('2024');
    expect(summary?.plot).toContain('简介');
  });

  it('parses rich jav nfo fields', () => {
    const summary = parseNfoSummary(`
      <movie>
        <title>ABP-123 完整标题</title>
        <originaltitle>ABP-123</originaltitle>
        <num>ABP-123</num>
        <year>2022</year>
        <premiered>2022-05-14</premiered>
        <runtime>120</runtime>
        <director>某导演</director>
        <studio>Prestige</studio>
        <maker>无视</maker>
        <rating>8.6</rating>
        <plot><![CDATA[这是简介]]></plot>
        <genre>単体作品</genre>
        <genre>ドラマ</genre>
        <tag>4K</tag>
        <actor><name>演员甲</name><role>主演</role></actor>
        <actor><name>演员乙</name></actor>
        <set><name>某系列</name></set>
        <poster>ABP-123-poster.jpg</poster>
      </movie>
    `);
    expect(summary?.num).toBe('ABP-123');
    expect(summary?.year).toBe('2022');
    expect(summary?.releaseDate).toBe('2022-05-14');
    expect(summary?.runtime).toBe('120');
    expect(summary?.director).toBe('某导演');
    expect(summary?.studio).toBe('Prestige');
    expect(summary?.rating).toBe('8.6');
    expect(summary?.plot).toBe('这是简介');
    expect(summary?.actors).toEqual(['演员甲', '演员乙']);
    expect(summary?.genres).toEqual(expect.arrayContaining(['単体作品', 'ドラマ', '4K']));
    expect(summary?.series).toBe('某系列');
    expect(summary?.posterRef).toBe('ABP-123-poster.jpg');
  });

  it('still returns minimal fields when rich tags absent', () => {
    const summary = parseNfoSummary('<movie><title>仅标题</title></movie>');
    expect(summary?.title).toBe('仅标题');
    expect(summary?.actors).toBeUndefined();
    expect(summary?.genres).toBeUndefined();
  });

  it('builds display title', () => {
    expect(resolveEntryTitle({ code: 'ABC-1', folderName: 'x' })).toBe('ABC-1');
    expect(resolveEntryTitle({ nfoTitle: 'NFO名', code: 'ABC-1' })).toBe('NFO名');
    expect(resolveEntryTitle({ folderName: 'folder' })).toBe('folder');
  });
});
