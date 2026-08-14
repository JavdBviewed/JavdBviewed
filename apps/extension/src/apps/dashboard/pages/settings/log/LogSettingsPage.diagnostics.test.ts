import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, 'LogSettingsPage.tsx'), 'utf8');

describe('LogSettingsPage background task diagnostics', () => {
  it('keeps the background task diagnostic panel collapsed by default', () => {
    expect(pageSource).toContain('<details');
    expect(pageSource).toContain('后台任务诊断');
    expect(pageSource).toContain('ALARM_DIAGNOSTICS_GET');
    expect(pageSource).not.toContain('<details open');
  });
});
