/**
 * 隐私保护验证工具
 */

import { PasswordVerificationResult, SecurityQuestion } from '../../../types/privacy';
import { verifyPassword, validatePasswordStrength } from './crypto';

/**
 * 密码验证管理器
 */
export class PasswordValidator {
    private static instance: PasswordValidator;
    private maxAttempts: number = 5;
    private lockoutDuration: number = 15 * 60 * 1000; // 15分钟
    private attemptCounts: Map<string, { count: number; lastAttempt: number }> = new Map();

    private constructor() {}

    public static getInstance(): PasswordValidator {
        if (!PasswordValidator.instance) {
            PasswordValidator.instance = new PasswordValidator();
        }
        return PasswordValidator.instance;
    }

    /**
     * 验证密码
     */
    async verifyPassword(password: string, hash: string, salt: string, identifier: string = 'default'): Promise<PasswordVerificationResult> {
        // 检查是否被锁定
        const lockoutInfo = this.checkLockout(identifier);
        if (lockoutInfo.isLocked) {
            return {
                success: false,
                error: `账户已被锁定，请在 ${Math.ceil(lockoutInfo.remainingTime / 60000)} 分钟后重试`,
                lockoutTime: lockoutInfo.remainingTime
            };
        }

        try {
            const isValid = await verifyPassword(password, hash, salt);
            
            if (isValid) {
                // 验证成功，清除尝试记录
                this.attemptCounts.delete(identifier);
                return { success: true };
            } else {
                // 验证失败，记录尝试次数
                this.recordFailedAttempt(identifier);
                const attempts = this.attemptCounts.get(identifier);
                const remainingAttempts = this.maxAttempts - (attempts?.count || 0);
                
                return {
                    success: false,
                    error: '密码错误',
                    remainingAttempts: Math.max(0, remainingAttempts)
                };
            }
        } catch (error) {
            console.error('Password verification error:', error);
            return {
                success: false,
                error: '验证过程中发生错误'
            };
        }
    }

    /**
     * 验证安全问题答案
     */
    async verifySecurityAnswers(
        questions: SecurityQuestion[], 
        answers: { id: string; answer: string }[]
    ): Promise<{ success: boolean; correctCount: number; requiredCount: number }> {
        const requiredCount = Math.min(2, questions.length); // 至少答对2个
        let correctCount = 0;

        for (const answer of answers) {
            const question = questions.find(q => q.id === answer.id);
            if (question) {
                try {
                    const isCorrect = await verifyPassword(
                        answer.answer.toLowerCase().trim(),
                        question.answerHash,
                        question.answerSalt
                    );
                    if (isCorrect) {
                        correctCount++;
                    }
                } catch (error) {
                    console.error('Security answer verification error:', error);
                }
            }
        }

        return {
            success: correctCount >= requiredCount,
            correctCount,
            requiredCount
        };
    }

    /**
     * 验证备份恢复码
     */
    async verifyBackupCode(inputCode: string, storedCode: string): Promise<boolean> {
        // 移除空格和连字符，转换为大写进行比较
        const normalizedInput = inputCode.replace(/[\s-]/g, '').toUpperCase();
        const normalizedStored = storedCode.replace(/[\s-]/g, '').toUpperCase();
        
        return normalizedInput === normalizedStored;
    }

    /**
     * 检查密码强度
     */
    checkPasswordStrength(password: string) {
        return validatePasswordStrength(password);
    }

    /**
     * 检查是否被锁定
     */
    private checkLockout(identifier: string): { isLocked: boolean; remainingTime: number } {
        const attempts = this.attemptCounts.get(identifier);
        if (!attempts || attempts.count < this.maxAttempts) {
            return { isLocked: false, remainingTime: 0 };
        }

        const timeSinceLastAttempt = Date.now() - attempts.lastAttempt;
        if (timeSinceLastAttempt >= this.lockoutDuration) {
            // 锁定期已过，清除记录
            this.attemptCounts.delete(identifier);
            return { isLocked: false, remainingTime: 0 };
        }

        return {
            isLocked: true,
            remainingTime: this.lockoutDuration - timeSinceLastAttempt
        };
    }

    /**
     * 记录失败尝试
     */
    private recordFailedAttempt(identifier: string): void {
        const current = this.attemptCounts.get(identifier) || { count: 0, lastAttempt: 0 };
        this.attemptCounts.set(identifier, {
            count: current.count + 1,
            lastAttempt: Date.now()
        });
    }

    /**
     * 重置尝试计数
     */
    resetAttempts(identifier: string = 'default'): void {
        this.attemptCounts.delete(identifier);
    }

    /**
     * 获取剩余尝试次数
     */
    getRemainingAttempts(identifier: string = 'default'): number {
        const attempts = this.attemptCounts.get(identifier);
        return this.maxAttempts - (attempts?.count || 0);
    }

    /**
     * 设置最大尝试次数
     */
    setMaxAttempts(maxAttempts: number): void {
        this.maxAttempts = Math.max(1, maxAttempts);
    }

    /**
     * 设置锁定持续时间
     */
    setLockoutDuration(duration: number): void {
        this.lockoutDuration = Math.max(60000, duration); // 最少1分钟
    }
}

/**
 * 会话验证器
 */
export class SessionValidator {
    /**
     * 验证会话是否有效
     */
    static isSessionValid(sessionInfo: any, timeoutMinutes: number): boolean {
        if (!sessionInfo || sessionInfo.isValid !== true || typeof sessionInfo.startTime !== 'number' || !Number.isFinite(sessionInfo.startTime)) {
            return false;
        }

        const now = Date.now();
        const sessionAge = now - sessionInfo.startTime;
        const maxAge = timeoutMinutes * 60 * 1000;

        return sessionAge >= 0 && sessionAge < maxAge;
    }

    /**
     * 验证最后活动时间
     */
    static isActivityRecent(lastActivity: number, maxIdleMinutes: number): boolean {
        const now = Date.now();
        const idleTime = now - lastActivity;
        const maxIdleTime = maxIdleMinutes * 60 * 1000;

        return idleTime < maxIdleTime;
    }

    /**
     * 计算会话剩余时间
     */
    static getSessionRemainingTime(sessionInfo: any, timeoutMinutes: number): number {
        if (!sessionInfo || sessionInfo.isValid !== true || typeof sessionInfo.startTime !== 'number' || !Number.isFinite(sessionInfo.startTime)) {
            return 0;
        }

        const now = Date.now();
        const sessionAge = now - sessionInfo.startTime;
        const maxAge = timeoutMinutes * 60 * 1000;

        return Math.max(0, maxAge - sessionAge);
    }
}

/**
 * 输入验证器
 */
export class InputValidator {
    /**
     * 验证邮箱格式
     */
    static isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * 验证恢复码格式
     */
    static isValidBackupCode(code: string): boolean {
        // 移除空格和连字符后应该是16位字母数字
        const normalized = code.replace(/[\s-]/g, '');
        return /^[A-Z0-9]{16}$/i.test(normalized);
    }

    /**
     * 清理和验证安全问题答案
     */
    static sanitizeSecurityAnswer(answer: string): string {
        return answer.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * 验证安全问题
     */
    static isValidSecurityQuestion(question: string): boolean {
        return question.trim().length > 0;
    }

    /**
     * 验证安全问题答案
     */
    static isValidSecurityAnswer(answer: string): boolean {
        const sanitized = this.sanitizeSecurityAnswer(answer);
        return sanitized.length > 0;
    }
}

/**
 * 获取密码验证器实例
 */
export function getPasswordValidator(): PasswordValidator {
    return PasswordValidator.getInstance();
}
