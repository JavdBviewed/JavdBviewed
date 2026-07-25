import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, '..', '..', '..', 'tailwind.config.js');

describe('extension Tailwind build config', () => {
  it('keeps a local config so Vite builds React UI utility classes', () => {
    expect(existsSync(configPath)).toBe(true);

    const source = readFileSync(configPath, 'utf8');
    expect(source).toContain('./src/ui/**/*.{ts,tsx,js,jsx}');
    expect(source).toContain('./src/apps/dashboard/**/*.{ts,tsx,js,jsx,html}');
    expect(source).toContain('darkMode');
  });
});
