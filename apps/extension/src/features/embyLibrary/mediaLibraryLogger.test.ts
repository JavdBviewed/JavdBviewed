import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaLog } from './mediaLibraryLogger';

describe('mediaLibraryLogger', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not send a second persistence message when consoleProxy owns log persistence', () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    mediaLog.info('媒体库同步完成', { indexed: 1 });

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
