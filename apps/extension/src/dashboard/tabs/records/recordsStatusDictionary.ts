/**
 * @file recordsStatusDictionary.ts
 * @description 10-24-records-state-dict：records 面统一状态字典（显示侧单一事实源）。
 *
 * 6 态 = 4 存储态（值复用 VIDEO_STATUS 原值，不新造值）+ 2 派生态
 * （值与 filterModel.MEDIA_STATE_SELECT_VALUES 同源：'inLibrary'/'realWatched'）。
 *
 * 纯模块零副作用：不读 storage、不触碰筛选/同步逻辑；仅被徽章渲染层与编辑弹窗消费。
 */
import { VIDEO_STATUS } from '../../../utils/config';
import { MEDIA_STATE_SELECT_VALUES } from './filterModel';
import type { MediaStateHit } from './mediaStateFilterModel';

export type RecordsStatusKind = 'stored' | 'derived';

export interface RecordsStatusEntry {
  value: string;
  /** 中文 label（与现有 UI 文案对齐，口径固定不得自创）。 */
  label: string;
  kind: RecordsStatusKind;
  /** 徽章/chip CSS 类（存储态=status-* 存量类，CSS 零波及；派生态=本线新增 chip 类）。 */
  badgeClass: string;
  hint: string;
}

const STORED_ENTRIES: readonly RecordsStatusEntry[] = [
  { value: VIDEO_STATUS.UNTRACKED, label: '未标记', kind: 'stored', badgeClass: `status-${VIDEO_STATUS.UNTRACKED}`, hint: '未做任何标记' },
  { value: VIDEO_STATUS.VIEWED, label: '已观看', kind: 'stored', badgeClass: `status-${VIDEO_STATUS.VIEWED}`, hint: '标记为已观看' },
  { value: VIDEO_STATUS.BROWSED, label: '已浏览', kind: 'stored', badgeClass: `status-${VIDEO_STATUS.BROWSED}`, hint: '标记为已浏览' },
  { value: VIDEO_STATUS.WANT, label: '想看', kind: 'stored', badgeClass: `status-${VIDEO_STATUS.WANT}`, hint: '计划观看' },
];

const DERIVED_ENTRIES: readonly RecordsStatusEntry[] = [
  {
    value: MEDIA_STATE_SELECT_VALUES[0],
    label: '已入库',
    kind: 'derived',
    badgeClass: 'media-state-chip-inlibrary',
    hint: '由资料库同步判定：已入库',
  },
  {
    value: MEDIA_STATE_SELECT_VALUES[1],
    label: '真实已看',
    kind: 'derived',
    badgeClass: 'media-state-chip-realwatched',
    hint: '由资料库同步判定：真实已看',
  },
];

/** 字典（6 态；顺序=编辑弹窗下拉顺序：4 存储态 + 2 派生态）。 */
export const RECORDS_STATUS_ENTRIES: readonly RecordsStatusEntry[] = [
  ...STORED_ENTRIES,
  ...DERIVED_ENTRIES,
];

export const STORED_STATUS_VALUES: readonly string[] = STORED_ENTRIES.map((entry) => entry.value);
export const DERIVED_STATUS_VALUES: readonly string[] = DERIVED_ENTRIES.map((entry) => entry.value);
export const ALL_STATUS_VALUES: readonly string[] = RECORDS_STATUS_ENTRIES.map((entry) => entry.value);

const entryByValue = new Map<string, RecordsStatusEntry>(RECORDS_STATUS_ENTRIES.map((entry) => [entry.value, entry]));
const storedValueSet = new Set<string>(STORED_STATUS_VALUES);
const derivedValueSet = new Set<string>(DERIVED_STATUS_VALUES);

/** 徽章 label：字典内=中文 label；字典外（脏数据）=原值直出（旧行为零变化）。 */
export function labelOf(value: string | null | undefined): string {
  const entry = value == null ? undefined : entryByValue.get(String(value));
  return entry ? entry.label : String(value ?? '');
}

export function isStoredStatusValue(value: string | null | undefined): boolean {
  return value != null && storedValueSet.has(String(value));
}

export function isDerivedStatusValue(value: string | null | undefined): boolean {
  return value != null && derivedValueSet.has(String(value));
}

/** 人工钉住 chip 提示文案（10-27 pin）：与派生 hint 同构，label 不动（字典口径）。 */
const PINNED_HINT_IN_LIBRARY = '人工钉住：已入库（不随资料库同步变化）';
const PINNED_HINT_REAL_WATCHED = '人工钉住：真实已看（不随资料库同步变化）';

/**
 * 派生 chip 决策（纯函数）：realWatched 命中优先（双命中只出 realWatched 一个）；
 * 未命中/无 hit = null（不渲染）。
 * 10-27 pin：hit.pinned 对应维 = true（人工钉住）时 hint 换钉住文案，label/优先级不变。
 */
export function resolveMediaStateChip(hit: MediaStateHit | null | undefined): RecordsStatusEntry | null {
  if (!hit || typeof hit !== 'object') return null;
  if (hit.realWatched) {
    const entry = entryByValue.get(MEDIA_STATE_SELECT_VALUES[1]);
    if (!entry) return null;
    return hit.pinned?.realWatched === true ? { ...entry, hint: PINNED_HINT_REAL_WATCHED } : entry;
  }
  if (hit.inLibrary) {
    const entry = entryByValue.get(MEDIA_STATE_SELECT_VALUES[0]);
    if (!entry) return null;
    return hit.pinned?.inLibrary === true ? { ...entry, hint: PINNED_HINT_IN_LIBRARY } : entry;
  }
  return null;
}
