import { describe, expect, it, vi } from 'vitest';

import { clearTabWorkset } from './tabWorkset';

describe('tab workset cleanup', () => {
  it('clears only the selected output containers', () => {
    const selected = { replaceChildren: vi.fn() };
    const other = { replaceChildren: vi.fn() };
    const root = {
      querySelectorAll: (selector: string) => selector === '.output'
        ? [selected]
        : [other],
    };

    clearTabWorkset(root, ['.output']);

    expect(selected.replaceChildren).toHaveBeenCalledTimes(1);
    expect(other.replaceChildren).not.toHaveBeenCalled();
  });

  it('is safe when a tab root is not mounted', () => {
    expect(() => clearTabWorkset(null, ['.output'])).not.toThrow();
  });
});
