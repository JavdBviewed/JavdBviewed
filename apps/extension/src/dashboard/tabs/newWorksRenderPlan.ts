import type { NewWorksStats } from '../../types';

type NewWorksListRenderResult = { stats?: NewWorksStats } | undefined;

export type NewWorksRenderPlanOptions = {
  renderStats: boolean;
  renderList: boolean;
};

export async function renderNewWorksPage(input: {
  options: NewWorksRenderPlanOptions;
  renderList: () => Promise<NewWorksListRenderResult>;
  renderStats: (stats?: NewWorksStats) => Promise<void>;
  scheduleStats?: (callback: () => void) => void;
}): Promise<void> {
  const listResult = input.options.renderList
    ? await input.renderList()
    : undefined;

  if (input.options.renderStats) {
    if (input.scheduleStats) {
      input.scheduleStats(() => { void input.renderStats(); });
      return;
    }
    await input.renderStats(listResult?.stats);
  }
}
