/**
 * @file newWorksCloudScanGuidanceRuntime.ts
 * @description 新作品页「云托管扫描引导」入口 runtime：
 * 纯函数显示判定 + 引导按钮显隐更新 + 点击幂等接线（一键跳设置页云扫描区块并高亮）。
 * @module dashboard/tabs
 *
 * 显示条件（零噪声）：云凭据已存（双非空）且云扫描未开启且两次读取均成功；
 * 其余一律隐藏（无凭据/已开启/读失败）。引导按钮不存在或任何异常均静默——
 * 引导失败不得影响新作品页本身。
 */
import { loadCloudSettings } from '../../features/cloudSync/cloudSettingsStorage';
import { newWorksManager } from '../../features/newWorks';

/** sessionStorage marker：点击引导按钮后置位，设置页云扫描区块 mount 后自动滚动+高亮并清除 */
export const NWS_GUIDANCE_FOCUS_KEY = 'nwcs_guidance_focus';

/** 引导按钮跳转的目标 hash（与 userProfile.ts drive115 跳设置同款 pattern） */
const CLOUD_SCAN_GUIDANCE_TARGET_HASH = '#tab-settings/new-works-settings';

/** 引导显示判定输入 */
export interface CloudScanGuidanceDecision {
  /** 云凭据已存（accountIdentifier 与 accountPassword 双非空） */
  hasCloudCredentials: boolean;
  /** 云扫描已开启（globalConfig.cloudScan.enabled === true） */
  cloudScanEnabled: boolean;
  /** 凭据与全局配置两次读取均未抛异常 */
  configLoadOk: boolean;
}

/**
 * 引导显示判定（纯函数，可单测）：
 * 仅当「凭据已存 且 云扫描未开启 且 读取成功」时显示，其余（无凭据/已开启/读失败）一律隐藏。
 */
export function shouldShowCloudScanGuidance(input: CloudScanGuidanceDecision): boolean {
  return input.configLoadOk && input.hasCloudCredentials && !input.cloudScanEnabled;
}

/** 已接线按钮集合（幂等：同一按钮只接一次 click） */
const wiredButtons = new WeakSet<object>();

/**
 * 读取判定所需状态；任一读取抛异常 → configLoadOk=false（隐藏，不抛出）。
 */
async function readGuidanceState(): Promise<CloudScanGuidanceDecision> {
  let hasCloudCredentials = false;
  let configLoadOk = true;
  try {
    const settings = await loadCloudSettings();
    hasCloudCredentials = Boolean(settings?.accountIdentifier && settings?.accountPassword);
  } catch {
    configLoadOk = false;
  }
  let cloudScanEnabled = false;
  try {
    const globalConfig = await newWorksManager.getGlobalConfig();
    cloudScanEnabled = globalConfig?.cloudScan?.enabled === true;
  } catch {
    configLoadOk = false;
  }
  return { hasCloudCredentials, cloudScanEnabled, configLoadOk };
}

/**
 * 更新引导按钮显隐。fire-and-forget 调用点：新作品页 render 完成路径。
 * - 引导按钮不存在（DOM 未渲染/后续变更）：静默返回，不触发读取；
 * - 任何异常：内部吞掉并隐藏，零噪声。
 */
export async function updateNewWorksCloudScanGuidance(): Promise<void> {
  try {
    const scope = globalThis as {
      document?: { getElementById(id: string): { hidden?: boolean; addEventListener?: (type: string, handler: () => void) => void } | null };
    };
    // 显隐目标 = 点击目标 = 同一节点（#enableCloudScanBtn）
    const button = scope.document?.getElementById('enableCloudScanBtn') ?? null;
    if (!button) return;

    const decision = await readGuidanceState();
    const visible = shouldShowCloudScanGuidance(decision);
    button.hidden = !visible;
    if (!visible) return;

    if (!button.addEventListener || wiredButtons.has(button)) return;
    wiredButtons.add(button);
    button.addEventListener('click', () => {
      const runtimeScope = globalThis as {
        sessionStorage?: { setItem(key: string, value: string): void };
        location?: { hash: string };
      };
      runtimeScope.sessionStorage?.setItem(NWS_GUIDANCE_FOCUS_KEY, '1');
      if (runtimeScope.location) {
        runtimeScope.location.hash = CLOUD_SCAN_GUIDANCE_TARGET_HASH;
      }
    });
  } catch {
    // 引导失败不得影响新作品页本身：静默吞掉
  }
}
