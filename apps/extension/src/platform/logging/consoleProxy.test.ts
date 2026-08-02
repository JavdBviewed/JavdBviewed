import { describe, expect, it } from 'vitest';
import { buildLogCategorySample } from './consoleProxy';

describe('consoleProxy category sampling', () => {
  it('does not serialize payload objects just to classify a log', () => {
    let toJsonCalls = 0;
    const payload = {
      toJSON: () => {
        toJsonCalls += 1;
        return { huge: true };
      },
    };

    expect(buildLogCategorySample(['[MEDIA] 索引进度', payload])).toContain('[MEDIA] 索引进度');
    expect(toJsonCalls).toBe(0);
  });
});
