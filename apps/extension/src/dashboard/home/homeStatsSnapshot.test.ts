import { describe, expect, it, vi } from 'vitest';
import { createHomeStatsSnapshotLoader } from './homeStatsSnapshot';

function createLoaders() {
  return {
    viewedStats: vi.fn(async () => ({ total: 3 })),
    actorsStats: vi.fn(async () => ({ total: 4 })),
    newWorksStats: vi.fn(async () => ({ total: 5 })),
  };
}

describe('home stats snapshot loader', () => {
  it('shares one in-flight request across overview and charts', async () => {
    const loaders = createLoaders();
    const loader = createHomeStatsSnapshotLoader(loaders);

    const first = loader.load();
    const second = loader.load();

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({
      viewedStats: { total: 3 },
      actorsStats: { total: 4 },
      newWorksStats: { total: 5 },
    });
    expect(loaders.viewedStats).toHaveBeenCalledTimes(1);
    expect(loaders.actorsStats).toHaveBeenCalledTimes(1);
    expect(loaders.newWorksStats).toHaveBeenCalledTimes(1);
  });

  it('reuses the completed snapshot until it is invalidated', async () => {
    const loaders = createLoaders();
    const loader = createHomeStatsSnapshotLoader(loaders);

    await loader.load();
    await loader.load();

    expect(loaders.viewedStats).toHaveBeenCalledTimes(1);
    expect(loaders.actorsStats).toHaveBeenCalledTimes(1);
    expect(loaders.newWorksStats).toHaveBeenCalledTimes(1);

    loader.invalidate();
    await loader.load();

    expect(loaders.viewedStats).toHaveBeenCalledTimes(2);
    expect(loaders.actorsStats).toHaveBeenCalledTimes(2);
    expect(loaders.newWorksStats).toHaveBeenCalledTimes(2);
  });
});
