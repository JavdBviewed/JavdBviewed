import { STATE } from '../../../../state';
import type { ExtensionSettings } from '../../../../../types';
import { getVideoDetailTaskBlueprints } from '../../../../../features/videoDetail';
import { getEffectiveEmbyMatchUrls } from '../../../../../features/embyEnhancement/domain/matchUrls';

export type OrchestratorDesignTask = {
  phase: 'critical' | 'high' | 'deferred' | 'idle';
  label: string;
  priority?: number;
  timeout?: number;
  visibilityPolicy?: string;
  source: 'video' | 'actor' | 'list' | 'global';
  enabled: boolean;
  dependsOn?: string[];
};

export function buildDesignTasks(doGetSettings: () => ExtensionSettings): OrchestratorDesignTask[] {
  const settings = (STATE.settings || doGetSettings() || {}) as ExtensionSettings & Record<string, any>;
  const tasks: OrchestratorDesignTask[] = [];
  const pushTask = (task: OrchestratorDesignTask) => tasks.push(task);

  const videoTasks: OrchestratorDesignTask[] = [
    { phase: 'idle', label: 'drive115:init:video', source: 'video', enabled: true },
    { phase: 'idle', label: 'insights:collector', source: 'video', enabled: true },
    ...getVideoDetailTaskBlueprints(settings).map((task) => ({
      phase: task.phase,
      label: task.label,
      priority: task.priority,
      timeout: task.timeout,
      visibilityPolicy: task.visibilityPolicy,
      source: 'video' as const,
      enabled: true,
      dependsOn: task.dependsOn,
    })),
  ];
  videoTasks.forEach(pushTask);

  if ((settings.videoEnhancement as any)?.enableActorQuickActions !== false) {
    pushTask({ phase: 'high', label: 'actorQuickActions:init', priority: 6, visibilityPolicy: 'background_allowed', source: 'video', enabled: true });
  }

  if (settings.userExperience?.enableKeyboardShortcuts) {
    pushTask({ phase: 'high', label: 'ux:shortcuts:init', priority: 8, source: 'global', enabled: true });
  }

  if ((settings.userExperience as any)?.enableSuperRanking !== false) {
    pushTask({ phase: 'critical', label: 'superRankingNav:init', priority: 9, visibilityPolicy: 'background_allowed', source: 'global', enabled: true });
  }

  pushTask({
    phase: 'high',
    label: 'ui:remove-unwanted',
    priority: 3,
    visibilityPolicy: 'background_allowed',
    source: 'global',
    enabled: true,
  });

  if (settings.userExperience?.enableMagnetSearch) {
    pushTask({ phase: 'idle', label: 'ux:magnet:autoSearch', source: 'global', enabled: true });
  }

  if (settings.userExperience?.enableAnchorOptimization) {
    pushTask({ phase: 'deferred', label: 'anchorOptimization:init', source: 'global', enabled: true });
  }

  if (settings.userExperience?.enablePasswordHelper) {
    pushTask({ phase: 'idle', label: 'passwordHelper:init', source: 'global', enabled: true });
  }

  if (settings.userExperience?.enableContentFilter) {
    pushTask({ phase: 'idle', label: 'contentFilter:initialize', source: 'global', enabled: true });
  }

  if ((settings.videoEnhancement as any)?.showLoadingIndicator !== false) {
    pushTask({ phase: 'critical', label: 'enhancementUI:showLoadingIndicator', priority: 13, visibilityPolicy: 'background_allowed', source: 'global', enabled: true });
  }

  if (settings.userExperience?.enableListEnhancement !== false) {
    pushTask({ phase: 'critical', label: 'list:observe:init', visibilityPolicy: 'background_allowed', source: 'list', enabled: true });
    pushTask({ phase: 'high', label: 'listEnhancement:init', priority: 7, visibilityPolicy: 'background_allowed', source: 'list', enabled: true });
    pushTask({ phase: 'idle', label: 'drive115:init:list', source: 'list', enabled: true });
  }

  const actorEnhancementEnabled = settings.userExperience?.enableActorEnhancement !== false;
  if (actorEnhancementEnabled) {
    pushTask({ phase: 'critical', label: 'actorEnhancement:init', visibilityPolicy: 'background_allowed', source: 'actor', enabled: true });
    pushTask({ phase: 'critical', label: 'actorEnhancement:actionButtons', priority: 9, visibilityPolicy: 'background_allowed', source: 'actor', enabled: (settings.actorEnhancement as any)?.enableActionButtons !== false });
  }

  const actorRemarksEnabled = (settings.videoEnhancement as any)?.enabled === true && (settings.videoEnhancement as any)?.enableActorRemarks === true;
  if (actorRemarksEnabled) {
    pushTask({ phase: 'idle', label: 'actorRemarks:actorPage', timeout: Number((settings.videoEnhancement as any)?.actorRemarksTaskTimeoutSeconds || 10) * 1000, source: 'actor', enabled: true });
  }

  const includeEmby = isDesignEmbyEnabled(settings);
  if (includeEmby) {
    pushTask({ phase: 'deferred', label: 'emby:badge', source: 'global', enabled: true });
  }

  const deduped = new Map<string, OrchestratorDesignTask>();
  tasks.forEach((task) => {
    const current = deduped.get(task.label);
    if (!current) {
      deduped.set(task.label, task);
      return;
    }
    const currentPriority = current.priority ?? 5;
    const nextPriority = task.priority ?? 5;
    if (nextPriority > currentPriority) {
      deduped.set(task.label, task);
    }
  });

  return Array.from(deduped.values()).sort((a, b) => {
    const phaseOrder = { critical: 0, high: 1, deferred: 2, idle: 3 };
    const phaseDiff = phaseOrder[a.phase] - phaseOrder[b.phase];
    if (phaseDiff !== 0) return phaseDiff;
    const priorityDiff = (b.priority ?? 5) - (a.priority ?? 5);
    if (priorityDiff !== 0) return priorityDiff;
    return a.label.localeCompare(b.label);
  });
}

export function computeDagLayers(tasks: OrchestratorDesignTask[]): Map<string, number> {
  const layers = new Map<string, number>();
  const taskMap = new Map(tasks.map(t => [t.label, t]));

  const getLayer = (label: string, visited = new Set<string>()): number => {
    if (layers.has(label)) return layers.get(label)!;
    if (visited.has(label)) return 0;
    visited.add(label);
    const task = taskMap.get(label);
    const deps = task?.dependsOn ?? [];
    const layer = deps.length === 0 ? 0 : Math.max(...deps.map(d => getLayer(d, new Set(visited)) + 1));
    layers.set(label, layer);
    return layer;
  };

  tasks.forEach(t => getLayer(t.label));
  return layers;
}

/** 设计视图 emby:badge 条件：与 content 注入一致（enabled + mediaServers/matchUrls） */
export function isDesignEmbyEnabled(settings: ExtensionSettings & Record<string, any>): boolean {
  const emby = (settings as any)?.emby;
  if (!emby || emby.enabled !== true) return false;
  return getEffectiveEmbyMatchUrls(emby).length > 0;
}
