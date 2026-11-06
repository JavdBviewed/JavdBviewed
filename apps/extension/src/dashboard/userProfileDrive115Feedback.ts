export type Drive115FeedbackToastType = 'info' | 'success' | 'error' | 'warning';

export interface Drive115UserInfoFailureCopy {
  inlineStatus: string;
  inlineMessage: string;
  toastMessage: string;
  toastType: Drive115FeedbackToastType;
  action?: {
    hash: string;
    label: string;
  };
}

function isRefreshTokenFailure(message: string): boolean {
  return /refresh[_\s-]?token|40140120|refresh token error|重新授权|授权.*失效/i.test(message);
}

export function buildDrive115UserInfoFailureCopy(detail: string): Drive115UserInfoFailureCopy {
  const normalizedDetail = detail.trim() || '未知错误';

  if (isRefreshTokenFailure(normalizedDetail)) {
    return {
      inlineStatus: '授权需更新',
      inlineMessage: '115 登录状态已失效，已显示缓存或占位。请到 115 设置重新授权后再刷新。',
      toastMessage: '115 登录状态已失效，请到 115 设置重新授权后再刷新。',
      toastType: 'warning',
      action: {
        hash: '#tab-settings/drive-settings/115',
        label: '打开 115 设置',
      },
    };
  }

  return {
    inlineStatus: '获取失败',
    inlineMessage: '暂时无法更新 115 账号信息，已显示缓存或占位。',
    toastMessage: `115 账号信息刷新失败：${normalizedDetail}`,
    toastType: 'warning',
  };
}
