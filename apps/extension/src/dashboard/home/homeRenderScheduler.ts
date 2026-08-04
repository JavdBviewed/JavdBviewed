export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const afterFrame = () => {
      setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(afterFrame);
    } else {
      setTimeout(afterFrame, 0);
    }
  });
}
