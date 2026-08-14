import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeEnhancementSettingsForSave } from './settings/enhancementSettingsMerge';

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(
  join(here, '../../../partials/tabs/settings-enhancement.html'),
  'utf8',
);

describe('legacy enhancement scheduling mode', () => {
  it('renders the top-level two-option slider without background diagnostics', () => {
    expect(pageSource.indexOf('data-scheduling-mode-control')).toBeGreaterThan(-1);
    expect(pageSource).toContain('name="videoEnhancementSchedulingMode"');
    expect(pageSource).toContain('智能调度');
    expect(pageSource).toContain('立即增强');
    expect(pageSource).not.toContain('showAlarmDiagnosticsBtn');
  });

  it('writes the selected legacy control into the shared scheduling setting', () => {
    const next = mergeEnhancementSettingsForSave({
      videoEnhancement: { schedulingMode: 'smart' },
    } as any, {
      getVideoEnhancementSchedulingMode: () => 'immediate',
    });

    expect((next.videoEnhancement as any).schedulingMode).toBe('immediate');
  });
});
