export interface HomeStatusData {
  byStatus?: {
    viewed?: number;
    browsed?: number;
    want?: number;
  };
}

export interface HomeStatusColors {
  success: string;
  info: string;
  warning: string;
}

export function buildHomeStatusData(
  stats: HomeStatusData | null | undefined,
  colors: HomeStatusColors,
  isDark: boolean,
): Array<{ name: string; value: number; color: string }> {
  return [
    { name: '已观看', value: stats?.byStatus?.viewed ?? 0, color: isDark ? '#4ade80' : colors.success },
    { name: '已浏览', value: stats?.byStatus?.browsed ?? 0, color: isDark ? '#2dd4bf' : colors.info },
    { name: '想看', value: stats?.byStatus?.want ?? 0, color: isDark ? '#fbbf24' : colors.warning },
  ];
}
