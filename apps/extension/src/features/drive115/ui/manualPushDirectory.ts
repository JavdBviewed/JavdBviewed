export type Drive115FolderSelection = {
  cid: string;
  name: string;
  path: string;
  setAsDefault?: boolean;
  skipManualDirectoryPicker?: boolean;
};

export type OpenManualPushDirectoryPicker = (
  initialCid: string,
  defaultCid?: string,
) => Promise<Drive115FolderSelection | null>;

export type ResolveManualPushDirectory = (
  initialCid: string,
  defaultCid?: string,
) => Promise<Drive115FolderSelection | null>;

export function getManualPushInitialDirectory(lastManualDirectory: string, defaultDirectory: string): string {
  return lastManualDirectory.trim() || defaultDirectory.trim();
}

export function shouldUseDefaultDirectoryForManualPush(
  skipManualDirectoryPicker: boolean,
  defaultDirectory: string,
): boolean {
  const cid = defaultDirectory.trim();
  return skipManualDirectoryPicker && cid !== '' && cid !== '0';
}

export function getDefaultManualPushDirectory(
  cid: string,
  name: string,
  path: string,
): Drive115FolderSelection | null {
  const normalizedCid = cid.trim();
  if (normalizedCid === '' || normalizedCid === '0') return null;
  return {
    cid: normalizedCid,
    name: name.trim() || `目录 ${normalizedCid}`,
    path: path.trim() || '/',
  };
}

export function createManualPushDirectoryResolver(
  openPicker: OpenManualPushDirectoryPicker,
): ResolveManualPushDirectory {
  return async (initialCid: string, defaultCid = ''): Promise<Drive115FolderSelection | null> => {
    if (!defaultCid) return openPicker(initialCid);
    return openPicker(initialCid, defaultCid);
  };
}

export const resolveManualPushDirectory: ResolveManualPushDirectory =
  createManualPushDirectoryResolver(openManualPushDirectoryPicker);
import { openManualPushDirectoryPicker } from './manualPushDirectoryPicker';
