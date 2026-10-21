/**
 * @file settingsDelta.ts
 * @description settings 存储分节 delta 并发安全写原语（S1-3）
 *
 * 背景：「函数入口读 settings → await 长网络段 → 整对象写回」的读-改-写模式，
 * 会覆盖网络段内其他上下文并发落盘的写入（用户保存设置、webdav 身份补写、
 * 115 用户信息刷新等）；且写回的是合并默认值后的整份实例，会把全量
 * DEFAULT_SETTINGS 推进存储 blob。
 *
 * 本原语收敛窗口：写前紧贴重读原始存储值（不合并默认值），只在其上合并
 * 自身节的 delta 写回；原始读不可用（未提供 / 抛错）时回退旧行为
 * （getMergedSettings 或 staleBase 整对象写回），保证可用性。
 */

export type SettingsRawRead = () => Promise<Partial<Record<string, any>> | null | undefined>;

export interface SettingsDeltaWriter {
  /** settings 存储原始值读取（不合并默认值）。提供后写回基于最新原始值。 */
  readRawSettings?: SettingsRawRead;
  /** 原始读不可用时的回退读取（通常是 merged 视图）。未提供时退回 staleBase。 */
  getMergedSettings?: () => Promise<Record<string, any> | null | undefined>;
  saveSettings: (settings: any) => Promise<void>;
}

/**
 * 读取 settings 原始存储值；读取器未提供或抛错时返回 undefined（由调用方回退旧行为）。
 */
export async function readRawSettingsOrUndefined(reader?: SettingsRawRead): Promise<Record<string, any> | undefined> {
  if (typeof reader !== 'function') return undefined;
  try {
    const raw = await reader();
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  } catch {
    // 原始读失败时退回旧路径（merged 视图 / staleBase），保证可用性
    return undefined;
  }
}

/**
 * 并发安全地写入 settings 的单个节（如 drive115 / webdav）：
 * - 写前紧贴重读原始值，把读-改-写窗口压缩到 buildDelta 同步段 + saveSettings；
 * - 只把 delta 合并到最新值的对应节上写回，不覆盖并发写入的其他节；
 * - 原始读不可用时按 getMergedSettings → staleBase 的顺序回退旧行为。
 *
 * @returns 实际写回的 settings 对象
 */
export async function saveSettingsSectionDelta(
  writer: SettingsDeltaWriter,
  staleBase: any,
  section: string,
  buildDelta: (latestSection: Record<string, any>) => Record<string, any>,
): Promise<Record<string, any>> {
  const latestRaw = await readRawSettingsOrUndefined(writer.readRawSettings);
  let base: Record<string, any>;
  if (latestRaw !== undefined) {
    base = { ...latestRaw };
  } else if (typeof writer.getMergedSettings === 'function') {
    let merged: Record<string, any> | null | undefined = null;
    try {
      merged = await writer.getMergedSettings();
    } catch {
      merged = null;
    }
    base = { ...((merged && typeof merged === 'object' && !Array.isArray(merged)) ? merged : (staleBase || {})) };
  } else {
    base = { ...((staleBase && typeof staleBase === 'object' && !Array.isArray(staleBase)) ? staleBase : {}) };
  }
  const latestSection = base[section] && typeof base[section] === 'object' && !Array.isArray(base[section])
    ? (base[section] as Record<string, any>)
    : {};
  base[section] = { ...latestSection, ...buildDelta(latestSection) };
  await writer.saveSettings(base);
  return base;
}

/**
 * 并发安全地写入 settings 的指定顶层键（与 saveSettingsSectionDelta 同族，10-21 预批）：
 * - 写前紧贴重读原始值，把读-改-写窗口压缩到 buildDelta 同步段 + saveSettings；
 * - buildDelta 按 keys 从最新值收集 latestTopLevel（缺失键不收集）做条件合并；
 * - 只把 buildDelta 返回中属于 keys 的键合并到最新值上写回，不覆盖并发写入的其他顶层键/节；
 * - buildDelta 返回 keys 之外的键一律忽略（keys 即本次写的授权面）；
 * - 原始读不可用时按 getMergedSettings → staleBase 的顺序回退旧行为。
 *
 * @param keys 本次写负责的顶层键集合
 * @returns 实际写回的 settings 对象
 */
export async function saveSettingsTopLevelDelta(
  writer: SettingsDeltaWriter,
  staleBase: any,
  keys: readonly string[],
  buildDelta: (latestTopLevel: Record<string, any>) => Record<string, any>,
): Promise<Record<string, any>> {
  const latestRaw = await readRawSettingsOrUndefined(writer.readRawSettings);
  let base: Record<string, any>;
  if (latestRaw !== undefined) {
    base = { ...latestRaw };
  } else if (typeof writer.getMergedSettings === 'function') {
    let merged: Record<string, any> | null | undefined = null;
    try {
      merged = await writer.getMergedSettings();
    } catch {
      merged = null;
    }
    base = { ...((merged && typeof merged === 'object' && !Array.isArray(merged)) ? merged : (staleBase || {})) };
  } else {
    base = { ...((staleBase && typeof staleBase === 'object' && !Array.isArray(staleBase)) ? staleBase : {}) };
  }
  const latestTopLevel: Record<string, any> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(base, key)) latestTopLevel[key] = base[key];
  }
  const delta = buildDelta(latestTopLevel);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(delta, key)) base[key] = delta[key];
  }
  await writer.saveSettings(base);
  return base;
}
