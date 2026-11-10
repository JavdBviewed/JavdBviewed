import { createRoot, type Root } from 'react-dom/client';
import { MediaMetadataBatches } from './MediaMetadataBatches';
let root: Root | undefined;
export function mountMediaMetadataBatches(): void {
  const container = document.getElementById('media-metadata-sync-tasks');
  if (container && !root) { root = createRoot(container); root.render(<MediaMetadataBatches />); }
}
export function unmountMediaMetadataBatches(): void { root?.unmount(); root = undefined; }
