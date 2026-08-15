import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/extension/src/features/drive115/mediaLibrary', () => ({
  loadDrive115LibraryState: vi.fn().mockResolvedValue({
    entries: [{ code: 'SSIS-001', fileName: 'SSIS-001.mp4' }],
  }),
  lookupByCode: vi.fn((state: { entries: Array<{ code: string }> }, code: string) =>
    state.entries.filter((entry) => entry.code === code.toUpperCase()),
  ),
}));

import { renderDrive115LibraryStatusBadge } from '../../apps/extension/src/features/drive115/content/libraryStatusBadges';
import { loadDrive115LibraryState, lookupByCode } from '../../apps/extension/src/features/drive115/mediaLibrary';

describe('115 local library badge fixture', () => {
  beforeEach(() => {
    document.body.innerHTML = '<article class="movie-list"><div class="item"><div class="video-title"><div class="tags"></div></div></div></article>';
    vi.mocked(loadDrive115LibraryState).mockResolvedValue({ entries: [{ code: 'SSIS-001', fileName: 'SSIS-001.mp4' }] } as never);
    vi.mocked(lookupByCode).mockImplementation(((state: { entries: Array<{ code: string }> }, code: string) =>
      state.entries.filter((entry) => entry.code === code.toUpperCase())) as never);
  });

  it('renders only for a locally indexed exact code', async () => {
    const tags = document.querySelector<HTMLElement>('.tags');
    if (!tags) throw new Error('fixture tags missing');
    const settings = { listEnhancement: { drive115LibraryStatus: { enabled: true } } };

    await renderDrive115LibraryStatusBadge(tags, 'SSIS-001', settings);
    expect(tags.textContent).toContain('115 已有');

    await renderDrive115LibraryStatusBadge(tags, 'SSIS-002', settings);
    expect(tags.textContent).not.toContain('115 已有');
  });
});
