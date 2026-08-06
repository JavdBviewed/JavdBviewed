import { showMessage } from './ui/toast';
import { logAsync } from './logger';
import type { VideoRecord, OldVideoRecord, VideoStatus } from '../types';
import { showConfirm } from './components/confirmModal';
import { sendRuntimeMessage } from '../platform/browser/runtimeMessages';

/**
 * 检测备份数据的版本
 */
function detectBackupVersion(data: any): 'v1' | 'v2' | 'unknown' {
  if (!data || typeof data !== 'object') return 'unknown';
  
  // v2 格式特征：有 version 字段或包含 data/actorRecords 等结构化字段
  if (data.version || data.timestamp || (data.data && typeof data.data === 'object')) {
    return 'v2';
  }
  
  // v1 格式特征：直接是记录对象，或者有 viewed/browsed 等旧字段
  if (data.viewed || data.browsed || data.want) {
    return 'v1';
  }
  
  // 检查第一个记录的结构
  const firstRecord = Object.values(data)[0];
  if (firstRecord && typeof firstRecord === 'object') {
    const rec = firstRecord as any;
    // 旧版特征：status 是 'viewed'/'unviewed'，没有 createdAt/updatedAt
    if ((rec.status === 'viewed' || rec.status === 'unviewed') && !rec.createdAt) {
      return 'v1';
    }
    // 新版特征：有 createdAt/updatedAt
    if (rec.createdAt || rec.updatedAt) {
      return 'v2';
    }
  }
  
  return 'unknown';
}

/**
 * 迁移单条旧版记录到新版格式
 */
function migrateRecord(record: OldVideoRecord | VideoRecord): VideoRecord {
  const now = Date.now();
  
  // 如果已经是新版格式，直接返回
  if ((record as VideoRecord).createdAt && (record as VideoRecord).updatedAt) {
    return record as VideoRecord;
  }
  
  // 转换旧版 status
  let status: VideoStatus = 'browsed';
  if ((record as any).status === 'viewed') {
    status = 'viewed';
  } else if ((record as any).status === 'want') {
    status = 'want';
  } else if ((record as any).status === 'unviewed') {
    status = 'browsed'; // 旧版的 unviewed 对应新版的 browsed
  }

  // 使用扩展运算符保留所有原有字段（包括未来可能添加的字段）
  const base: Partial<VideoRecord> = {
    ...(record as any), // 保留所有原有字段
    // 覆盖必需的字段
    id: record.id,
    title: (record as any).title || record.id,
    status,
    tags: (record as any).tags || [],
    listIds: (record as any).listIds || [],
    createdAt: (record as any).createdAt || now,
    updatedAt: now,
    // 以下字段如果存在则保留，不存在则为 undefined（会被过滤）
    releaseDate: (record as any).releaseDate,
    javdbUrl: (record as any).javdbUrl,
    javdbImage: (record as any).javdbImage,
    enhancedData: (record as any).enhancedData,
  };
  
  return base as VideoRecord;
}

/**
 * 迁移旧版备份数据到新版格式
 */
function migrateBackupData(oldData: any): any {
  const version = detectBackupVersion(oldData);
  
  logAsync('INFO', '检测到备份数据版本', { version });
  
  if (version === 'v2') {
    // 已经是新版格式，直接返回
    return oldData;
  }
  
  if (version === 'v1') {
    // 旧版格式迁移
    const migratedData: any = {
      version: '2.1',
      timestamp: new Date().toISOString(),
      data: {},
      actorRecords: oldData.actorRecords || {},
      settings: oldData.settings,
      userProfile: oldData.userProfile,
      logs: oldData.logs || [],
      importStats: oldData.importStats,
      newWorks: oldData.newWorks || {}
    };
    
    // 迁移视频记录
    const recordsSource = oldData.data || oldData.viewed || oldData;
    if (recordsSource && typeof recordsSource === 'object') {
      const migratedRecords: Record<string, VideoRecord> = {};
      
      for (const [id, record] of Object.entries(recordsSource)) {
        if (record && typeof record === 'object') {
          migratedRecords[id] = migrateRecord(record as any);
        }
      }
      
      migratedData.data = migratedRecords;
      logAsync('INFO', '已迁移视频记录', { count: Object.keys(migratedRecords).length });
    }
    
    // 合并 browsed 和 want 列表（如果存在）
    if (oldData.browsed && typeof oldData.browsed === 'object') {
      for (const [id, record] of Object.entries(oldData.browsed)) {
        if (record && typeof record === 'object' && !migratedData.data[id]) {
          const migrated = migrateRecord(record as any);
          migrated.status = 'browsed';
          migratedData.data[id] = migrated;
        }
      }
    }
    
    if (oldData.want && typeof oldData.want === 'object') {
      for (const [id, record] of Object.entries(oldData.want)) {
        if (record && typeof record === 'object' && !migratedData.data[id]) {
          const migrated = migrateRecord(record as any);
          migrated.status = 'want';
          migratedData.data[id] = migrated;
        }
      }
    }
    
    return migratedData;
  }
  
  // 未知格式，尝试原样返回
  logAsync('WARN', '无法识别备份数据版本，尝试原样导入');
  return oldData;
}

export function handleFileRestoreClick(file: { name: string; path: string }) {
  showMessage('WebDAV 恢复暂时不可用（正在修复中）', 'warn');
  logAsync('WARN', 'WebDAV restore temporarily disabled (stub)', { file });
}

export async function applyTampermonkeyData(jsonData: string, mode: 'merge' | 'overwrite'): Promise<void> {
  try {
    JSON.parse(jsonData);
  } catch (e: any) {
    showMessage(`JSON 解析失败：${e?.message || e}`, 'error');
    await logAsync('ERROR', 'TM json parse failed (stub)', { error: e?.message || String(e) });
    return;
  }
  showMessage(`已接收 Tampermonkey 数据（${mode}），暂不执行写入（临时存根）`, 'info');
  await logAsync('INFO', 'TM data received (stub)', { mode });
}

export async function applyImportedData(
  jsonData: string,
  importType: 'data' | 'settings' | 'all' = 'all',
  mode: 'merge' | 'overwrite' = 'merge'
): Promise<void> {
  try {
    let importData = JSON.parse(jsonData);
    
    // 检测并迁移旧版数据格式
    const version = detectBackupVersion(importData);
    if (version === 'v1') {
      showMessage('检测到旧版本备份数据，正在自动迁移...', 'info');
      await logAsync('INFO', '开始迁移旧版本备份数据');
      importData = migrateBackupData(importData);
      showMessage('✓ 旧版本数据迁移成功', 'success');
    }

    const request = buildImportRestoreRequest(importData, importType, mode);
    const response = await sendRuntimeMessage<ImportRestoreResponse>(request);
    if (!response?.success) throw new Error(response?.error || '导入失败');

    const issues = getImportResponseIssues(response);
    if (issues.errors.length > 0) {
      throw new Error(`部分数据恢复失败：${issues.errors.join('；')}`);
    }
    const categories = response.summary?.categories || {};
    const written = Object.values(categories).reduce(
      (total, item) => total + Number(item?.written || item?.added || item?.updated || 0),
      0,
    );
    const message = issues.missing.length > 0
      ? `导入完成，已处理 ${written} 条数据；未找到：${issues.missing.join('、')}`
      : `导入成功，已处理 ${written} 条数据`;
    showMessage(message, issues.missing.length > 0 ? 'warn' : 'success');
    await logAsync('INFO', '本地备份导入完成', { importType, mode, detectedVersion: version, categories });
  } catch (e: any) {
    showMessage(`解析导入数据失败：${e?.message || e}`, 'error');
    await logAsync('ERROR', '本地备份导入失败', { error: e?.message || String(e) });
  }
}

export function buildImportRestoreRequest(
  importData: unknown,
  importType: 'data' | 'settings' | 'all',
  mode: 'merge' | 'overwrite',
): { type: 'restore-from-json'; jsonData: string; categories: Record<string, boolean>; categoryModes: Record<string, 'merge' | 'replace'> } {
  const allCategories = ['settings', 'userProfile', 'viewed', 'actors', 'newWorks', 'lists', 'magnets', 'logs', 'magnetPushLogs', 'importStats'];
  const categories = Object.fromEntries(allCategories.map((category) => [category, false]));
  const selectedCategories = importType === 'settings'
    ? ['settings']
    : importType === 'data'
      ? ['userProfile', 'viewed', 'actors', 'newWorks', 'lists', 'magnets', 'logs', 'magnetPushLogs', 'importStats']
      : ['settings', 'userProfile', 'viewed', 'actors', 'newWorks', 'lists', 'magnets', 'logs', 'magnetPushLogs', 'importStats'];
  selectedCategories.forEach((category) => { categories[category] = true; });
  const categoryModes = Object.fromEntries(
    selectedCategories.map((category) => [category, category === 'settings' ? 'replace' : mode === 'overwrite' ? 'replace' : 'merge']),
  ) as Record<string, 'merge' | 'replace'>;

  return {
    type: 'restore-from-json',
    jsonData: JSON.stringify(importData),
    categories,
    categoryModes,
  };
}

export interface ImportRestoreResponse {
  success?: boolean;
  error?: string;
  summary?: {
    categories?: Record<string, {
      written?: number;
      added?: number;
      updated?: number;
      reason?: 'missing' | 'error';
      error?: string;
    }>;
  };
}

export function getImportResponseIssues(response: ImportRestoreResponse): { errors: string[]; missing: string[] } {
  const categories = response.summary?.categories || {};
  const errors: string[] = [];
  const missing: string[] = [];
  for (const [category, result] of Object.entries(categories)) {
    if (result.reason === 'error') errors.push(`${category}：${result.error || '未知错误'}`);
    if (result.reason === 'missing') missing.push(category);
  }
  return { errors, missing };
}

export function initModal(): void {
  // 暂无操作（存根）
}

export function showImportModal(jsonData: string): void {
  // 解析并预览备份信息
  let importData: any;
  try {
    importData = JSON.parse(jsonData);
  } catch (e: any) {
    showMessage(`JSON 解析失败：${e?.message}`, 'error');
    return;
  }

  const extVersion = importData?.extensionVersion ? `v${importData.extensionVersion}` : '未知';
  const timestamp = importData?.timestamp ? new Date(importData.timestamp).toLocaleString('zh-CN') : '未知';
  const viewedCount = Array.isArray(importData?.idb?.viewedRecords)
    ? importData.idb.viewedRecords.length
    : Object.keys(importData?.data || {}).length;
  const actorCount = Array.isArray(importData?.idb?.actors)
    ? importData.idb.actors.length
    : Object.keys(importData?.actorRecords || {}).length;

  const message = `即将导入本地备份文件，此操作将覆盖当前数据，无法撤销。\n\n备份信息：\n• 扩展版本：${extVersion}\n• 备份时间：${timestamp}\n• 观看记录：${viewedCount} 条\n• 演员库：${actorCount} 条\n\n确认导入？`;

  showConfirm({ title: '导入本地备份', message, confirmText: '确认导入', cancelText: '取消' }).then((confirmed) => {
    if (!confirmed) return;

    showMessage('正在导入数据，请稍候...', 'info');
    logAsync('INFO', '用户确认导入本地备份', { viewedCount, actorCount });

    const request = buildImportRestoreRequest(importData, 'all', 'overwrite');
    sendRuntimeMessage<ImportRestoreResponse>(request).then((response) => {
      const issues = getImportResponseIssues(response);
      if (issues.errors.length > 0) {
        showMessage(`导入失败：${issues.errors.join('；')}`, 'error');
        logAsync('ERROR', '本地备份导入部分失败', { errors: issues.errors, summary: response?.summary });
        return;
      }
      if (response?.success) {
        const s = response.summary?.categories || {};
        const viewedWritten = s.viewed?.written ?? 0;
        const actorsWritten = s.actors?.written ?? 0;
        const missingText = issues.missing.length > 0 ? `；未找到：${issues.missing.join('、')}` : '';
        showMessage(`导入完成：观看记录 ${viewedWritten} 条，演员库 ${actorsWritten} 条${missingText}`, issues.missing.length > 0 ? 'warn' : 'success');
        logAsync('INFO', '本地备份导入成功', response.summary);
        // 刷新页面以加载新数据
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showMessage(`导入失败：${response?.error || '未知错误'}`, 'error');
        logAsync('ERROR', '本地备份导入失败', { error: response?.error });
      }
    }).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showMessage(`导入失败：${errorMessage}`, 'error');
      logAsync('ERROR', '本地备份导入失败', { error: errorMessage });
    });
  });
}
