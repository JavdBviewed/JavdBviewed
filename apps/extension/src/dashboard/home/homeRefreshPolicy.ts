export type HomeRefreshPolicyInput = {
  initialized: boolean;
  force?: boolean;
};

export function shouldRefreshHomeOverview(input: HomeRefreshPolicyInput): boolean {
  return input.force === true || input.initialized === false;
}
