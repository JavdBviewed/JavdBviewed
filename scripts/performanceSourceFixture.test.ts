import { describe, expect, it } from 'vitest';
import {
  buildPerformanceSourceFixtureHtml,
  inspectPerformanceSourceFixture,
  startPerformanceSourceFixtureServer,
} from './performanceSourceFixture';

describe('performance source fixture', () => {
  it('builds a deterministic JavDB-shaped page with the expected initial cards', () => {
    const html = buildPerformanceSourceFixtureHtml(240);

    expect(html).toContain('data-javdb-performance-source-fixture="1"');
    expect(html).toContain('data-performance-source-item="1"');
    expect(html).toContain('id="navbar-menu-user"');
    expect((html.match(/data-performance-source-item="1"/g) ?? []).length).toBe(240);
    expect(html).not.toContain('https://');
    expect(html).not.toContain('http://');
  });

  it('can disable dynamic card growth for a static observer baseline', () => {
    const html = buildPerformanceSourceFixtureHtml(240, { dynamicItemCount: 0 });

    expect(html).not.toContain('window.setTimeout(appendMutation, 1000)');
    expect(html).toContain('data-performance-source-item="1"');
    expect((html.match(/data-performance-source-item="1"/g) ?? []).length).toBe(240);
  });

  it('accepts only a loaded fixture with enough cards and reports extension injection separately', () => {
    expect(inspectPerformanceSourceFixture({
      marker: true,
      itemCount: 240,
      expectedItemCount: 240,
      extensionInjected: true,
    })).toEqual({
      fixtureLoaded: true,
      itemCount: 240,
      extensionInjected: true,
    });

    expect(inspectPerformanceSourceFixture({
      marker: false,
      itemCount: 54,
      expectedItemCount: 240,
      extensionInjected: false,
    })).toEqual({
      fixtureLoaded: false,
      itemCount: 54,
      extensionInjected: false,
    });
  });

  it('serves the fixture when the diagnostic query parameter is present', async () => {
    const server = await startPerformanceSourceFixtureServer(0, 240, { dynamicItemCount: 0 });
    try {
      const response = await fetch(`${server.url}?perfContent=1`);

      expect(response.ok).toBe(true);
      expect(await response.text()).toContain('data-javdb-performance-source-fixture="1"');
    } finally {
      await server.close();
    }
  });
});
