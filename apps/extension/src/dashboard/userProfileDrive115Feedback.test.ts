import { describe, expect, it } from 'vitest';
import { buildDrive115UserInfoFailureCopy } from './userProfileDrive115Feedback';

describe('drive115 user profile feedback copy', () => {
  it('turns refresh token validation failures into friendly inline and toast copy', () => {
    const feedback = buildDrive115UserInfoFailureCopy(
      '错误 40140120: refresh_token 检验失败（防篡改），建议：调用 /open/refreshToken 后 refresh_token 会更新，检查是否已更新本地值（服务端：refresh token error）'
    );

    expect(feedback.inlineStatus).toBe('授权需更新');
    expect(feedback.inlineMessage).toBe('115 登录状态已失效，已显示缓存或占位。请到 115 设置重新授权后再刷新。');
    expect(feedback.toastMessage).toBe('115 登录状态已失效，请到 115 设置重新授权后再刷新。');
    expect(feedback.toastType).toBe('warning');
    expect(feedback.action).toEqual({
      hash: '#tab-settings/drive-settings/115',
      label: '打开 115 设置',
    });
  });

  it('keeps generic failures concise inside the card and moves detail to toast', () => {
    const feedback = buildDrive115UserInfoFailureCopy('网络请求超时');

    expect(feedback.inlineStatus).toBe('获取失败');
    expect(feedback.inlineMessage).toBe('暂时无法更新 115 账号信息，已显示缓存或占位。');
    expect(feedback.toastMessage).toBe('115 账号信息刷新失败：网络请求超时');
    expect(feedback.toastType).toBe('warning');
    expect(feedback.action).toBeUndefined();
  });
});
