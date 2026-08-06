/**
 * 统一本地与 WebDAV 备份包格式：ZIP 内包含 backup.json。
 */
import JSZip from 'jszip';

export const BACKUP_JSON_FILENAME = 'backup.json';

export async function createBackupArchive(data: unknown): Promise<Blob> {
  const zip = new JSZip();
  zip.file(BACKUP_JSON_FILENAME, JSON.stringify(data, null, 2));
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/zip' });
}

export async function extractBackupJson(input: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let zip: JSZip;
  try {
    const source = input instanceof Blob ? await input.arrayBuffer() : input;
    zip = await JSZip.loadAsync(source);
  } catch {
    throw new Error('备份 ZIP 无法读取');
  }

  const exactFile = zip.file(BACKUP_JSON_FILENAME);
  const fallbackFile = exactFile || zip.file(/(^|\/)backup\.json$/i)[0];
  if (!fallbackFile) {
    throw new Error('ZIP 中未找到 backup.json');
  }

  try {
    return await fallbackFile.async('string');
  } catch {
    throw new Error('备份 ZIP 中的 backup.json 无法读取');
  }
}

export async function readBackupFileContent(
  fileName: string,
  input: string | Blob | ArrayBuffer | Uint8Array,
): Promise<string> {
  const normalizedName = String(fileName || '').toLowerCase();
  if (normalizedName.endsWith('.zip')) {
    if (typeof input === 'string') {
      throw new Error('备份 ZIP 无法读取');
    }
    return extractBackupJson(input);
  }

  if (normalizedName.endsWith('.json')) {
    if (typeof input === 'string') return input;
    const source = input instanceof Blob ? await input.arrayBuffer() : input;
    return new TextDecoder().decode(source);
  }

  throw new Error('仅支持 ZIP 或 JSON 备份文件');
}
