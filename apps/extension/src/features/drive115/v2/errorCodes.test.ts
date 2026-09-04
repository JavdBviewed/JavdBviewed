import { describe, expect, it } from 'vitest';
import { is115FileGoneResult } from './errorCodes';

describe('is115FileGoneResult', () => {
  it('treats 115 code 30001 as file-gone regardless of message', () => {
    expect(is115FileGoneResult({ state: false, code: 30001, message: 'xx' })).toBe(true);
    expect(is115FileGoneResult({ state: false, code: '30001' })).toBe(true);
    expect(is115FileGoneResult({ state: false, errNo: 30001 })).toBe(true);
  });

  it('treats server messages about the file being gone as file-gone', () => {
    expect(is115FileGoneResult({ state: false, code: 0, message: '文件不存在' })).toBe(true);
    expect(is115FileGoneResult({ state: false, message: '文件已删除' })).toBe(true);
    expect(is115FileGoneResult({ state: false, message: 'file not found' })).toBe(true);
  });

  it('does not treat unrelated failures as file-gone', () => {
    expect(is115FileGoneResult(undefined)).toBe(false);
    expect(is115FileGoneResult({})).toBe(false);
    expect(is115FileGoneResult({ state: false, message: '删除失败' })).toBe(false);
    // token 失效等凭证错误不能按"已删除"收敛，否则会吞掉真实故障
    expect(is115FileGoneResult({ state: false, code: 40140125, message: 'access_token 无效' })).toBe(false);
  });
});
