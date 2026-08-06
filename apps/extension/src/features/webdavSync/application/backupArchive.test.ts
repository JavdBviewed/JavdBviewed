import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createBackupArchive, extractBackupJson, readBackupFileContent } from './backupArchive';

describe('backup archive', () => {
  it('creates a WebDAV-compatible ZIP containing backup.json', async () => {
    const payload = {
      version: '2.1',
      timestamp: '2026-08-06T00:00:00.000Z',
      data: { 'ABC-001': { status: 'viewed' } },
    };

    const archive = await createBackupArchive(payload);
    const json = await extractBackupJson(archive);

    expect(JSON.parse(json)).toEqual(payload);
  });

  it('rejects a ZIP without backup.json before any restore can start', async () => {
    const zip = new JSZip();
    zip.file('notes.txt', 'not a backup');
    const archive = await zip.generateAsync({ type: 'blob' });

    await expect(extractBackupJson(archive)).rejects.toThrow('ZIP 中未找到 backup.json');
  });

  it('rejects a corrupted ZIP with a user-readable error', async () => {
    await expect(extractBackupJson(new Blob(['not a zip']))).rejects.toThrow('备份 ZIP 无法读取');
  });

  it('keeps accepting legacy JSON backup files', async () => {
    const json = '{"version":"2.1","data":{}}';

    await expect(readBackupFileContent('legacy-backup.json', json)).resolves.toBe(json);
  });

  it('rejects unsupported local backup file types', async () => {
    await expect(readBackupFileContent('backup.txt', 'not a backup'))
      .rejects.toThrow('仅支持 ZIP 或 JSON 备份文件');
  });
});
