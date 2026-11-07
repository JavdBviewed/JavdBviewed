import type { CrosslinePageContext, CrosslinePromptStatus, CrosslineLoginState, CrosslineCopyOutcome } from '../../shared/protocols/crosslineSession';
import { CROSSLINE_DISMISS_MS, CROSSLINE_SESSION_KEY, CROSSLINE_SUPPRESSION_KEY, crosslineScopeKey, shouldAutoPrompt, type CrosslineSuppression } from './crosslinePromptPolicy';
export interface CrosslinePromptDependencies {
  now(): number;
  id(): string;
  enabled(): Promise<boolean>;
  hosts(): Promise<string[]>;
  current(context: CrosslinePageContext): Promise<boolean>;
  snapshot(context: CrosslinePageContext, host: string): Promise<string>;
  verify(context: CrosslinePageContext, host: string): Promise<CrosslineLoginState>;
  read(area: 'local' | 'session', key: string): Promise<unknown>;
  write(area: 'local' | 'session', key: string, value: unknown): Promise<void>;
  copy(context: CrosslinePageContext, source: string, before: () => Promise<CrosslineCopyOutcome | undefined>): Promise<CrosslineCopyOutcome>;
}
type Offer = { revision: number; context: CrosslinePageContext; until: number; target: string; sources: Map<string, string> };
type SessionState = { shown: Record<string, boolean>; lastShownAt: number };
function sameContext(a: CrosslinePageContext, b: CrosslinePageContext): boolean {
  return a.tabId === b.tabId && a.documentId === b.documentId && a.origin === b.origin &&
    a.storeId === b.storeId && a.targetHost === b.targetHost && a.incognito === b.incognito;
}
export function createCrosslinePromptService(deps: CrosslinePromptDependencies) {
  let revision = 0;
  function invalidate() { revision++; cache.clear(); offers.clear(); }
  const offers = new Map<string, Offer>();
  const cache = new Map<string, { signature: string; state: CrosslineLoginState; until: number }>();
  let probeQueue: Promise<unknown> = Promise.resolve();
  let stateQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const result = stateQueue.then(action); stateQueue = result.catch(() => undefined); return result;
  };
  async function verify(ctx: CrosslinePageContext, host: string, fresh = false): Promise<CrosslineLoginState> {
    const request = async () => {
      const startingRevision = revision;
      const key = crosslineScopeKey(ctx.storeId, host);
      const before = await deps.snapshot(ctx, host);
      const hit = cache.get(key);
      if (!fresh && hit?.signature === before && hit.until > deps.now()) return hit.state;
      let state: CrosslineLoginState = 'unknown';
      // One retry for a session rotation during a read, never retry a network error.
      let signature = before;
      for (let attempt = 0; attempt < 2; attempt++) {
        state = await deps.verify(ctx, host).catch(() => 'unknown' as const);
        const after = await deps.snapshot(ctx, host);
        if (after === signature) break;
        state = 'unknown'; signature = after;
      }
      if (revision !== startingRevision) return 'unknown' as const;
      cache.set(key, { state, signature, until: deps.now() + (state === 'unknown' ? 60_000 : 300_000) });
      return state;
    };
    const result = probeQueue.then(request); probeQueue = result.catch(() => undefined); return result;
  }
  async function eligible(ctx: CrosslinePageContext): Promise<boolean> {
    return await deps.enabled() && (await deps.hosts()).includes(ctx.targetHost) && await deps.current(ctx);
  }
  async function status(ctx: CrosslinePageContext): Promise<CrosslinePromptStatus> {
    const startingRevision = revision;
    const enabled = await eligible(ctx);
    const result: CrosslinePromptStatus = { enabled, targetHost: ctx.targetHost, targetState: 'unknown', sources: [] };
    if (!enabled) return result;
    result.targetState = await verify(ctx, ctx.targetHost);
    if (result.targetState !== 'anonymous') return result;
    const sources = new Map<string, string>();
    for (const host of await deps.hosts()) {
      if (host === ctx.targetHost || !await deps.snapshot(ctx, host)) continue;
      if (await verify(ctx, host) === 'authenticated') sources.set(host, await deps.snapshot(ctx, host));
    }
    if (!sources.size || !await eligible(ctx) || revision !== startingRevision) return result;
    for (const [id, offer] of offers) if (offer.until < deps.now() || sameContext(ctx, offer.context)) offers.delete(id);
    // Bound memory even if many tabs are opened before expiration.
    if (offers.size >= 100) offers.clear();
    const id = deps.id();
    offers.set(id, { revision, context: { ...ctx }, sources, target: await deps.snapshot(ctx, ctx.targetHost), until: deps.now() + 60_000 });
    result.sources = [...sources.keys()].map(host => ({ host })); result.offerId = id;
    return result;
  }
  function getOffer(ctx: CrosslinePageContext, id: string): Offer | undefined {
    const offer = offers.get(id);
    return offer && offer.until > deps.now() && sameContext(ctx, offer.context) ? offer : undefined;
  }
  async function suppression(): Promise<CrosslineSuppression> {
    const raw = await deps.read('local', CROSSLINE_SUPPRESSION_KEY);
    return raw && typeof raw === 'object' ? raw as CrosslineSuppression : {};
  }
  async function suppress(ctx: CrosslinePageContext, reason: 'dismiss' | 'logout') {
    await serialize(async () => {
      const items = await suppression();
      for (const key of Object.keys(items)) if (items[key]?.until <= deps.now()) delete items[key];
      items[crosslineScopeKey(ctx.storeId, ctx.targetHost)] = { until: deps.now() + CROSSLINE_DISMISS_MS, reason };
      await deps.write('local', CROSSLINE_SUPPRESSION_KEY, items);
    });
  }
  async function claim(ctx: CrosslinePageContext, id: string): Promise<boolean> {
    return serialize(async () => {
      const offer = getOffer(ctx, id);
      if (!offer || !await eligible(ctx)) return false;
      const key = crosslineScopeKey(ctx.storeId, ctx.targetHost);
      const items = await suppression();
      const raw = await deps.read('session', CROSSLINE_SESSION_KEY) as SessionState | undefined;
      const session: SessionState = { shown: raw?.shown || {}, lastShownAt: raw?.lastShownAt || 0 };
      if (!shouldAutoPrompt({ enabled: true, targetState: 'anonymous', sourceCount: offer.sources.size,
        now: deps.now(), suppressedUntil: items[key]?.until || 0, shownThisSession: !!session.shown[key], lastGlobalShownAt: session.lastShownAt })) return false;
      session.shown[key] = true; session.lastShownAt = deps.now();
      await deps.write('session', CROSSLINE_SESSION_KEY, session);
      return true;
    });
  }
  async function copy(ctx: CrosslinePageContext, id: string, source: string): Promise<CrosslineCopyOutcome> {
    const offer = getOffer(ctx, id);
    if (!offer || !offer.sources.has(source)) return 'stale';
    offers.delete(id);
    const outcome = await deps.copy(ctx, source, async () => {
      if (offer.revision !== revision || !await eligible(ctx) || !(await deps.hosts()).includes(source)) return 'stale';
      if (await deps.snapshot(ctx, source) !== offer.sources.get(source)) return 'stale';
      const target = await verify(ctx, ctx.targetHost, true);
      if (target === 'authenticated') return 'already-authenticated';
      if (target !== 'anonymous') return 'unconfirmed';
      if (await deps.snapshot(ctx, ctx.targetHost) !== offer.target) return 'stale';
      if (await verify(ctx, source, true) !== 'authenticated') return 'stale';
      if (offer.revision !== revision || !await eligible(ctx) || await deps.snapshot(ctx, source) !== offer.sources.get(source) ||
        await deps.snapshot(ctx, ctx.targetHost) !== offer.target) return 'stale';
      return undefined;
    });
    cache.clear();
    return outcome;
  }
  return { status, claim, copy, invalidate,
    dismiss: async (ctx: CrosslinePageContext, _id: string) => { if (await deps.current(ctx)) await suppress(ctx, 'dismiss'); },
    // Sender origin/store was validated by the handler; logout navigation may already have destroyed its document.
    logout: async (ctx: CrosslinePageContext) => { cache.clear(); await suppress(ctx, 'logout'); },
  };
}
