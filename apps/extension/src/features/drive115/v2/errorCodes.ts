/**
 * @file errorCodes.ts
 * @description errorCodes
 * @module features/drive115
 */
/*
 * 115 v2 开放平台错误码对照
 * 用途：在 UI/日志中友好展示错误含义与建议处理方式
 */

export interface Drive115ErrorInfo {
  code: number;
  desc: string;
  suggest?: string;
}

// 以 code 为 key 的错误映射
export const DRIVE115_ERROR_MAP: Record<number, Drive115ErrorInfo> = {
  40100000: { code: 40100000, desc: '参数缺失' },
  40101017: { code: 40101017, desc: '用户验证失败' },
  40110000: { code: 40110000, desc: '请求异常需要重试', suggest: '稍后重试' },
  40140100: { code: 40140100, desc: 'client_id 错误' },
  40140101: { code: 40140101, desc: 'code_challenge 必填' },
  40140102: { code: 40140102, desc: 'code_challenge_method 非法', suggest: '仅支持 sha256、sha1、md5' },
  40140103: { code: 40140103, desc: 'sign 必填' },
  40140104: { code: 40140104, desc: 'sign 签名失败' },
  40140105: { code: 40140105, desc: '生成二维码失败' },
  40140106: { code: 40140106, desc: 'APP ID 无效' },
  40140107: { code: 40140107, desc: '应用不存在' },
  40140108: { code: 40140108, desc: '应用未审核通过' },
  40140109: { code: 40140109, desc: '应用已被停用' },
  40140110: { code: 40140110, desc: '应用已过期' },
  40140111: { code: 40140111, desc: 'APP Secret 错误' },
  40140112: { code: 40140112, desc: 'code_verifier 长度不合法', suggest: '长度需 43~128 位' },
  40140113: { code: 40140113, desc: 'code_verifier 验证失败' },
  40140114: { code: 40140114, desc: 'refresh_token 格式错误（防篡改）' },
  40140115: { code: 40140115, desc: 'refresh_token 签名校验失败（防篡改）' },
  40140116: { code: 40140116, desc: 'refresh_token 无效（已解除授权）', suggest: '重新授权' },
  40140117: { code: 40140117, desc: 'access_token 刷新太频繁' },
  40140118: { code: 40140118, desc: '开发者认证已过期' },
  40140119: { code: 40140119, desc: 'refresh_token 已过期', suggest: '重新授权' },
  40140120: { code: 40140120, desc: 'refresh_token 检验失败（防篡改）', suggest: '调用 /open/refreshToken 后 refresh_token 会更新，检查是否已更新本地值' },
  40140121: { code: 40140121, desc: 'access_token 刷新失败', suggest: '重试' },
  40140122: { code: 40140122, desc: '超出授权应用个数上限' },
  40140123: { code: 40140123, desc: 'access_token 格式错误（防篡改）' },
  40140124: { code: 40140124, desc: 'access_token 签名校验失败（防篡改）' },
  40140125: { code: 40140125, desc: 'access_token 无效（已过期或者已解除授权）', suggest: '调用 /open/refreshToken 刷新 token' },
  40140126: { code: 40140126, desc: 'access_token 校验失败（防篡改）' },
  40140127: { code: 40140127, desc: 'response_type 错误' },
  40140128: { code: 40140128, desc: 'redirect_uri 缺少协议' },
  40140129: { code: 40140129, desc: 'redirect_uri 缺少域名' },
  40140130: { code: 40140130, desc: '没有配置重定向域名', suggest: '到应用管理中配置域名' },
  40140131: { code: 40140131, desc: 'redirect_uri 非法域名', suggest: '需与应用管理的配置一致' },
  40140132: { code: 40140132, desc: 'grant_type 错误' },
  40140133: { code: 40140133, desc: 'client_secret 验证失败' },
  40140134: { code: 40140134, desc: '授权码 code 验证失败' },
  40140135: { code: 40140135, desc: 'client_id 验证失败' },
  40140136: { code: 40140136, desc: 'redirect_uri 验证失败（防MITM）' },
};

/**
 * 获取错误信息
 */
export function get115ErrorInfo(code?: number | string): Drive115ErrorInfo | undefined {
  if (code === undefined || code === null) return undefined;
  const n = typeof code === 'string' ? Number(code) : code;
  if (!Number.isFinite(n)) return undefined;
  return DRIVE115_ERROR_MAP[n as number];
}

/**
 * 将错误对象（含 code/message 等）转为更友好的文本
 */
export function describe115Error(err: any): string | undefined {
  const code = Number(err?.code ?? err?.errNo ?? err?.errno ?? NaN);
  const info = Number.isFinite(code) ? get115ErrorInfo(code) : undefined;
  const fromServer = String(err?.message || err?.error || '').trim();
  if (info) {
    const sug = info.suggest ? `，建议：${info.suggest}` : '';
    return `错误 ${info.code}: ${info.desc}${sug}${fromServer ? `（服务端：${fromServer}）` : ''}`;
  }
  return fromServer || undefined;
}

/**
 * 常用判定：是否与 token 失效相关
 */
export function is115TokenInvalidCode(code?: number): boolean {
  if (!Number.isFinite(code)) return false;
  return [40140125, 40140126].includes(code as number) || (code as number) === 401 || (code as number) === 401001;
}

/**
 * 判定：refresh_token 是否永久失效（需要重新授权）
 */
export function is115RefreshTokenPermanentlyInvalidCode(code?: number): boolean {
  if (!Number.isFinite(code)) return false;
  // 40140114-40140116: refresh_token 格式/签名/授权问题
  // 40140119: refresh_token 已过期
  // 40140120: refresh_token 检验失败（可能是未更新本地值）
  return [40140114, 40140115, 40140116, 40140119, 40140120].includes(code as number);
}

/**
 * 判定：是否为刷新频率限制错误
 */
export function is115RefreshRateLimitCode(code?: number): boolean {
  if (!Number.isFinite(code)) return false;
  return code === 40140117; // access_token 刷新太频繁
}

/**
 * 判定：删除/文件操作失败响应是否表示「目标文件在 115 上已不存在」。
 * 用于「已看影片整理」删除的幂等收敛：文件若已被手动删除、或已被历史操作
 * 删掉（重复入队的脏记录），删除操作应按成功处理，避免记录卡在待处理永远失败。
 * 判定信号（任一命中）：
 * - 115 业务码 30001（文件/文件夹不存在的经典码）
 * - 服务端错误文案含「不存在 / 已删除 / 找不到」等（115 中文错误文案）
 */
export function is115FileGoneResult(err: any): boolean {
  const code = Number(err?.code ?? err?.errNo ?? err?.errno ?? NaN);
  if (Number.isFinite(code) && code === 30001) return true;
  const message = String(err?.message || err?.msg || err?.error || '').trim();
  if (!message) return false;
  return /文件不存在|文件已删除|已删除|不存在|找不到|not\s*found|no\s*such\s*file/i.test(message);
}
