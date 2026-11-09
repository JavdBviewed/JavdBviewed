/**
 * 隐私保护存储工具
 */

import { STORAGE_KEYS } from '../../../utils/config';
import { PrivacyState, SessionInfo } from '../../../types/privacy';
import { encryptData, decryptData, generateSecureId } from './crypto';

/**
 * 隐私状态存储管理器
 */
export class PrivacyStorage {
    private static instance: PrivacyStorage;
    private encryptionKey: string = '';
    private ready: Promise<void> | null = null;

    // 读取或清理失败后，本次页面生命周期不能借残留会话恢复认证。
    private sessionRecoveryBlocked = false;

    private constructor() {}

    public static getInstance(): PrivacyStorage {
        if (!PrivacyStorage.instance) {
            PrivacyStorage.instance = new PrivacyStorage();
        }
        return PrivacyStorage.instance;
    }

    /**
     * 初始化加密密钥
     */
    private async initializeEncryptionKey(): Promise<void> {
        const initialize = async () => {
            const stored: unknown = await this.getFromStorage('privacy_encryption_key');
            if (stored !== undefined && stored !== null) {
                if (typeof stored !== 'string' || !stored.length) throw new Error('Invalid local privacy key');
                this.encryptionKey = stored;
                return;
            }
            const key = generateSecureId();
            await this.setToStorage('privacy_encryption_key', key);
            // 只有持久化成功的密钥才可用于后续写入。
            this.encryptionKey = key;
        };
        if (typeof navigator !== 'undefined' && navigator.locks) {
            await navigator.locks.request('javdb-privacy-key', initialize);
        } else {
            await initialize();
        }
    }

    private async ensureReady(): Promise<void> {
        if (this.encryptionKey) return;
        if (!this.ready) {
            this.ready = this.initializeEncryptionKey().finally(() => { this.ready = null; });
        }
        await this.ready;
    }

    private decodeRuntime<T>(value: unknown, validate: (value: unknown) => value is T): T | null {
        if (typeof value !== 'string') return null;
        try {
            const parsed: unknown = JSON.parse(decryptData(value, this.encryptionKey));
            return validate(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    private async discardInvalidRuntime(includeState: boolean): Promise<void> {
        this.sessionRecoveryBlocked = true;
        // 先撤销会话。若删除失败，保留坏state，下一次启动仍能识别异常。
        try {
            await this.removeFromStorage(STORAGE_KEYS.PRIVACY_SESSION);
            if (includeState) await this.removeFromStorage(STORAGE_KEYS.PRIVACY_STATE);
        } catch {
            console.warn('[Privacy] Unreadable runtime data could not be removed; session recovery disabled.');
        }
    }

    /**
     * 存储隐私状态
     */
    async savePrivacyState(state: PrivacyState): Promise<void> {
        try {
            await this.ensureReady();
            const encrypted = encryptData(JSON.stringify(state), this.encryptionKey);
            await this.setToStorage(STORAGE_KEYS.PRIVACY_STATE, encrypted);
        } catch (error) {
            console.warn('[Privacy] Local privacy state could not be saved.');
            throw new Error('保存隐私状态失败');
        }
    }

    /**
     * 加载隐私状态
     */
    async loadPrivacyState(): Promise<PrivacyState | null> {
        let encrypted: unknown;
        try {
            await this.ensureReady();
            encrypted = await this.getFromStorage(STORAGE_KEYS.PRIVACY_STATE);
        } catch {
            this.sessionRecoveryBlocked = true;
            console.warn('[Privacy] Local privacy storage is unavailable; session recovery disabled.');
            return null;
        }
        if (encrypted === undefined || encrypted === null) return null;
        const state = this.decodeRuntime(encrypted, isPrivacyState);
        if (state) return state;
        console.warn('[Privacy] Unreadable local privacy state discarded; unlock again if private mode is enabled.');
        await this.discardInvalidRuntime(true);
        return null;
    }

    /** 存储本机解锁会话；退出时删除，不保存加密的null。 */
    async saveSessionInfo(session: SessionInfo | null): Promise<void> {
        try {
            if (session === null) {
                this.sessionRecoveryBlocked = true;
                await this.removeFromStorage(STORAGE_KEYS.PRIVACY_SESSION);
                return;
            }
            await this.ensureReady();
            if (!isSessionInfo(session)) throw new Error('Invalid session shape');
            const encrypted = encryptData(JSON.stringify(session), this.encryptionKey);
            await this.setToStorage(STORAGE_KEYS.PRIVACY_SESSION, encrypted);
            this.sessionRecoveryBlocked = false;
        } catch {
            throw new Error('保存隐私会话失败');
        }
    }

    async loadSessionInfo(): Promise<SessionInfo | null> {
        if (this.sessionRecoveryBlocked) return null;
        let encrypted: unknown;
        try {
            await this.ensureReady();
            encrypted = await this.getFromStorage(STORAGE_KEYS.PRIVACY_SESSION);
        } catch {
            this.sessionRecoveryBlocked = true;
            console.warn('[Privacy] Local session storage is unavailable; session recovery disabled.');
            return null;
        }
        if (encrypted === undefined || encrypted === null) return null;
        const session = this.decodeRuntime(encrypted, isSessionInfo);
        if (session) return session;
        console.warn('[Privacy] Unreadable local privacy session discarded.');
        await this.discardInvalidRuntime(false);
        return null;
    }

    /**
     * 清除隐私数据
     */
    async clearPrivacyData(): Promise<void> {
        try {
            await Promise.all([
                this.removeFromStorage(STORAGE_KEYS.PRIVACY_STATE),
                this.removeFromStorage(STORAGE_KEYS.PRIVACY_SESSION)
            ]);
        } catch (error) {
            console.error('Failed to clear privacy data:', error);
            throw new Error('清除隐私数据失败');
        }
    }

    /**
     * 存储敏感配置数据
     */
    async saveSensitiveConfig(key: string, data: any): Promise<void> {
        try {
            await this.ensureReady();
            const encrypted = encryptData(JSON.stringify(data), this.encryptionKey);
            await this.setToStorage(`privacy_config_${key}`, encrypted);
        } catch (error) {
            console.error('Failed to save sensitive config:', error);
            throw new Error('保存敏感配置失败');
        }
    }

    /**
     * 加载敏感配置数据
     */
    async loadSensitiveConfig<T>(key: string): Promise<T | null> {
        try {
            await this.ensureReady();
            const encrypted = await this.getFromStorage(`privacy_config_${key}`);
            if (!encrypted) {
                return null;
            }

            const decrypted = decryptData(encrypted, this.encryptionKey);
            if (!decrypted) {
                return null;
            }

            return JSON.parse(decrypted) as T;
        } catch (error) {
            console.error('Failed to load sensitive config:', error);
            return null;
        }
    }

    /**
     * 检查数据完整性
     */
    async verifyDataIntegrity(): Promise<boolean> {
        try {
            await this.ensureReady();
            const state = await this.loadPrivacyState();
            const session = await this.loadSessionInfo();
            
            // 简单的完整性检查
            if (state && typeof state.isBlurred !== 'boolean') {
                return false;
            }
            
            if (session && typeof session.startTime !== 'number') {
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Data integrity check failed:', error);
            return false;
        }
    }

    /**
     * 备份隐私数据
     */
    async backupPrivacyData(): Promise<string> {
        try {
            await this.ensureReady();
            const state = await this.loadPrivacyState();
            const session = await this.loadSessionInfo();
            
            const backup = {
                state,
                session,
                timestamp: Date.now(),
                version: '1.0'
            };
            
            return encryptData(JSON.stringify(backup), this.encryptionKey);
        } catch (error) {
            console.error('Failed to backup privacy data:', error);
            throw new Error('备份隐私数据失败');
        }
    }

    /**
     * 恢复隐私数据
     */
    async restorePrivacyData(backupData: string): Promise<void> {
        try {
            await this.ensureReady();
            const decrypted = decryptData(backupData, this.encryptionKey);
            if (!decrypted) {
                throw new Error('无法解密备份数据');
            }
            
            const backup = JSON.parse(decrypted);
            
            if (backup.state) {
                await this.savePrivacyState(backup.state);
            }
            
            if (backup.session) {
                await this.saveSessionInfo(backup.session);
            }
        } catch (error) {
            console.error('Failed to restore privacy data:', error);
            throw new Error('恢复隐私数据失败');
        }
    }

    /**
     * 基础存储操作 - 设置
     */
    private async setToStorage(key: string, value: any): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                if (typeof chrome !== 'undefined' && chrome.storage) {
                    chrome.storage.local.set({ [key]: value }, () => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve();
                        }
                    });
                } else {
                    // 降级到 localStorage
                    localStorage.setItem(key, JSON.stringify(value));
                    resolve();
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 基础存储操作 - 获取
     */
    private async getFromStorage(key: string): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                if (typeof chrome !== 'undefined' && chrome.storage) {
                    chrome.storage.local.get([key], (result) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            // 回调可能以 undefined 调用（storage 异常/SW 生命周期边缘），兜底避免回调内 throw 导致 Promise 挂死
                            resolve(result?.[key]);
                        }
                    });
                } else {
                    // 降级到 localStorage
                    const value = localStorage.getItem(key);
                    resolve(value ? JSON.parse(value) : null);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 基础存储操作 - 删除
     */
    private async removeFromStorage(key: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                if (typeof chrome !== 'undefined' && chrome.storage) {
                    chrome.storage.local.remove([key], () => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve();
                        }
                    });
                } else {
                    // 降级到 localStorage
                    localStorage.removeItem(key);
                    resolve();
                }
            } catch (error) {
                reject(error);
            }
        });
    }
}

/**
 * 获取隐私存储实例
 */
export function getPrivacyStorage(): PrivacyStorage {
    return PrivacyStorage.getInstance();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isNonnegativeFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function isPrivacyState(value: unknown): value is PrivacyState {
    return isRecord(value)
        && ['isBlurred', 'isLocked', 'isAuthenticated', 'temporaryViewActive'].every(key => typeof value[key] === 'boolean')
        && ['sessionStartTime', 'lastActivity', 'temporaryViewEndTime'].every(key => isNonnegativeFinite(value[key]));
}
function isSessionInfo(value: unknown): value is SessionInfo {
    return isRecord(value) && typeof value.isValid === 'boolean'
        && ['startTime', 'lastActivity', 'timeoutDuration', 'remainingTime'].every(key => isNonnegativeFinite(value[key]));
}
