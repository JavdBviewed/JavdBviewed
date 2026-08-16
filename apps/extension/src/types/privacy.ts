/**
 * 隐私保护功能相关类型定义
 */

// 隐私保护配置接口
export interface PrivacyConfig {
  // 截图模式配置
  screenshotMode: ScreenshotModeConfig;
  // 私密模式配置
  privateMode: PrivateModeConfig;
  // 密码恢复配置
  passwordRecovery: PasswordRecoveryConfig;
}

// 截图模式配置
export interface ScreenshotModeConfig {
  enabled: boolean;                    // 是否启用截图模式
  contentPages: ContentPagesScreenshotConfig; // 普通 JavDB/JavBus 内容页范围
  autoBlurTrigger: BlurTrigger;       // 自动模糊触发条件
  blurIntensity: number;              // 模糊强度 (1-10)
  protectedElements: string[];        // 需要保护的元素选择器
  blurAreas: BlurArea[];              // 启用的模糊区域
  showEyeIcon: boolean;               // 是否显示眼睛图标
  eyeIconPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  temporaryViewDuration: number;      // 临时查看持续时间(秒)
}

export interface ContentPagesScreenshotConfig {
  enabled: boolean;
  sites: {
    javdb: boolean;
    javbus: boolean;
  };
}

// 模糊区域类型
export type BlurArea = 'account-menu' | 'navigation' | 'video-library' | 'actor-library' | 'playlist-page' | 'lists-page' | 'home-page';

// 私密模式配置
export interface PrivateModeConfig {
  enabled: boolean;                   // 是否启用私密模式
  requirePassword: boolean;           // 是否需要密码验证
  passwordHash: string;               // 密码哈希值
  passwordSalt: string;               // 密码盐值
  sessionTimeout: number;             // 会话超时时间(分钟) - 已改为无操作超时
  idleTimeout?: number;               // 无操作超时时间(分钟) - 新增
  lastVerified: number;               // 上次验证时间戳
  lockOnTabLeave: boolean;            // 离开标签页时锁定
  lockOnExtensionClose: boolean;      // 关闭拓展时锁定
  restrictedFeatures: RestrictedFeature[]; // 受限功能列表
}

// 密码恢复配置
export interface PasswordRecoveryConfig {
  securityQuestions: SecurityQuestion[]; // 安全问题
  recoveryEmail: string;              // 恢复邮箱(可选)
  backupCode: string;                 // 备份恢复码
  backupCodeUsed: boolean;            // 备份码是否已使用
  lastRecoveryAttempt: number;        // 上次恢复尝试时间
  recoveryAttemptCount: number;       // 恢复尝试次数
}

// 自动模糊触发条件
export type BlurTrigger = 'tab-leave' | 'extension-reopen' | 'manual' | 'idle-timeout';

// 安全问题接口
export interface SecurityQuestion {
  id: string;
  question: string;
  answerHash: string;
  answerSalt: string;
}

// 受限功能枚举
export type RestrictedFeature =
  | 'data-sync'           // 数据同步
  | 'data-export'         // 数据导出
  | 'data-import'         // 数据导入
  | 'webdav-sync'         // WebDAV同步
  | 'actor-sync'          // 演员同步
  | 'drive115'            // 115网盘功能
  | 'search-engines'      // 搜索引擎
  | 'content-filter'      // 内容过滤
  | 'advanced-settings';  // 高级设置

// 隐私状态接口
export interface PrivacyState {
  isBlurred: boolean;                 // 当前是否模糊状态
  isLocked: boolean;                  // 当前是否锁定状态
  isAuthenticated: boolean;           // 当前是否已验证
  sessionStartTime: number;           // 会话开始时间
  lastActivity: number;               // 最后活动时间
  temporaryViewActive: boolean;       // 临时查看是否激活
  temporaryViewEndTime: number;       // 临时查看结束时间
}

// 密码验证结果
export interface PasswordVerificationResult {
  success: boolean;
  error?: string;
  remainingAttempts?: number;
  lockoutTime?: number;
}

// 密码恢复结果
export interface PasswordRecoveryResult {
  success: boolean;
  method: 'security-questions' | 'backup-code' | 'email' | 'data-reset';
  error?: string;
  newBackupCode?: string;
}

// 模糊效果配置
export interface BlurEffectConfig {
  intensity: number;                  // 模糊强度
  transition: boolean;                // 是否使用过渡效果
  transitionDuration: number;         // 过渡持续时间(ms)
  overlayColor: string;               // 遮罩颜色
  overlayOpacity: number;             // 遮罩透明度
}

// 隐私事件类型
export type PrivacyEventType =
  | 'blur-applied'        // 模糊已应用
  | 'blur-removed'        // 模糊已移除
  | 'locked'              // 已锁定
  | 'unlocked'            // 已解锁
  | 'authenticated'       // 已验证
  | 'session-expired'     // 会话过期
  | 'password-changed'    // 密码已更改
  | 'recovery-initiated'  // 恢复已启动
  | 'privateModeDisabled'; // 私密模式已禁用

// 隐私事件接口
export interface PrivacyEvent {
  type: PrivacyEventType;
  timestamp: number;
  data?: any;
}

// 隐私管理器接口
export interface IPrivacyManager {
  // 初始化
  initialize(): Promise<void>;

  // 截图模式
  enableScreenshotMode(): Promise<void>;
  disableScreenshotMode(): Promise<void>;
  toggleBlur(): Promise<void>;

  // 私密模式
  enablePrivateMode(): Promise<void>;
  disablePrivateMode(): Promise<void>;
  authenticate(password: string): Promise<PasswordVerificationResult>;
  lock(): Promise<void>;

  // 状态查询
  getState(): PrivacyState;
  isFeatureRestricted(feature: RestrictedFeature): Promise<boolean>;

  // 事件监听
  addEventListener(type: PrivacyEventType, listener: (event: PrivacyEvent) => void): void;
  removeEventListener(type: PrivacyEventType, listener: (event: PrivacyEvent) => void): void;
}

// 密码服务接口
export interface IPasswordService {
  hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }>;
  verifyPassword(password: string, hash: string, salt: string): Promise<boolean>;
  generateSalt(): string;
  generateBackupCode(): string;
  validatePasswordStrength(password: string): PasswordStrengthResult;
  // UI交互：设置/修改密码
  showSetPasswordDialog(): Promise<boolean>;
  showChangePasswordDialog(): Promise<boolean>;
}

// 密码强度结果
export interface PasswordStrengthResult {
  score: number;                      // 强度分数 (0-100)
  level: 'weak' | 'medium' | 'strong' | 'very-strong';
  suggestions: string[];              // 改进建议
  requirements: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumbers: boolean;
    hasSpecialChars: boolean;
  };
}

// 会话管理器接口
export interface ISessionManager {
  startSession(): Promise<void>;
  endSession(): Promise<void>;
  isSessionValid(): boolean;
  refreshSession(): Promise<void>;
  getSessionInfo(): SessionInfo;
}

// 会话信息
export interface SessionInfo {
  startTime: number;
  lastActivity: number;
  timeoutDuration: number;
  remainingTime: number;
  isValid: boolean;
}

// 模糊控制器接口
export interface IBlurController {
  applyBlur(elements?: string[]): Promise<void>;
  removeBlur(): Promise<void>;
  toggleBlur(): Promise<void>;
  isBlurred(): boolean;
  setBlurIntensity(intensity: number): void;
  showTemporaryView(duration?: number): Promise<void>;
}

// 恢复服务接口
export interface IRecoveryService {
  setupSecurityQuestions(questions: SecurityQuestion[]): Promise<void>;
  verifySecurityAnswers(answers: { id: string; answer: string }[]): Promise<boolean>;
  generateBackupCode(): Promise<string>;
  verifyBackupCode(code: string): Promise<boolean>;
  initiateEmailRecovery(email: string): Promise<void>;
  resetAllData(): Promise<void>;
}
