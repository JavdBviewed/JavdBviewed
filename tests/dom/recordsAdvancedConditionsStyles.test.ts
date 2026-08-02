import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(process.cwd(), 'apps/extension/src/dashboard/styles/05-pages/records.css');

describe('records advanced condition action styles', () => {
  it('assigns distinct semantic colors to add, apply, and reset actions in both themes', () => {
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('.records-page .advanced-search-panel .adv-controls #addConditionBtn');
    expect(css).toContain('.records-page .advanced-search-panel .adv-controls #applyConditionsBtn');
    expect(css).toContain('.records-page .advanced-search-panel .adv-controls #resetConditionsBtn');
    expect(css).toContain('--records-adv-add-bg');
    expect(css).toContain('--records-adv-apply-bg');
    expect(css).toContain('--records-adv-reset-bg');
    expect(css).toContain('[data-theme="dark"] .records-page');
    expect(css).toContain('.records-page .advanced-search-panel .adv-controls button:focus-visible');
  });
});
