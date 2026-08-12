export interface RecordsRestoreState {
  hasRenderedPage: boolean;
  stale: boolean;
}

export function shouldRenderRecordsOnRestore(state: RecordsRestoreState): boolean {
  return !state.hasRenderedPage || state.stale;
}
