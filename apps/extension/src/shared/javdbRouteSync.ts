type RouteGroup = { primary: string; preferredUrl?: string; alternatives: unknown[]; updatedAt?: number };

const editTime = (route: RouteGroup | undefined): number =>
  Number.isSafeInteger(route?.updatedAt) && (route?.updatedAt ?? 0) > 0 ? route!.updatedAt! : 0;

const routeFields = (route: RouteGroup) => ({
  primary: route.primary, preferredUrl: route.preferredUrl, alternatives: route.alternatives,
});

export function stampJavdbRouteEdit<T extends RouteGroup>(previous: T, next: T, now = Date.now()): T {
  if (JSON.stringify(routeFields(previous)) === JSON.stringify(routeFields(next))) {
    const unchanged = { ...next };
    if (editTime(previous)) unchanged.updatedAt = editTime(previous);
    else delete unchanged.updatedAt;
    return unchanged;
  }
  return { ...next, updatedAt: Math.max(now, editTime(previous) + 1) };
}

export function reconcileBackgroundJavdbRoute<T extends RouteGroup>(
  initial: T, current: T, proposed: T,
): T {
  if (editTime(current) > editTime(initial) ||
      JSON.stringify(routeFields(current)) !== JSON.stringify(routeFields(initial))) {
    return current;
  }
  return { ...proposed, updatedAt: current.updatedAt };
}

export function mergeJavdbRoutesForPull(local: unknown, remote: unknown): unknown {
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return remote;
  if (!local || typeof local !== 'object' || Array.isArray(local)) return remote;
  const localRoutes = (local as any).routes?.javdb as RouteGroup | undefined;
  const remoteRoutes = (remote as any).routes?.javdb as RouteGroup | undefined;
  if (!localRoutes || !editTime(localRoutes) || editTime(localRoutes) <= editTime(remoteRoutes)) return remote;
  return { ...remote, routes: { ...(remote as any).routes, javdb: localRoutes } };
}
