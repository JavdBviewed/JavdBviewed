import { dbActorsStats, dbNewWorksStats, dbViewedStats } from '../dbClient';

export type HomeStatsSnapshot = {
  viewedStats: Awaited<ReturnType<typeof dbViewedStats>>;
  actorsStats: Awaited<ReturnType<typeof dbActorsStats>>;
  newWorksStats: Awaited<ReturnType<typeof dbNewWorksStats>>;
};

export type HomeStatsSnapshotLoaders = {
  viewedStats: () => Promise<HomeStatsSnapshot['viewedStats']>;
  actorsStats: () => Promise<HomeStatsSnapshot['actorsStats']>;
  newWorksStats: () => Promise<HomeStatsSnapshot['newWorksStats']>;
};

export function createHomeStatsSnapshotLoader(loaders: HomeStatsSnapshotLoaders) {
  let snapshot: HomeStatsSnapshot | null = null;
  let active: Promise<HomeStatsSnapshot> | null = null;

  const load = (): Promise<HomeStatsSnapshot> => {
    if (snapshot) return Promise.resolve(snapshot);
    if (active) return active;

    const request = Promise.all([
      loaders.viewedStats(),
      loaders.actorsStats(),
      loaders.newWorksStats(),
    ]).then(([viewedStats, actorsStats, newWorksStats]) => {
      snapshot = { viewedStats, actorsStats, newWorksStats };
      return snapshot;
    });
    let flight: Promise<HomeStatsSnapshot>;
    flight = request.finally(() => {
      if (active === flight) active = null;
    });
    active = flight;
    return flight;
  };

  const invalidate = (): void => {
    snapshot = null;
  };

  return { load, invalidate };
}

const homeStatsSnapshotLoader = createHomeStatsSnapshotLoader({
  viewedStats: () => dbViewedStats().catch(() => ({
    total: 0,
    byStatus: {},
    last7Days: 0,
    last30Days: 0,
  })),
  actorsStats: () => dbActorsStats().catch(() => ({
    total: 0,
    byGender: {},
    byCategory: {},
    blacklisted: 0,
    recentlyAdded: 0,
    recentlyUpdated: 0,
  })),
  newWorksStats: () => dbNewWorksStats().catch(() => ({
    total: 0,
    unread: 0,
    today: 0,
    week: 0,
  })),
});

export function loadHomeStatsSnapshot(): Promise<HomeStatsSnapshot> {
  return homeStatsSnapshotLoader.load();
}

export function invalidateHomeStatsSnapshot(): void {
  homeStatsSnapshotLoader.invalidate();
}
