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


  it('filters noisy scraper text out of genres while keeping real tags', () => {
    const summary = parseNfoSummary(`
      <movie>
        <title>390JNT-076 IG豪放女。 爱菜</title>
        <num>390JNT-076</num>
        <year>2024</year>
        <premiered>2024-08-19</premiered>
        <runtime>100</runtime>
        <studio>Jackson</studio>
        <director>イ●スタやりたガール。</director>
        <set><name>イ●スタやりたガール。</name></set>
        <plot>在IG露出自豪身材照片的妹子，直接与她连络后，搭讪把妹到床上做爱的网路搭讪企划！千万别错过！</plot>
        <genre>业余</genre>
        <genre>美乳</genre>
        <genre>美腿</genre>
        <genre>系列: イ●スタやりたガール。</genre>
        <genre>片商: Jackson</genre>
        <genre>发行日期: 2024-08-19</genre>
        <genre>在IG露出自豪身材照片的妹子，直接与她连络后，搭讪把妹到床上做爱的网路搭讪企划！千万别错过！</genre>
        <genre>100</genre>
        <genre>poster.jpg</genre>
        <genre>fanart.jpg</genre>
        <actor><name>アイナ？歳.現役数学教師</name></actor>
      </movie>
    `);

    expect(summary?.title).toBe('390JNT-076 IG豪放女。 爱菜');
    expect(summary?.genres).toEqual(['业余', '美乳', '美腿']);
    expect(summary?.actors).toEqual(['アイナ？歳.現役数学教師']);
    expect(summary?.studio).toBe('Jackson');
    expect(summary?.series).toBe('イ●スタやりたガール。');
  });


  it('parses scraper-specific nfo fields without polluting genres', () => {
    const summary = parseNfoSummary(`
      <movie>
        <title><![CDATA[390JNT-076 IG\u8c6a\u653e\u5973\u3002 \u7231\u83dc]]></title>
        <originaltitle><![CDATA[390JNT-076 \u3010\u771f\u9762\u76ee\u305d\u3046\u306a\u5148\u751f\u306e\u30a8\u30c3\u30c1\u306a\u672c\u6027\u306f\u00b7\u00b7\u00b7\u3011\u73fe\u5f79\u6570\u5b66\u6559\u5e2b\uff01]]></originaltitle>
        <tagline>\u53d1\u884c\u65e5\u671f: 2024-08-19</tagline>
        <countrycode>JP</countrycode>
        <customrating>JP-18+</customrating>
        <mpaa>JP-18+</mpaa>
        <studio>Jackson</studio>
        <maker>Jackson</maker>
        <publisher>Janet</publisher>
        <label>Janet</label>
        <website>https://www.mgstage.com/product/product_detail/390JNT-076/</website>
        <cover>https://image.mgstage.com/images/jackson/390jnt/076/pb_e_390jnt-076.jpg</cover>
        <fanart>fanart.jpg</fanart>
        <ratings>
          <rating name="javdb" max="5" default="true">
            <value>4.3</value>
            <votes/>
          </rating>
        </ratings>
        <tag>\u4e1a\u4f59</tag>
        <tag>390JNT</tag>
        <tag>\u30a2\u30a4\u30ca\uff1f\u6b73.\u73fe\u5f79\u6570\u5b66\u6559\u5e2b</tag>
        <tag>\u53d1\u884c: Janet</tag>
        <genre>\u7f8e\u4e73</genre>
      </movie>
    `);

    expect(summary).toMatchObject({
      schemaVersion: 4,
      title: '390JNT-076 IG\u8c6a\u653e\u5973\u3002 \u7231\u83dc',
      countryCode: 'JP',
      contentRating: 'JP-18+',
      publisher: 'Janet',
      website: 'https://www.mgstage.com/product/product_detail/390JNT-076/',
      coverUrl: 'https://image.mgstage.com/images/jackson/390jnt/076/pb_e_390jnt-076.jpg',
      fanartRef: 'fanart.jpg',
      rating: '4.3',
    });
    expect(summary?.tagline).toBeUndefined();
    expect(summary?.genres).toEqual(['\u4e1a\u4f59', '\u7f8e\u4e73']);
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
