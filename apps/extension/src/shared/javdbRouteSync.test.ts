import { describe, expect, it } from 'vitest';
import { mergeJavdbRoutesForPull, reconcileBackgroundJavdbRoute, stampJavdbRouteEdit } from './javdbRouteSync';

const route = (preferredUrl: string, updatedAt?: number) => ({
  primary: 'https://javdb.com', preferredUrl, alternatives: [], ...(updatedAt ? { updatedAt } : {}),
});

describe('shared JavDB route edit order', () => {
  it('keeps the later local route while applying other remote settings', () => {
    const local = { routes: { javdb: route('https://javdb575.com', 2000), javbus: { primary: 'local' } }, display: { theme: 'light' } };
    const remote = { routes: { javdb: route('https://javdb570.com', 1000), javbus: { primary: 'remote' } }, display: { theme: 'dark' } };
    expect(mergeJavdbRoutesForPull(local, remote)).toEqual({
      ...remote, routes: { ...remote.routes, javdb: local.routes.javdb },
    });
    expect(mergeJavdbRoutesForPull(remote, local)).toEqual(local);
    expect(mergeJavdbRoutesForPull({ routes: { javdb: route('https://javdb570.com') } }, local)).toEqual(local);
  });

  it('does not stamp an unchanged route, but stamps an edit after a later remote clock', () => {
    const previous = route('https://javdb570.com', 2000);
    expect(stampJavdbRouteEdit(previous, { ...previous }, 3000)).toEqual(previous);
    expect(stampJavdbRouteEdit(previous, route('https://javdb575.com'), 1000).updatedAt).toBe(2001);
    expect(stampJavdbRouteEdit(route('https://javdb570.com'), route('https://javdb570.com', 9999), 1000).updatedAt).toBeUndefined();
  });

  it('background refresh does not overwrite a route pulled between its two reads', () => {
    const initial = route('https://javdb570.com', 1000);
    const pulled = route('https://javdb575.com', 2000);
    const proposed = { ...initial, alternatives: [{ url: 'https://javdb580.com' }] };
    expect(reconcileBackgroundJavdbRoute(initial, pulled, proposed)).toEqual(pulled);
    expect(reconcileBackgroundJavdbRoute(initial, initial, proposed).updatedAt).toBe(1000);
  });
});
