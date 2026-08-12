let playbackActive = false;

export function setMediaPlaybackActive(active: boolean): void {
  playbackActive = active;
}

export function isMediaPlaybackActive(): boolean {
  return playbackActive;
}
