/**
 * @file displaySettingsModel.ts
 * @description 显示设置页纯数据模型：默认值、从 ExtensionSettings 映射
 * @module apps/dashboard/pages/settings/display
 */
import type { ExtensionSettings } from '../../../../../types';

/** 番号过滤（display.*） */
export type DisplayFilterState = {
  hideViewed: boolean;
  hideBrowsed: boolean;
  hideVR: boolean;
  hideWant: boolean;
};

/** 演员过滤（listEnhancement.*） */
export type ActorListFilterState = {
  hideBlacklistedActorsInList: boolean;
  hideNonFavoritedActorsInList: boolean;
  hideUnrecognizedActorsInList: boolean;
  treatSubscribedAsFavorited: boolean;
};

/**
 * 显示设置页完整表单状态。
 * enableActorPenetration 为只读提示位：仅用于驱动「演员穿透」提示条的
 * 条件渲染（未开启时提示用户可前往功能增强开启），不参与保存回写。
 */
export type DisplaySettingsFormState = DisplayFilterState & ActorListFilterState & {
  /** 只读：演员穿透是否已开启（listEnhancement.enableActorPenetration） */
  enableActorPenetration: boolean;
};

/**
 * 与遗留 DisplaySettings / DEFAULT_SETTINGS 对齐的默认值
 * - display.* 默认 false
 * - hideUnrecognizedActorsInList / treatSubscribedAsFavorited 默认 true
 */
export const DEFAULT_DISPLAY_SETTINGS_FORM: DisplaySettingsFormState = {
  hideViewed: false,
  hideBrowsed: false,
  hideVR: false,
  hideWant: false,
  hideBlacklistedActorsInList: false,
  hideNonFavoritedActorsInList: false,
  hideUnrecognizedActorsInList: true,
  treatSubscribedAsFavorited: true,
  enableActorPenetration: false,
};

/**
 * 从完整设置对象映射为表单状态（未定义字段走遗留默认）
 */
export function mapSettingsToDisplayForm(
  settings: Partial<ExtensionSettings> | null | undefined,
): DisplaySettingsFormState {
  const display = (settings?.display || {}) as Partial<DisplayFilterState>;
  const listEnhancement = (settings?.listEnhancement || {}) as Partial<ActorListFilterState>;

  return {
    hideViewed: !!display.hideViewed,
    hideBrowsed: !!display.hideBrowsed,
    hideVR: !!display.hideVR,
    hideWant: !!display.hideWant,
    hideBlacklistedActorsInList: !!listEnhancement.hideBlacklistedActorsInList,
    hideNonFavoritedActorsInList: !!listEnhancement.hideNonFavoritedActorsInList,
    // 默认 true（若未配置）
    hideUnrecognizedActorsInList: listEnhancement.hideUnrecognizedActorsInList !== false,
    treatSubscribedAsFavorited: listEnhancement.treatSubscribedAsFavorited !== false,
    enableActorPenetration: (listEnhancement as Record<string, unknown>).enableActorPenetration === true,
  };
}

/**
 * 将表单状态合并回 ExtensionSettings 片段（display + listEnhancement 相关字段）
 */
export function applyDisplayFormToSettings(
  current: ExtensionSettings,
  form: DisplaySettingsFormState,
): ExtensionSettings {
  const prevList = (current.listEnhancement || {}) as Record<string, unknown>;
  return {
    ...current,
    display: {
      ...(current.display || {}),
      hideViewed: form.hideViewed,
      hideBrowsed: form.hideBrowsed,
      hideVR: form.hideVR,
      hideWant: form.hideWant,
    },
    listEnhancement: {
      ...prevList,
      hideBlacklistedActorsInList: form.hideBlacklistedActorsInList,
      hideNonFavoritedActorsInList: form.hideNonFavoritedActorsInList,
      hideUnrecognizedActorsInList: form.hideUnrecognizedActorsInList,
      treatSubscribedAsFavorited: form.treatSubscribedAsFavorited,
    },
  };
}

/** 番号过滤字段元数据（稳定 id 与文案） */
export const DISPLAY_FILTER_FIELDS: {
  key: keyof DisplayFilterState;
  id: string;
  label: string;
}[] = [
  { key: 'hideViewed', id: 'hideViewed', label: '隐藏已标记"看过"的影片' },
  { key: 'hideBrowsed', id: 'hideBrowsed', label: '隐藏已浏览详情页的影片' },
  { key: 'hideVR', id: 'hideVR', label: '隐藏所有VR影片' },
  { key: 'hideWant', id: 'hideWant', label: '隐藏想看的影片' },
];

/** 演员过滤字段元数据 */
export const ACTOR_LIST_FILTER_FIELDS: {
  key: keyof ActorListFilterState;
  id: string;
  label: string;
}[] = [
  {
    key: 'hideBlacklistedActorsInList',
    id: 'hideBlacklistedActorsInList',
    label: '隐藏含黑名单演员的作品',
  },
  {
    key: 'hideNonFavoritedActorsInList',
    id: 'hideNonFavoritedActorsInList',
    label: '隐藏未收藏演员的作品（标题近似匹配）',
  },
  {
    key: 'hideUnrecognizedActorsInList',
    id: 'hideUnrecognizedActorsInList',
    label: '隐藏无法识别演员的作品（默认隐藏）',
  },
  {
    key: 'treatSubscribedAsFavorited',
    id: 'treatSubscribedAsFavorited',
    label: '订阅视为收藏',
  },
];
