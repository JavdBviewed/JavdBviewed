import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'mount.ts'), 'utf-8');

describe('settings subpage mounting', () => {
  it('routes update-settings to the React full page mount', () => {
    expect(source).toContain("subSection === 'update-settings'");
    expect(source).toContain('mountUpdateSettingsPage');
  });
});
