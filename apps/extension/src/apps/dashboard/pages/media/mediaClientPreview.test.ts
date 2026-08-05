import { afterEach, describe, expect, it } from 'vitest';
import {
  MEDIA_CLIENT_PREVIEW_STORAGE_KEY,
  readMediaClientPreviewHidden,
  writeMediaClientPreviewHidden,
} from './mediaClientPreview';

describe('media client preview persistence', () => {
  const originalStorage = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalStorage,
    });
  });

  it('defaults to visible and persists the hidden state', () => {
    const values: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values[key] ?? null,
        setItem: (key: string, value: string) => { values[key] = value; },
      },
    });

    expect(readMediaClientPreviewHidden()).toBe(false);
    writeMediaClientPreviewHidden(true);
    expect(values[MEDIA_CLIENT_PREVIEW_STORAGE_KEY]).toBe('1');
    expect(readMediaClientPreviewHidden()).toBe(true);
    writeMediaClientPreviewHidden(false);
    expect(readMediaClientPreviewHidden()).toBe(false);
  });

  it('ignores a previous preview version', () => {
    const values: Record<string, string> = {
      ml_client_preview_dismissed_v0: '1',
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values[key] ?? null,
        setItem: (key: string, value: string) => { values[key] = value; },
      },
    });

    expect(readMediaClientPreviewHidden()).toBe(false);
  });
});
