export interface NavigationRenderState {
  previousGroupId: string | null;
  nextGroupId: string;
}

export function shouldRebuildNavigation(state: NavigationRenderState): boolean {
  return state.previousGroupId !== state.nextGroupId;
}
