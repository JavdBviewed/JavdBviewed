import { describe, expect, it } from 'vitest';
import { buildImportRestoreRequest, getImportResponseIssues } from './import';

describe('local backup import request', () => {
  it('routes settings JSON through the complete restore service', () => {
    const request = buildImportRestoreRequest({ settings: { drive115: { enabled: true } } }, 'settings', 'merge');
    expect(request.type).toBe('restore-from-json');
    expect(request.categories.settings).toBe(true);
    expect(request.categories.viewed).toBe(false);
    expect(request.categoryModes.settings).toBe('replace');
    expect(JSON.parse(request.jsonData)).toMatchObject({ settings: { drive115: { enabled: true } } });
  });

  it('selects data categories and preserves merge semantics', () => {
    const request = buildImportRestoreRequest({ data: { ABC001: { id: 'ABC001' } } }, 'data', 'merge');
    expect(request.categories.viewed).toBe(true);
    expect(request.categories.settings).toBe(false);
    expect(request.categories.magnets).toBe(true);
    expect(request.categories.logs).toBe(true);
    expect(request.categories.magnetPushLogs).toBe(true);
    expect(request.categoryModes.viewed).toBe('merge');
    expect(request.categoryModes.lists).toBe('merge');
  });

  it('selects every restorable category for a complete overwrite import', () => {
    const request = buildImportRestoreRequest({}, 'all', 'overwrite');

    expect(Object.keys(request.categories).filter((key) => request.categories[key])).toEqual([
      'settings',
      'userProfile',
      'viewed',
      'actors',
      'newWorks',
      'lists',
      'magnets',
      'logs',
      'magnetPushLogs',
      'importStats',
    ]);
    expect(request.categoryModes.settings).toBe('replace');
    expect(request.categoryModes.magnets).toBe('replace');
  });

  it('reports category-level restore errors and missing categories', () => {
    const issues = getImportResponseIssues({
      success: true,
      summary: {
        categories: {
          viewed: { reason: 'error', error: '写入失败' },
          actors: { reason: 'missing' },
        },
      },
    });

    expect(issues.errors).toEqual(['viewed：写入失败']);
    expect(issues.missing).toEqual(['actors']);
  });
});
