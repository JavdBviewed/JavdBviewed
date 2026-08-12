export const BACKGROUND_BOOTSTRAP_STEPS = [
  'release-announcement',
  'drive115-proxy',
  'migrations',
  'telemetry',
  'task-center-restore',
  'dynamic-content-scripts',
  'emby-content-scripts',
  'route-auto-update',
  'webdav-router',
  'db-router',
  'misc-router',
  'net-proxy-router',
  'covers-referer-dnr',
  'drive115-alarm',
  'alarm-wiring',
  'error-handlers',
] as const;

export type BackgroundBootstrapStep = typeof BACKGROUND_BOOTSTRAP_STEPS[number];

export function parseBackgroundBootstrapSkipProfile(
  value: string | undefined,
): BackgroundBootstrapStep[] {
  const known = new Set<BackgroundBootstrapStep>(BACKGROUND_BOOTSTRAP_STEPS);
  const selected = new Set<BackgroundBootstrapStep>();
  for (const part of (value ?? '').split(',')) {
    const step = part.trim() as BackgroundBootstrapStep;
    if (known.has(step)) selected.add(step);
  }
  return BACKGROUND_BOOTSTRAP_STEPS.filter((step) => selected.has(step));
}

export function shouldRunBackgroundBootstrapStep(
  skippedSteps: readonly BackgroundBootstrapStep[],
  step: BackgroundBootstrapStep,
): boolean {
  return !skippedSteps.includes(step);
}
