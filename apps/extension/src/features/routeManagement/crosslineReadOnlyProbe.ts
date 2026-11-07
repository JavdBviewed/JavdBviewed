/** Temporary response rules keep account checks from rotating the browser's real sessions. */
const PROBE_RULE_IDS = [20002, 20003] as const;
let probeQueue: Promise<unknown> = Promise.resolve();
export function withReadOnlyCrosslineProbe<T>(origin: string, request: (urls: { profile: string; login: string }) => Promise<T>): Promise<T> {
  const operation = probeQueue.then(async () => {
    const nonce = crypto.randomUUID();
    const urls = { profile: `${origin}/users/profile?__javdb_session_probe=${nonce}`, login: `${origin}/login?__javdb_session_probe=${nonce}` };
    const rules: chrome.declarativeNetRequest.Rule[] = Object.values(urls).map((url, index) => ({
      id: PROBE_RULE_IDS[index], priority: 1,
      action: { type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        responseHeaders: [{ header: 'set-cookie', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation }] },
      condition: { urlFilter: `|${url}|`, resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType] },
    }));
    // Session rules disappear on browser exit; the next probe replaces stale IDs after worker termination.
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [...PROBE_RULE_IDS], addRules: rules });
    try { return await request(urls); }
    finally { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [...PROBE_RULE_IDS] }); }
  });
  probeQueue = operation.catch(() => undefined);
  return operation;
}
