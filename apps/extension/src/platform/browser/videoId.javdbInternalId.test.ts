// @vitest-environment jsdom
/**
 * @file videoId.javdbInternalId.test.ts
 * @description JavDB 内置 ID 兜底提取测试（10-31-ext-javdb-internal-id R2）
 * @module platform/browser
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { extractVideoIdFromPage } from './videoId';

function setPath(pathname: string): void {
  window.history.replaceState(null, '', pathname);
}

function setTitle(rawText: string): void {
  document.body.innerHTML = `<h2 class="title is-4"><strong>${rawText}</strong></h2>`;
}

describe('videoId JavDB 内置 ID 兜底（R2）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('内置 ID 形态标题采纳原始大小写', () => {
    setPath('/v/0eaQAa');
    setTitle('yrnknkjdvaj-00743a');

    expect(extractVideoIdFromPage()).toBe('yrnknkjdvaj-00743a');
  });

  it('标准番号走严格路径不走兜底', () => {
    setPath('/v/abcd1234');
    setTitle('FTHTD-243');

    expect(extractVideoIdFromPage()).toBe('FTHTD-243');
  });

  it('多词垃圾标题仍落方法3（10-22 防回归）', () => {
    setPath('/v/0eaQAa');
    setTitle('常に乳頭つままれる 刺激を欲しがる マゾ');

    expect(extractVideoIdFromPage()).toBe('0eaQAa');
  });

  it('近似内置 ID 但超数字长度护栏不兜底，落方法3', () => {
    setPath('/v/x77Kp9');
    setTitle('abcdefgh-1234567890123');

    expect(extractVideoIdFromPage()).toBe('x77Kp9');
  });
});
